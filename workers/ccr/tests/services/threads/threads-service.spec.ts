/**
 * The threads service against a stubbed database: how inputs become SQL
 * parameters, and the branches that never touch a row. Real-row behaviour
 * (locking, collapse, paging) is under tests/db.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ThreadForbiddenError,
  ThreadInputError,
  claimProposal,
  decideProposal,
  getThread,
  releaseProposal,
  listThreads,
  postComment,
  toThreadActor,
  updateComment,
} from '../../../src/services/threads/threads-service';
import type { CommentRow, ThreadRow } from '../../../src/services/threads/rows';
import { commentThreads, comments, documents, users } from '../../../src/db/schema';
import { stubDatabase, type DatabaseStub, type RecordedCall } from '../../__stubs__/database';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const THREAD_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

let stub: DatabaseStub;

function lastStatement(): RecordedCall {
  const call = stub.statements.at(-1);
  if (call === undefined) throw new Error('no statement ran');
  return call;
}

beforeEach(() => {
  stub = stubDatabase();
});

describe('listThreads', () => {
  it('asks for one row past the limit so the cursor is only set when a next page exists', async () => {
    await listThreads(SITE_ID, { status: 'all', limit: 100 });

    const { sql, params } = lastStatement();
    expect(params).toEqual([SITE_ID, 101]);
    expect(sql).not.toContain('WHERE document_id');
    expect(sql).toContain('DISTINCT ON (t.context_type, t.context_id)');
  });

  it('filters by document and status after the per-context collapse', async () => {
    await listThreads(SITE_ID, { documentId: DOCUMENT_ID, status: 'open', limit: 10 });

    const { sql, params } = lastStatement();
    expect(params).toEqual([SITE_ID, DOCUMENT_ID, 'open', 11]);
    expect(sql).toMatch(/collapsed\s+WHERE document_id = \$2 AND status = \$3/);
  });

  it('turns a valid cursor into a keyset bound on (updated_at, id)', async () => {
    const cursor = btoa(`2026-09-12T10:00:00.000Z|${THREAD_ID}`);

    await listThreads(SITE_ID, { status: 'all', limit: 10, cursor });

    const { sql, params } = lastStatement();
    expect(params).toEqual([SITE_ID, '2026-09-12T10:00:00.000Z', THREAD_ID, 11]);
    expect(sql).toContain('(updated_at, id) < ($2, $3)');
  });

  it('ignores a cursor that is not base64, lacks a separator, or names a non-uuid', async () => {
    for (const cursor of ['%%%not-base64%%%', btoa('no-separator'), btoa('2026-09-12T10:00:00.000Z|nope')]) {
      await listThreads(SITE_ID, { status: 'all', limit: 10, cursor });
      expect(lastStatement().params).toEqual([SITE_ID, 11]);
    }
  });

  it('returns a cursor built from the last row only when a further row came back', async () => {
    const row = (id: string, updatedAt: string) => ({
      id,
      site_id: SITE_ID,
      context_type: 'block',
      context_id: `Hero-${id.slice(0, 4)}`,
      document_id: DOCUMENT_ID,
      status: 'open',
      comment_count: 1,
      last_comment_at: updatedAt,
      created_at: updatedAt,
      updated_at: updatedAt,
      resolved_at: null,
      resolved_by_type: null,
      resolved_by_id: null,
      resolved_by_name: null,
      resolved_by_avatar: null,
    });
    stub.on(commentThreads).select.returnsRaw([
      row('aaaaaaaa-0000-4000-8000-000000000001', '2026-09-12T12:00:00.000Z'),
      row('aaaaaaaa-0000-4000-8000-000000000002', '2026-09-12T11:00:00.000Z'),
      row('aaaaaaaa-0000-4000-8000-000000000003', '2026-09-12T10:00:00.000Z'),
    ]);

    const page = await listThreads(SITE_ID, { status: 'all', limit: 2 });

    expect(page.threads).toHaveLength(2);
    expect(page.nextCursor).toBe(btoa('2026-09-12T11:00:00.000Z|aaaaaaaa-0000-4000-8000-000000000002'));
  });
});

describe('getThread', () => {
  it('reads the overview and the comments in one transaction', async () => {
    await getThread(SITE_ID, THREAD_ID);

    expect(stub.transaction.opened).toBe(1);
    expect(stub.statements).toHaveLength(1);
  });
});

describe('postComment', () => {
  it('refuses a document that belongs to another site before opening a transaction', async () => {
    await expect(
      postComment({
        siteId: SITE_ID,
        context: { type: 'block', id: 'Hero-1' },
        documentId: DOCUMENT_ID,
        body: 'hi',
        actor: { type: 'user', id: USER_ID },
      }),
    ).rejects.toMatchObject({ field: 'documentId' } satisfies Partial<ThreadInputError>);

    expect(lastStatement().params).toEqual([DOCUMENT_ID, SITE_ID]);
    expect(stub.transaction.opened).toBe(0);
  });

  it('refuses a branch that belongs to another site', async () => {
    stub.on(documents).select.returns([{ id: DOCUMENT_ID }]);

    await expect(
      postComment({
        siteId: SITE_ID,
        context: { type: 'block', id: 'Hero-1' },
        documentId: DOCUMENT_ID,
        branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
        body: 'hi',
        actor: { type: 'user', id: USER_ID },
      }),
    ).rejects.toBeInstanceOf(ThreadInputError);
  });
});

const COMMENT_ID = '66666666-6666-4666-8666-666666666666';
const AGENT_ID = '77777777-7777-4777-8777-777777777777';

const threadRow: ThreadRow = {
  id: THREAD_ID,
  site_id: SITE_ID,
  context_type: 'block',
  context_id: 'Hero-1',
  document_id: DOCUMENT_ID,
  branch_id: null,
  status: 'open',
  comment_count: 2,
  last_comment_at: '2026-09-13T10:00:00.000Z',
  created_at: '2026-09-13T09:00:00.000Z',
  updated_at: '2026-09-13T10:00:00.000Z',
  resolved_at: null,
  resolved_by_type: null,
  resolved_by_id: null,
  resolved_by_name: null,
  resolved_by_avatar: null,
};

function commentRow(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: COMMENT_ID,
    thread_id: THREAD_ID,
    kind: 'agent_activity',
    body: 'Looking into it',
    metadata: { status: 'working' },
    author_type: 'agent',
    author_id: AGENT_ID,
    author_name: 'Copy Editor',
    author_avatar: null,
    acting_user_id: USER_ID,
    acting_user_name: 'Ada Lovelace',
    created_at: '2026-09-13T10:00:00.000Z',
    edited_at: null,
    ...overrides,
  };
}

const proposal = {
  status: 'proposed' as const,
  summary: 'Shorten the headline',
  operations: [{ op: 'replace' as const, path: 'content.0.props.title', value: 'Hello' }],
};

const agentActor = { type: 'agent' as const, id: AGENT_ID, actingUserId: USER_ID };

/** The thread lock answers with the thread, the comment lock with `locked`; the read-back with `after`. */
function lockBoth(locked: CommentRow, after: CommentRow = locked): void {
  stub.on(commentThreads).select.returnsRaw([threadRow]);
  stub.on(comments).select.whenAsking(/FOR UPDATE OF c/).returnsRaw([locked]);
  stub.on(comments).select.returnsRaw([after]);
}

function updateStatements(): RecordedCall[] {
  return stub.calls(comments).update;
}

describe('updateComment', () => {
  it('rewrites the working line in place without calling it an edit', async () => {
    const answer = commentRow({ kind: 'agent_proposal', body: 'Try this', metadata: proposal });
    lockBoth(commentRow(), answer);

    const result = await updateComment(
      SITE_ID,
      THREAD_ID,
      COMMENT_ID,
      { kind: 'agent_proposal', body: 'Try this', metadata: proposal },
      agentActor,
    );

    const [update] = updateStatements();
    expect(update.sql).not.toContain('edited_at');
    expect(update.params).toEqual(['agent_proposal', 'Try this', JSON.stringify(proposal), COMMENT_ID]);
    expect(result?.comment).toMatchObject({ kind: 'agent_proposal', metadata: { summary: 'Shorten the headline' } });
  });

  it('marks a changed comment as edited and stores no metadata for it', async () => {
    lockBoth(commentRow({ kind: 'message', metadata: null, author_type: 'user', author_id: USER_ID }));

    await updateComment(SITE_ID, THREAD_ID, COMMENT_ID, { kind: 'message', body: 'Fixed typo' }, {
      type: 'user',
      id: USER_ID,
    });

    const [update] = updateStatements();
    expect(update.sql).toContain('edited_at = now()');
    expect(update.params).toEqual(['message', 'Fixed typo', null, COMMENT_ID]);
  });

  it('refuses anyone but the author before writing', async () => {
    lockBoth(commentRow());

    await expect(
      updateComment(SITE_ID, THREAD_ID, COMMENT_ID, { kind: 'message', body: 'Mine now' }, { type: 'user', id: USER_ID }),
    ).rejects.toBeInstanceOf(ThreadForbiddenError);

    expect(updateStatements()).toEqual([]);
  });

  it('refuses to rewrite a proposal once it has been decided or is being applied', async () => {
    for (const status of ['accepted', 'dismissed', 'applying'] as const) {
      stub = stubDatabase();
      lockBoth(commentRow({ kind: 'agent_proposal', body: 'Try this', metadata: { ...proposal, status } }));

      await expect(
        updateComment(
          SITE_ID,
          THREAD_ID,
          COMMENT_ID,
          { kind: 'agent_proposal', body: 'Try this instead', metadata: proposal },
          agentActor,
        ),
      ).rejects.toMatchObject({ field: 'kind' } satisfies Partial<ThreadInputError>);
      expect(updateStatements()).toEqual([]);
    }
  });

  it('returns null when the comment is not in the thread', async () => {
    stub.on(commentThreads).select.returnsRaw([threadRow]);

    await expect(
      updateComment(SITE_ID, THREAD_ID, COMMENT_ID, { kind: 'message', body: 'x' }, agentActor),
    ).resolves.toBeNull();
    expect(lastStatement().params).toEqual([COMMENT_ID, THREAD_ID]);
  });
});

describe('decideProposal', () => {
  it('records the decision, who made it, and when, keeping the proposal itself', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', body: 'Try this', metadata: proposal }));
    stub.on(users).select.returnsRaw([{ name: 'Ada Lovelace', avatar: null }]);

    await decideProposal(SITE_ID, THREAD_ID, COMMENT_ID, 'accepted', { type: 'user', id: USER_ID });

    const [update] = updateStatements();
    expect(update.params[1]).toBe(COMMENT_ID);
    expect(JSON.parse(update.params[0] as string)).toMatchObject({
      status: 'accepted',
      summary: 'Shorten the headline',
      operations: proposal.operations,
      decidedBy: { type: 'user', id: USER_ID, name: 'Ada Lovelace', avatar: null },
      decidedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('refuses a comment that is not a proposal', async () => {
    lockBoth(commentRow());

    await expect(
      decideProposal(SITE_ID, THREAD_ID, COMMENT_ID, 'dismissed', { type: 'user', id: USER_ID }),
    ).rejects.toMatchObject({ field: 'decision' } satisfies Partial<ThreadInputError>);
    expect(updateStatements()).toEqual([]);
  });

  it('refuses a second decision instead of overwriting the first', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', metadata: { ...proposal, status: 'dismissed' } }));

    await expect(
      decideProposal(SITE_ID, THREAD_ID, COMMENT_ID, 'accepted', { type: 'user', id: USER_ID }),
    ).rejects.toThrow(/already dismissed/);
    expect(updateStatements()).toEqual([]);
  });

  it('accepts a proposal under a claim and drops the claim from the record', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', metadata: { ...proposal, status: 'applying', claimedAt: '2026-09-13T10:00:00.000Z' } }));
    stub.on(users).select.returnsRaw([{ name: 'Ada Lovelace', avatar: null }]);

    await decideProposal(SITE_ID, THREAD_ID, COMMENT_ID, 'accepted', { type: 'user', id: USER_ID });

    const [update] = updateStatements();
    const written = JSON.parse(update.params[0] as string) as Record<string, unknown>;
    expect(written.status).toBe('accepted');
    expect(written).not.toHaveProperty('claimedAt');
  });

  it('will not dismiss a proposal while its edits are being applied', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', metadata: { ...proposal, status: 'applying', claimedAt: '2026-09-13T10:00:00.000Z' } }));

    await expect(
      decideProposal(SITE_ID, THREAD_ID, COMMENT_ID, 'dismissed', { type: 'user', id: USER_ID }),
    ).rejects.toThrow(/being applied/);
    expect(updateStatements()).toEqual([]);
  });
});

describe('claimProposal', () => {
  const recently = new Date(Date.now() - 5_000).toISOString();
  const longAgo = new Date(Date.now() - 5 * 60_000).toISOString();

  it('marks a waiting proposal as applying and hands it back under the claim', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', metadata: proposal }));

    const claimed = await claimProposal(SITE_ID, THREAD_ID, COMMENT_ID);

    const [update] = updateStatements();
    expect(update.params[1]).toBe(COMMENT_ID);
    expect(JSON.parse(update.params[0] as string)).toMatchObject({
      status: 'applying',
      operations: proposal.operations,
      claimedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(claimed?.comment.metadata).toMatchObject({ status: 'applying' });
    expect(claimed?.thread.id).toBe(THREAD_ID);
  });

  it('refuses while another accept holds the claim', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', metadata: { ...proposal, status: 'applying', claimedAt: recently } }));

    await expect(claimProposal(SITE_ID, THREAD_ID, COMMENT_ID)).rejects.toThrow(/being applied/);
    expect(updateStatements()).toEqual([]);
  });

  it('takes over a claim left behind by an accept that never finished', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', metadata: { ...proposal, status: 'applying', claimedAt: longAgo } }));

    await expect(claimProposal(SITE_ID, THREAD_ID, COMMENT_ID)).resolves.toMatchObject({
      comment: { metadata: { status: 'applying' } },
    });
    expect(updateStatements()).toHaveLength(1);
  });

  it('refuses a decided proposal and a comment that is not a proposal', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', metadata: { ...proposal, status: 'accepted' } }));
    await expect(claimProposal(SITE_ID, THREAD_ID, COMMENT_ID)).rejects.toThrow(/already accepted/);

    stub = stubDatabase();
    lockBoth(commentRow());
    await expect(claimProposal(SITE_ID, THREAD_ID, COMMENT_ID)).rejects.toMatchObject({
      field: 'decision',
    } satisfies Partial<ThreadInputError>);
    expect(updateStatements()).toEqual([]);
  });
});

describe('releaseProposal', () => {
  it('puts a claimed proposal back to waiting without the claim', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', metadata: { ...proposal, status: 'applying', claimedAt: '2026-09-13T10:00:00.000Z' } }));

    await releaseProposal(SITE_ID, THREAD_ID, COMMENT_ID);

    const [update] = updateStatements();
    expect(JSON.parse(update.params[0] as string)).toEqual(proposal);
  });

  it('leaves a proposal alone unless it is being applied', async () => {
    lockBoth(commentRow({ kind: 'agent_proposal', metadata: { ...proposal, status: 'accepted' } }));

    await releaseProposal(SITE_ID, THREAD_ID, COMMENT_ID);

    expect(updateStatements()).toEqual([]);
  });
});

describe('toThreadActor', () => {
  it('names a user by their database id, falling back to the principal id', async () => {
    await expect(toThreadActor({ type: 'user', id: 'principal', dbUserId: USER_ID })).resolves.toEqual({
      type: 'user',
      id: USER_ID,
    });
    await expect(toThreadActor({ type: 'user', id: USER_ID })).resolves.toEqual({
      type: 'user',
      id: USER_ID,
    });
    expect(stub.statements).toEqual([]);
  });

  it('records the user an agent acts for when their email matches an active account', async () => {
    stub.on(users).select.returns([{ id: USER_ID }]);

    const actor = await toThreadActor({
      type: 'agent',
      id: 'agent-1',
      actingUserEmail: '  Ada@Example.com ',
    });

    expect(actor).toEqual({ type: 'agent', id: 'agent-1', actingUserId: USER_ID });
    expect(lastStatement().params).toEqual(['ada@example.com']);
  });

  it('leaves the acting user unset when the agent names nobody or nobody matches', async () => {
    await expect(toThreadActor({ type: 'agent', id: 'agent-1' })).resolves.toEqual({
      type: 'agent',
      id: 'agent-1',
    });
    expect(stub.statements).toEqual([]);

    const unmatched = await toThreadActor({ type: 'agent', id: 'agent-1', actingUserEmail: 'x@y.z' });
    expect(unmatched).toEqual({ type: 'agent', id: 'agent-1', actingUserId: undefined });
  });

  it('gives a service principal no actor', async () => {
    await expect(toThreadActor({ type: 'service', id: 'sat_1' })).resolves.toBeNull();
  });
});
