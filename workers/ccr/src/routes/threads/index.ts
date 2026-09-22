/**
 * /api/sites/{siteId}/threads and /api/sites/{siteId}/contexts/{type}/{id}/threads.
 *
 * Reading needs canView; posting, replying, changing status and deciding a
 * proposal need canComment, and accepting one also needs canEditDocuments on
 * the page it edits. An agent may also rewrite a comment of its own.
 * Reporting an unanswered mention needs only canView, because a reader with
 * no more than that still sees the thread say the agent never replied.
 * Each endpoint is its own small function behind one gate so the
 * set maps onto a router's per-route handlers when one arrives.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import { assertPermission, AuthorizationError } from '../../auth/authorization';
import { getMainBranch } from '../../services/branch-service';
import {
  claimProposal,
  decideProposal,
  getThread,
  listThreads,
  listThreadsForContext,
  postComment,
  releaseProposal,
  replyToThread,
  setThreadStatus,
  toThreadActor,
  updateComment,
  type CommentWriteResult,
} from '../../services/threads/threads-service';
import { ThreadForbiddenError, ThreadInputError } from '../../services/threads/errors';
import { hydrateComment, hydrateComments, resolveMentions, withMentions } from '../../services/threads/mentions-service';
import type { SiteMembers } from '../../services/site-members-service';
import type { RolePermissions } from '../../types';
import type {
  Comment,
  CommentResponse,
  ContextThreadsResponse,
  ThreadActor,
  PostCommentResponse,
  ThreadListResponse,
  ThreadOverview,
  ThreadResponse,
  ThreadStatusResponse,
} from '../../types/threads';
import { errorResponse, jsonResponse, NO_STORE_HEADERS } from '../../utils/http-helpers';
import { isUuid } from '../../utils/uuid';
import { validateBody, validateQuery, validationErrorResponse } from '../validation/request-validation';
import { requesterFor } from './agent-notifications';
import { emitThreadEvent } from './events';
import { applyAcceptedProposal } from './proposal-edits';
import type { ThreadsRouteContext } from './types';
import {
  contextTypeSchema,
  decideProposalSchema,
  listThreadsQuerySchema,
  postCommentSchema,
  postThreadSchema,
  reportUnansweredMentionSchema,
  setThreadStatusSchema,
  siteContextMismatch,
  updateCommentSchema,
} from './validation';

export type * from './types';
export { emitThreadEvent } from './events';

interface Endpoint {
  permission: keyof RolePermissions;
  handle: (request: Request, context: ThreadsRouteContext, startedAt: number) => Promise<Response>;
}

export async function handleThreadRoutes(
  request: Request,
  context: ThreadsRouteContext,
): Promise<Response> {
  const startedAt = Date.now();

  try {
    if (context.siteId === '') {
      return errorResponse('Site ID is required', 400);
    }

    const endpoint = selectEndpoint(request.method, context);
    if (endpoint === null) {
      return errorResponse('Method not allowed', 405);
    }

    // Permissions are branch-scoped; a site's main branch is the one every
    // member can see, so it stands in for the site.
    const mainBranch = await getMainBranch(context.siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }
    await assertPermission(
      context.principal,
      context.siteId,
      mainBranch.id,
      endpoint.permission,
      context.masClient,
    );

    return await endpoint.handle(request, context, startedAt);
  } catch (error) {
    return failureResponse(error, context, startedAt);
  }
}

function selectEndpoint(method: string, context: ThreadsRouteContext): Endpoint | null {
  if (context.contextType !== undefined) {
    return method === 'GET' ? { permission: 'canView', handle: listContextThreads } : null;
  }
  if (context.threadId === undefined) {
    if (method === 'GET') return { permission: 'canView', handle: listSiteThreads };
    if (method === 'POST') return { permission: 'canComment', handle: postThread };
    return null;
  }
  switch (context.subResource) {
    case undefined:
      return method === 'GET' ? { permission: 'canView', handle: getThreadById } : null;
    case 'comments':
      if (context.commentId === undefined) {
        return method === 'POST' ? { permission: 'canComment', handle: postThreadComment } : null;
      }
      if (context.commentAction === undefined) {
        return method === 'PUT' ? { permission: 'canComment', handle: putComment } : null;
      }
      return method === 'PUT' ? { permission: 'canComment', handle: putProposalDecision } : null;
    case 'status':
      return method === 'PUT' ? { permission: 'canComment', handle: putThreadStatus } : null;
    case 'unanswered-mentions':
      return method === 'POST' ? { permission: 'canView', handle: postUnansweredMention } : null;
    default:
      return null;
  }
}

async function postThread(
  request: Request,
  context: ThreadsRouteContext,
  startedAt: number,
): Promise<Response> {
  const input = validateBody(postThreadSchema, await readJsonBody(request));
  const mismatch = siteContextMismatch(input, context.siteId);
  if (mismatch !== null) {
    return errorResponse(mismatch, 400, { 'context.id': [mismatch] });
  }
  const actor = await requireActor(context);
  const roster = await resolveMentions(context.siteId, input.body, context.masClient);

  const write = await postComment({ siteId: context.siteId, actor, ...input });
  return commentPostedResponse(write, roster, context, startedAt);
}

async function postThreadComment(
  request: Request,
  context: ThreadsRouteContext,
  startedAt: number,
): Promise<Response> {
  const threadId = requireThreadId(context);
  if (threadId === null) return threadNotFound();

  const input = validateBody(postCommentSchema, await readJsonBody(request));
  const actor = await requireActor(context);
  requireAgentForKind(input.kind, actor);
  const roster = await resolveMentions(context.siteId, input.body, context.masClient);

  const write = await replyToThread(context.siteId, threadId, input.kind === 'message' ? input.body : input, actor);
  if (write === null) return threadNotFound();
  return commentPostedResponse(write, roster, context, startedAt);
}

async function putComment(
  request: Request,
  context: ThreadsRouteContext,
  startedAt: number,
): Promise<Response> {
  const ids = requireCommentIds(context);
  if (ids === null) return commentNotFound();

  const input = validateBody(updateCommentSchema, await readJsonBody(request));
  const actor = await requireActor(context);
  requireAgentForKind(input.kind, actor);
  const roster = await resolveMentions(context.siteId, input.body, context.masClient);

  const result = await updateComment(context.siteId, ids.threadId, ids.commentId, input, actor);
  if (result === null) return commentNotFound();
  const comment = withMentions(result.comment, roster);
  return commentUpdatedResponse(result.thread, comment, context, startedAt, 'comment updated');
}

async function putProposalDecision(
  request: Request,
  context: ThreadsRouteContext,
  startedAt: number,
): Promise<Response> {
  const ids = requireCommentIds(context);
  if (ids === null) return commentNotFound();

  const input = validateBody(decideProposalSchema, await readJsonBody(request));
  const actor = await requireActor(context);

  if (input.decision === 'accepted') {
    const claimed = await claimProposal(context.siteId, ids.threadId, ids.commentId);
    if (claimed === null) return commentNotFound();
    try {
      await applyAcceptedProposal(context, claimed.thread, claimed.comment);
    } catch (error) {
      await releaseClaim(context.siteId, ids.threadId, ids.commentId);
      throw error;
    }
  }

  const result = await decideProposal(context.siteId, ids.threadId, ids.commentId, input.decision, actor);
  if (result === null) return commentNotFound();
  const comment = await hydrateComment(context.siteId, result.comment, context.masClient);
  return commentUpdatedResponse(result.thread, comment, context, startedAt, 'proposal decided');
}

/** The apply failed and is being reported; a release that fails too is logged rather than replacing that report. */
async function releaseClaim(siteId: string, threadId: string, commentId: string): Promise<void> {
  try {
    await releaseProposal(siteId, threadId, commentId);
  } catch (error) {
    getLogger().error('proposal claim could not be released', error, { siteId, threadId, commentId });
  }
}

async function getThreadById(
  _request: Request,
  context: ThreadsRouteContext,
  startedAt: number,
): Promise<Response> {
  const threadId = requireThreadId(context);
  if (threadId === null) return threadNotFound();

  const result = await getThread(context.siteId, threadId);
  if (result === null) return threadNotFound();

  const comments = await hydrateComments(context.siteId, result.comments, context.masClient);
  const body: ThreadResponse = { thread: result.thread, comments };

  getLogger().info('thread served', {
    site_id: context.siteId,
    thread_id: threadId,
    context_type: result.thread.context.type,
    comment_count: comments.length,
    duration_ms: Date.now() - startedAt,
    outcome: 'ok',
  });
  return jsonResponse(body, 200, NO_STORE_HEADERS);
}

async function listSiteThreads(
  request: Request,
  context: ThreadsRouteContext,
  startedAt: number,
): Promise<Response> {
  const options = validateQuery(listThreadsQuerySchema, new URL(request.url).searchParams);
  const page = await listThreads(context.siteId, options);
  const body: ThreadListResponse = page;

  getLogger().info('threads listed', {
    site_id: context.siteId,
    thread_count: page.threads.length,
    duration_ms: Date.now() - startedAt,
    outcome: 'ok',
  });
  return jsonResponse(body, 200, NO_STORE_HEADERS);
}

async function listContextThreads(
  _request: Request,
  context: ThreadsRouteContext,
  startedAt: number,
): Promise<Response> {
  const parsedType = contextTypeSchema.safeParse(context.contextType);
  if (!parsedType.success) {
    return errorResponse(`Unknown context type: ${context.contextType ?? ''}`, 400);
  }
  const contextId = context.contextId ?? '';
  if (contextId === '') {
    return errorResponse('Context ID is required', 400);
  }

  const threads = await listThreadsForContext(context.siteId, { type: parsedType.data, id: contextId });
  const body: ContextThreadsResponse = { threads };

  getLogger().info('threads listed', {
    site_id: context.siteId,
    context_type: parsedType.data,
    thread_count: threads.length,
    duration_ms: Date.now() - startedAt,
    outcome: 'ok',
  });
  return jsonResponse(body, 200, NO_STORE_HEADERS);
}

async function putThreadStatus(
  request: Request,
  context: ThreadsRouteContext,
  startedAt: number,
): Promise<Response> {
  const threadId = requireThreadId(context);
  if (threadId === null) return threadNotFound();

  const input = validateBody(setThreadStatusSchema, await readJsonBody(request));
  const actor = await requireActor(context);

  const result = await setThreadStatus(context.siteId, threadId, input.status, actor);
  if (result === null) return threadNotFound();

  if (result.changed) {
    emitThreadEvent(context.ctx, context.env, {
      type: 'thread_status_changed',
      siteId: context.siteId,
      thread: result.thread,
      actor: result.actor,
    });
  }

  getLogger().info('thread status changed', {
    site_id: context.siteId,
    thread_id: threadId,
    context_type: result.thread.context.type,
    status: result.thread.status,
    changed: result.changed,
    duration_ms: Date.now() - startedAt,
    outcome: 'ok',
  });
  const body: ThreadStatusResponse = { thread: result.thread };
  return jsonResponse(body, 200, NO_STORE_HEADERS);
}

/**
 * A reader waited for a mentioned agent and it never spoke. Nothing is stored: the
 * point is the count, and a reader with nothing but view rights still sees the line.
 */
async function postUnansweredMention(
  request: Request,
  context: ThreadsRouteContext,
  startedAt: number,
): Promise<Response> {
  const threadId = requireThreadId(context);
  if (threadId === null) return threadNotFound();

  const body = await readJsonBody(request);
  let input;
  try {
    input = validateBody(reportUnansweredMentionSchema, body);
  } catch (error) {
    // Without this the count reads zero whether no agent failed or every report was
    // refused, and zero is the one answer this endpoint must not give ambiguously.
    getLogger().warn('agent mention report rejected', {
      site_id: context.siteId,
      thread_id: threadId,
      reason: 'invalid_report',
      duration_ms: Date.now() - startedAt,
    });
    throw error;
  }

  getLogger().warn('agent mention unanswered', {
    site_id: context.siteId,
    thread_id: threadId,
    comment_id: input.commentId,
    agent_id: input.agentId,
    age_ms: input.elapsedMs,
    reason: 'no_agent_response',
    duration_ms: Date.now() - startedAt,
  });
  return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
}

function commentPostedResponse(
  write: CommentWriteResult,
  roster: SiteMembers | null,
  context: ThreadsRouteContext,
  startedAt: number,
): Response {
  const comment = withMentions(write.comment, roster);

  emitThreadEvent(context.ctx, context.env, {
    type: 'comment_posted',
    siteId: context.siteId,
    thread: write.thread,
    comment,
    requester: requesterFor(comment, roster),
  });

  getLogger().info('comment posted', {
    site_id: context.siteId,
    thread_id: write.thread.id,
    comment_id: comment.id,
    context_type: write.thread.context.type,
    mention_count: comment.mentions.length,
    reopened: write.reopened,
    duration_ms: Date.now() - startedAt,
    outcome: 'ok',
  });

  const body: PostCommentResponse = { thread: write.thread, comment };
  return jsonResponse(body, 201, NO_STORE_HEADERS);
}

function commentUpdatedResponse(
  thread: ThreadOverview,
  comment: Comment,
  context: ThreadsRouteContext,
  startedAt: number,
  message: string,
): Response {
  emitThreadEvent(context.ctx, context.env, {
    type: 'comment_updated',
    siteId: context.siteId,
    thread,
    comment,
  });

  getLogger().info(message, {
    site_id: context.siteId,
    thread_id: thread.id,
    comment_id: comment.id,
    context_type: thread.context.type,
    kind: comment.kind,
    duration_ms: Date.now() - startedAt,
    outcome: 'ok',
  });

  const body: CommentResponse = { thread, comment };
  return jsonResponse(body, 200, NO_STORE_HEADERS);
}

/** The working line and the proposal are an agent's to write; people write plain comments. */
function requireAgentForKind(kind: string, actor: ThreadActor): void {
  if (kind !== 'message' && actor.type !== 'agent') {
    throw new AuthorizationError(`Only an agent can post a comment of kind ${kind}`, 'canComment', 'NO_ACCESS');
  }
}

async function requireActor(context: ThreadsRouteContext): Promise<ThreadActor> {
  const actor = await toThreadActor(context.principal);
  if (actor === null) {
    throw new AuthorizationError('Only users and agents can take part in threads', 'canComment', 'NO_ACCESS');
  }
  return actor;
}

/** A malformed id is a 404, not a database error: the thread it names cannot exist. */
function requireThreadId(context: ThreadsRouteContext): string | null {
  const threadId = context.threadId ?? '';
  return isUuid(threadId) ? threadId : null;
}

function requireCommentIds(context: ThreadsRouteContext): { threadId: string; commentId: string } | null {
  const threadId = requireThreadId(context);
  const commentId = context.commentId ?? '';
  return threadId !== null && isUuid(commentId) ? { threadId, commentId } : null;
}

function threadNotFound(): Response {
  return errorResponse('Thread not found', 404);
}

function commentNotFound(): Response {
  return errorResponse('Comment not found', 404);
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function failureResponse(error: unknown, context: ThreadsRouteContext, startedAt: number): Response {
  const validationFailure = validationErrorResponse(error);
  if (validationFailure !== null) return validationFailure;

  if (error instanceof ThreadInputError) {
    return errorResponse(error.message, 400, { [error.field]: error.details });
  }

  if (error instanceof ThreadForbiddenError) {
    return errorResponse(error.message, 403);
  }

  if (error instanceof AuthorizationError) {
    getLogger().info('threads denied', {
      site_id: context.siteId,
      thread_id: context.threadId,
      principal_type: context.principal.type,
      duration_ms: Date.now() - startedAt,
      outcome: 'denied',
    });
    return errorResponse(error.message, 403);
  }

  getLogger().error('threads route failed', error, {
    site_id: context.siteId,
    thread_id: context.threadId,
    duration_ms: Date.now() - startedAt,
    outcome: 'error',
  });
  return errorResponse('Internal server error', 500);
}
