/**
 * Threads and comments on a site's contexts (blocks, pages, the site itself,
 * workstreams). Pure persistence: every write returns the committed shape and
 * emits nothing; the route turns the return value into an event.
 *
 * At most one open thread exists per context (partial unique index). Posting
 * on a context with a resolved thread reopens it rather than starting another.
 *
 * The statements are raw SQL on the request's handle: the overview joins two
 * author tables through a discriminator and pages with DISTINCT ON and a keyset
 * bound, which the builder does not express.
 */

import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db, transaction } from '../../db/scope';
import type { AuthenticatedPrincipal } from '../../types';
import type {
  AgentProposalMetadata,
  CommentAuthor,
  CommentContent,
  ThreadActor,
  ThreadContextRef,
  ProposalDecision,
  StoredComment,
  ThreadOverview,
  ThreadStatus,
} from '../../types/threads';
import { isAgentProposal } from '../../types/threads';
import { decodeCursor, encodeCursor } from './cursor';
import { ThreadForbiddenError, ThreadInputError } from './errors';
import { toStoredComment, toThreadOverview } from './factories';
import type { AuthorRow, CommentRow, ThreadRow } from './rows';

export { ThreadForbiddenError, ThreadInputError } from './errors';

export interface PostCommentInput {
  siteId: string;
  context: ThreadContextRef;
  documentId?: string;
  branchId?: string;
  body: string;
  actor: ThreadActor;
}

/** What a successful post or reply committed: the comment and the thread as it stands afterwards. */
export interface CommentWriteResult {
  thread: ThreadOverview;
  comment: StoredComment;
  /** The thread was resolved before this comment and is open now. */
  reopened: boolean;
}

/** A comment after it was changed in place, and the thread as it stands afterwards. */
export interface CommentUpdateResult {
  thread: ThreadOverview;
  comment: StoredComment;
}

export interface ThreadListOptions {
  documentId?: string;
  status: ThreadStatus | 'all';
  limit: number;
  cursor?: string;
}

export interface ThreadListPage {
  threads: ThreadOverview[];
  nextCursor: string | null;
}

export interface ThreadStatusResult {
  thread: ThreadOverview;
  actor: CommentAuthor;
  changed: boolean;
}

const THREAD_SELECT = sql`
  SELECT t.id, t.site_id, t.context_type, t.context_id, t.document_id, t.branch_id, t.status,
         t.created_at, t.updated_at, t.resolved_at, t.resolved_by_type, t.resolved_by_id,
         COALESCE(ru.name, ra.name) AS resolved_by_name,
         ru.avatar_url AS resolved_by_avatar,
         (SELECT count(*) FROM app.comments c
           WHERE c.thread_id = t.id AND c.deleted_at IS NULL)::int AS comment_count,
         (SELECT max(c.created_at) FROM app.comments c
           WHERE c.thread_id = t.id AND c.deleted_at IS NULL) AS last_comment_at
  FROM app.comment_threads t
  LEFT JOIN app.users ru ON t.resolved_by_type = 'user' AND ru.id = t.resolved_by_id
  LEFT JOIN app.agents ra ON t.resolved_by_type = 'agent' AND ra.id = t.resolved_by_id::text`;

const COMMENT_SELECT = sql`
  SELECT c.id, c.thread_id, c.kind, c.body, c.metadata, c.author_type, c.author_id, c.acting_user_id,
         c.created_at, c.edited_at,
         COALESCE(au.name, aa.name) AS author_name,
         au.avatar_url AS author_avatar,
         xu.name AS acting_user_name
  FROM app.comments c
  LEFT JOIN app.users au ON c.author_type = 'user' AND au.id = c.author_id
  LEFT JOIN app.agents aa ON c.author_type = 'agent' AND aa.id = c.author_id::text
  LEFT JOIN app.users xu ON xu.id = c.acting_user_id`;

/**
 * First comment on a context. Finds the context's thread (open preferred, else
 * the latest resolved one and reopens it) or creates one. Two first-posters
 * racing on one context end up on a single thread with two comments.
 */
export async function postComment(input: PostCommentInput): Promise<CommentWriteResult> {
  await assertOwnedTargets(input.siteId, input.documentId, input.branchId);

  return transaction(async () => {
    const existing = await findThreadForContext(input.siteId, input.context);
    const thread = existing ?? (await createThread(input));
    return appendComment(thread, input.body, input.actor);
  });
}

/**
 * Reply on a known thread; null when the site has no such thread. A plain
 * string is a plain comment; an agent passes the full content to leave a working
 * line or a proposal instead.
 */
export async function replyToThread(
  siteId: string,
  threadId: string,
  content: string | CommentContent,
  actor: ThreadActor,
): Promise<CommentWriteResult | null> {
  return transaction(async () => {
    const thread = await lockThread(siteId, threadId);
    if (thread === null) return null;
    return appendComment(thread, content, actor);
  });
}

/**
 * Replaces one of the caller's own comments: kind, body and state together.
 * This is how an agent's working line becomes its answer. Null when the site
 * has no such thread or the thread no such comment; a comment someone else
 * wrote is refused.
 */
export async function updateComment(
  siteId: string,
  threadId: string,
  commentId: string,
  content: CommentContent,
  actor: ThreadActor,
): Promise<CommentUpdateResult | null> {
  return transaction(async () => {
    const thread = await lockThread(siteId, threadId);
    if (thread === null) return null;
    const current = await lockComment(threadId, commentId);
    if (current === null) return null;
    if (current.author.type !== actor.type || current.author.id !== actor.id) {
      throw new ThreadForbiddenError('Only the author can change a comment');
    }
    if (isAgentProposal(current) && current.metadata.status !== 'proposed') {
      throw new ThreadInputError('kind', `A proposal already ${current.metadata.status} cannot be rewritten`);
    }

    // A working line turning into the answer is not an edit; anything else is.
    const editedAt = current.kind === 'agent_activity' ? sql`` : sql`, edited_at = now()`;
    await db().execute(sql`
      UPDATE app.comments
      SET kind = ${content.kind}, body = ${content.body}, metadata = ${jsonParam(content.metadata)}::jsonb${editedAt}
      WHERE id = ${commentId}`);
    return touchedThread(thread, commentId);
  });
}

/** A claim older than this belongs to an accept that never finished, and may be taken over. */
const APPLY_CLAIM_MS = 60_000;

function isClaimable(metadata: AgentProposalMetadata, now: number): boolean {
  if (metadata.status === 'proposed') return true;
  if (metadata.status !== 'applying' || metadata.claimedAt === undefined) return false;
  return now - Date.parse(metadata.claimedAt) > APPLY_CLAIM_MS;
}

async function lockProposal(
  siteId: string,
  threadId: string,
  commentId: string,
): Promise<{ thread: ThreadOverview; comment: StoredComment & { metadata: AgentProposalMetadata } } | null> {
  const thread = await lockThread(siteId, threadId);
  if (thread === null) return null;
  const comment = await lockComment(threadId, commentId);
  if (comment === null) return null;
  if (!isAgentProposal(comment)) {
    throw new ThreadInputError('decision', 'Only an agent proposal can be accepted or dismissed');
  }
  return { thread, comment };
}

async function writeProposalMetadata(commentId: string, metadata: AgentProposalMetadata): Promise<void> {
  await db().execute(sql`UPDATE app.comments SET metadata = ${jsonParam(metadata)}::jsonb WHERE id = ${commentId}`);
}

/**
 * Marks a waiting proposal as being applied and hands it back for the edits to
 * be made. Only one accept can hold the claim: a second one arriving while the
 * first is still at work is refused, so the edits cannot land twice. A claim
 * left behind by an accept that never recorded its decision is taken over.
 */
export async function claimProposal(
  siteId: string,
  threadId: string,
  commentId: string,
): Promise<CommentUpdateResult | null> {
  return transaction(async () => {
    const locked = await lockProposal(siteId, threadId, commentId);
    if (locked === null) return null;
    const { status } = locked.comment.metadata;
    if (!isClaimable(locked.comment.metadata, Date.now())) {
      throw new ThreadInputError(
        'decision',
        status === 'applying' ? 'This proposal is being applied' : `This proposal was already ${status}`,
      );
    }
    const metadata: AgentProposalMetadata = {
      ...locked.comment.metadata,
      status: 'applying',
      claimedAt: new Date().toISOString(),
    };
    await writeProposalMetadata(commentId, metadata);
    return { thread: locked.thread, comment: { ...locked.comment, metadata } };
  });
}

/** Puts a claimed proposal back to waiting after its edits could not be made. Anything else is left alone. */
export async function releaseProposal(siteId: string, threadId: string, commentId: string): Promise<void> {
  await transaction(async () => {
    const locked = await lockProposal(siteId, threadId, commentId);
    if (locked?.comment.metadata.status !== 'applying') return;
    await writeProposalMetadata(commentId, { ...locked.comment.metadata, status: 'proposed', claimedAt: undefined });
  });
}

/**
 * Accepts or dismisses an agent's proposal on behalf of whoever is looking at
 * it. A proposal can be dismissed while it waits and accepted while it waits
 * or once its edits are being applied under a claim; a second decision is
 * refused rather than overwriting the first.
 */
export async function decideProposal(
  siteId: string,
  threadId: string,
  commentId: string,
  decision: ProposalDecision,
  actor: ThreadActor,
): Promise<CommentUpdateResult | null> {
  return transaction(async () => {
    const locked = await lockProposal(siteId, threadId, commentId);
    if (locked === null) return null;
    const { thread, comment: current } = locked;
    const { status } = current.metadata;
    if (status === 'applying' && decision === 'dismissed') {
      throw new ThreadInputError('decision', 'This proposal is being applied');
    }
    if (status !== 'proposed' && status !== 'applying') {
      throw new ThreadInputError('decision', `This proposal was already ${status}`);
    }

    const decidedBy = await loadAuthor(actor);
    const metadata: AgentProposalMetadata = {
      ...current.metadata,
      status: decision,
      decidedBy,
      decidedAt: new Date().toISOString(),
      claimedAt: undefined,
    };
    await writeProposalMetadata(commentId, metadata);
    return touchedThread(thread, commentId);
  });
}

export async function getThread(
  siteId: string,
  threadId: string,
): Promise<{ thread: ThreadOverview; comments: StoredComment[] } | null> {
  // One snapshot, so the overview's comment count agrees with the rows returned.
  return transaction(async () => {
    const thread = await loadThread(siteId, threadId);
    if (thread === null) return null;

    const rows = await db().execute<CommentRow>(sql`
      ${COMMENT_SELECT}
      WHERE c.thread_id = ${threadId} AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC, c.id ASC`);
    return { thread, comments: rows.map(toStoredComment) };
  });
}

/**
 * One overview per context: the open thread, else the latest resolved one.
 * Ordered by most recent activity; the cursor is the last row's
 * (updated_at, id) so a page boundary never skips or repeats a thread.
 */
export async function listThreads(siteId: string, options: ThreadListOptions): Promise<ThreadListPage> {
  const filters: SQL[] = [];
  if (options.documentId !== undefined) {
    filters.push(sql`document_id = ${options.documentId}`);
  }
  if (options.status !== 'all') {
    filters.push(sql`status = ${options.status}`);
  }
  const cursor = decodeCursor(options.cursor);
  if (cursor !== null) {
    filters.push(sql`(updated_at, id) < (${cursor.updatedAt}, ${cursor.id})`);
  }
  const where = filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

  // The collapse and the page window touch comment_threads alone; the comment
  // counts in THREAD_SELECT are computed only for the rows being returned.
  const rows = await db().execute<ThreadRow>(sql`
    WITH collapsed AS (
      SELECT DISTINCT ON (t.context_type, t.context_id) t.id, t.document_id, t.status, t.updated_at
      FROM app.comment_threads t
      WHERE t.site_id = ${siteId}
      ORDER BY t.context_type, t.context_id, (t.status = 'open') DESC, t.updated_at DESC
    ),
    page AS (
      SELECT id FROM collapsed
      ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${options.limit + 1}
    )
    ${THREAD_SELECT}
    WHERE t.id IN (SELECT id FROM page)
    ORDER BY t.updated_at DESC, t.id DESC`);

  const threads = rows.slice(0, options.limit).map(toThreadOverview);
  const hasMore = rows.length > options.limit;
  const last = threads[threads.length - 1];
  return {
    threads,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last) : null,
  };
}

/** Every thread ever opened on one object, newest activity first. */
export async function listThreadsForContext(
  siteId: string,
  context: ThreadContextRef,
): Promise<ThreadOverview[]> {
  const rows = await db().execute<ThreadRow>(sql`
    ${THREAD_SELECT}
    WHERE t.site_id = ${siteId} AND t.context_type = ${context.type} AND t.context_id = ${context.id}
    ORDER BY t.updated_at DESC, t.id DESC`);
  return rows.map(toThreadOverview);
}

/**
 * Sets the status; setting the one it already has is a no-op. Returns the
 * thread and who acted, or null when the site has no such thread.
 */
export async function setThreadStatus(
  siteId: string,
  threadId: string,
  status: ThreadStatus,
  actor: ThreadActor,
): Promise<ThreadStatusResult | null> {
  return transaction(async () => {
    const current = await lockThread(siteId, threadId);
    if (current === null) return null;

    const author = await loadAuthor(actor);
    if (current.status === status) {
      return { thread: current, actor: author, changed: false };
    }

    if (status === 'resolved') {
      await db().execute(sql`
        UPDATE app.comment_threads
        SET status = 'resolved', resolved_at = now(), resolved_by_type = ${actor.type},
            resolved_by_id = ${actor.id}, updated_at = now()
        WHERE id = ${threadId}`);
    } else {
      await reopenThread(threadId);
    }

    const thread = await loadThread(siteId, threadId);
    if (thread === null) throw new Error(`Thread ${threadId} vanished mid-transaction`);
    return { thread, actor: author, changed: true };
  });
}

async function assertOwnedTargets(siteId: string, documentId?: string, branchId?: string): Promise<void> {
  if (documentId !== undefined) {
    const owned = await db().execute<{ id: string }>(
      sql`SELECT id FROM app.documents WHERE id = ${documentId} AND site_id = ${siteId}`,
    );
    if (owned.length === 0) {
      throw new ThreadInputError('documentId', 'documentId does not belong to this site');
    }
  }
  if (branchId !== undefined) {
    const owned = await db().execute<{ id: string }>(
      sql`SELECT id FROM app.branches WHERE id = ${branchId} AND site_id = ${siteId}`,
    );
    if (owned.length === 0) {
      throw new ThreadInputError('branchId', 'branchId does not belong to this site');
    }
  }
}

async function findThreadForContext(
  siteId: string,
  context: ThreadContextRef,
): Promise<ThreadOverview | null> {
  const rows = await db().execute<ThreadRow>(sql`
    ${THREAD_SELECT}
    WHERE t.site_id = ${siteId} AND t.context_type = ${context.type} AND t.context_id = ${context.id}
    ORDER BY (t.status = 'open') DESC, t.updated_at DESC
    LIMIT 1
    FOR UPDATE OF t`);
  const row = rows.at(0);
  return row === undefined ? null : toThreadOverview(row);
}

/**
 * The insert yields to a concurrent first-poster: on conflict with the open
 * thread they just committed, nothing is written and that thread is read back.
 */
async function createThread(input: PostCommentInput): Promise<ThreadOverview> {
  const inserted = await db().execute<{ id: string }>(sql`
    INSERT INTO app.comment_threads
      (site_id, context_type, context_id, document_id, branch_id, created_by_type, created_by_id)
    VALUES (${input.siteId}, ${input.context.type}, ${input.context.id}, ${input.documentId ?? null},
            ${input.branchId ?? null}, ${input.actor.type}, ${input.actor.id})
    ON CONFLICT (site_id, context_type, context_id) WHERE status = 'open' DO NOTHING
    RETURNING id`);

  const insertedId = inserted.at(0)?.id;
  const thread =
    insertedId === undefined
      ? await findThreadForContext(input.siteId, input.context)
      : await loadThread(input.siteId, insertedId);
  if (thread === null) throw new Error('Thread insert neither returned nor conflicted');
  return thread;
}

async function appendComment(
  thread: ThreadOverview,
  content: string | CommentContent,
  actor: ThreadActor,
): Promise<CommentWriteResult> {
  const written: CommentContent = typeof content === 'string' ? { kind: 'message', body: content } : content;
  const inserted = await db().execute<{ id: string }>(sql`
    INSERT INTO app.comments (thread_id, kind, body, metadata, author_type, author_id, acting_user_id)
    VALUES (${thread.id}, ${written.kind}, ${written.body}, ${jsonParam(written.metadata)}::jsonb,
            ${actor.type}, ${actor.id}, ${actor.actingUserId ?? null})
    RETURNING id`);
  const commentId = inserted.at(0)?.id;
  if (commentId === undefined) throw new Error('Comment insert returned no row');

  const reopened = thread.status === 'resolved';
  if (reopened) {
    await reopenThread(thread.id);
  } else {
    await touchThread(thread.id);
  }

  const [updatedThread, comment] = await Promise.all([
    loadThread(thread.siteId, thread.id),
    loadComment(commentId),
  ]);
  if (updatedThread === null || comment === null) {
    throw new Error('Comment write could not be read back');
  }
  return { thread: updatedThread, comment, reopened };
}

/** Bumps the thread's activity clock and reads the changed comment back with it. */
async function touchedThread(thread: ThreadOverview, commentId: string): Promise<CommentUpdateResult> {
  await touchThread(thread.id);
  const [updatedThread, comment] = await Promise.all([loadThread(thread.siteId, thread.id), loadComment(commentId)]);
  if (updatedThread === null || comment === null) {
    throw new Error('Comment update could not be read back');
  }
  return { thread: updatedThread, comment };
}

async function touchThread(threadId: string): Promise<void> {
  await db().execute(sql`UPDATE app.comment_threads SET updated_at = now() WHERE id = ${threadId}`);
}

/**
 * The handle's client sends an object parameter as text, which jsonb rejects;
 * the value is serialised here and cast by the statement.
 */
function jsonParam(value: unknown): string | null {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : null;
}

async function reopenThread(threadId: string): Promise<void> {
  await db().execute(sql`
    UPDATE app.comment_threads
    SET status = 'open', resolved_at = NULL, resolved_by_type = NULL, resolved_by_id = NULL,
        updated_at = now()
    WHERE id = ${threadId}`);
}

async function loadThread(siteId: string, threadId: string): Promise<ThreadOverview | null> {
  const rows = await db().execute<ThreadRow>(
    sql`${THREAD_SELECT} WHERE t.site_id = ${siteId} AND t.id = ${threadId}`,
  );
  const row = rows.at(0);
  return row === undefined ? null : toThreadOverview(row);
}

/** Like loadThread, but holds the row for the rest of the transaction. */
async function lockThread(siteId: string, threadId: string): Promise<ThreadOverview | null> {
  const rows = await db().execute<ThreadRow>(
    sql`${THREAD_SELECT} WHERE t.site_id = ${siteId} AND t.id = ${threadId} FOR UPDATE OF t`,
  );
  const row = rows.at(0);
  return row === undefined ? null : toThreadOverview(row);
}

/** Like loadComment, scoped to its thread and held for the rest of the transaction. */
async function lockComment(threadId: string, commentId: string): Promise<StoredComment | null> {
  const rows = await db().execute<CommentRow>(sql`
    ${COMMENT_SELECT}
    WHERE c.id = ${commentId} AND c.thread_id = ${threadId} AND c.deleted_at IS NULL
    FOR UPDATE OF c`);
  const row = rows.at(0);
  return row === undefined ? null : toStoredComment(row);
}

async function loadComment(commentId: string): Promise<StoredComment | null> {
  const rows = await db().execute<CommentRow>(sql`${COMMENT_SELECT} WHERE c.id = ${commentId}`);
  const row = rows.at(0);
  return row === undefined ? null : toStoredComment(row);
}

async function loadAuthor(actor: ThreadActor): Promise<CommentAuthor> {
  const rows =
    actor.type === 'user'
      ? await db().execute<AuthorRow>(
        sql`SELECT name, avatar_url AS avatar FROM app.users WHERE id = ${actor.id}`,
      )
      : await db().execute<AuthorRow>(sql`SELECT name, NULL AS avatar FROM app.agents WHERE id = ${actor.id}`);
  const row = rows.at(0);
  return { type: actor.type, id: actor.id, name: row?.name ?? null, avatar: row?.avatar ?? null };
}

/**
 * Who a comment is attributed to. An agent acting for a user names that user
 * by email in its headers; the row is looked up so the comment can carry the
 * user's id rather than a string that goes stale.
 */
export async function toThreadActor(
  principal: Pick<AuthenticatedPrincipal, 'type' | 'id' | 'dbUserId' | 'actingUserEmail'>,
): Promise<ThreadActor | null> {
  if (principal.type === 'user') {
    return { type: 'user', id: principal.dbUserId ?? principal.id };
  }
  if (principal.type !== 'agent') {
    return null;
  }

  const email = principal.actingUserEmail?.trim().toLowerCase();
  if (email === undefined || email === '') {
    return { type: 'agent', id: principal.id };
  }
  const rows = await db().execute<{ id: string }>(
    sql`SELECT id FROM app.users WHERE email = ${email} AND is_active = true`,
  );
  return { type: 'agent', id: principal.id, actingUserId: rows.at(0)?.id };
}
