/**
 * /api/sites/{siteId}/threads and /api/sites/{siteId}/contexts/{type}/{id}/threads.
 *
 * Reading needs canView; posting, replying and changing status need
 * canComment. Each endpoint is its own small function behind one gate so the
 * set maps onto a router's per-route handlers when one arrives.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import { assertPermission, AuthorizationError } from '../../auth/authorization';
import { getMainBranch } from '../../services/branch-service';
import {
  getThread,
  listThreads,
  listThreadsForContext,
  postComment,
  replyToThread,
  setThreadStatus,
  toThreadActor,
  type CommentWriteResult,
} from '../../services/threads/threads-service';
import { ThreadInputError } from '../../services/threads/errors';
import { hydrateComments, resolveMentions, withMentions } from '../../services/threads/mentions-service';
import type { SiteMembers } from '../../services/site-members-service';
import type { RolePermissions } from '../../types';
import type {
  ContextThreadsResponse,
  ThreadActor,
  PostCommentResponse,
  ThreadListResponse,
  ThreadResponse,
  ThreadStatusResponse,
} from '../../types/threads';
import { errorResponse, jsonResponse, NO_STORE_HEADERS } from '../../utils/http-helpers';
import { isUuid } from '../../utils/uuid';
import { validateBody, validateQuery, validationErrorResponse } from '../validation/request-validation';
import { requesterFor } from './agent-notifications';
import { emitThreadEvent } from './events';
import type { ThreadsRouteContext } from './types';
import {
  contextTypeSchema,
  listThreadsQuerySchema,
  postCommentSchema,
  postThreadSchema,
  setThreadStatusSchema,
  siteContextMismatch,
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
      return method === 'POST' ? { permission: 'canComment', handle: postThreadComment } : null;
    case 'status':
      return method === 'PUT' ? { permission: 'canComment', handle: putThreadStatus } : null;
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
  const roster = await resolveMentions(context.siteId, input.body, context.masClient);

  const write = await replyToThread(context.siteId, threadId, input.body, actor);
  if (write === null) return threadNotFound();
  return commentPostedResponse(write, roster, context, startedAt);
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

function threadNotFound(): Response {
  return errorResponse('Thread not found', 404);
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
