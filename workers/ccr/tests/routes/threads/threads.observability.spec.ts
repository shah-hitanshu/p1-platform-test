/**
 * The served-request log lines for the threads routes: one per request,
 * and the debug line the event seam writes for every committed write.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/types';
import { makeBranch } from '../../helpers/branch';
import { makePrincipal } from '../../helpers/principal';
import {
  COMMENT_ID,
  DOCUMENT_ID,
  SITE_ID,
  THREAD_ID,
  USER_ID,
  makeComment,
  makeThread,
} from '../../helpers/threads';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon-systems/p1-telemetry')>();
  return { ...actual, getLogger: () => logger };
});

vi.mock('../../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
}));

vi.mock('../../../src/services/threads/threads-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/threads/threads-service')>();
  return {
    ThreadInputError: actual.ThreadInputError,
    postComment: vi.fn(),
    replyToThread: vi.fn(),
    getThread: vi.fn(),
    listThreads: vi.fn(),
    listThreadsForContext: vi.fn(),
    setThreadStatus: vi.fn(),
    toThreadActor: vi.fn(),
  };
});

vi.mock('../../../src/services/site-members-service', () => ({
  getSiteMembers: vi.fn(),
}));

vi.mock('../../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
    constructor(
      message: string,
      public requiredPermission: string,
      public roleName: string,
    ) {
      super(message);
    }
  },
}));

const viewer: AuthenticatedPrincipal = makePrincipal({
  id: USER_ID,
  type: 'user',
  pantheonSiteRoles: { [SITE_ID]: 'team_member' },
});

type LogCall = [string, Record<string, unknown>];

function infoLine(message: string): Record<string, unknown> | undefined {
  return (logger.info.mock.calls as LogCall[]).find(([m]) => m === message)?.[1];
}

function request(path: string, init: { method?: string; body?: unknown } = {}): Request {
  return new Request(`https://api.example.com/api/sites/${SITE_ID}${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function loadRoute() {
  return await import('../../../src/routes/threads');
}

async function mocks() {
  return {
    branches: await import('../../../src/services/branch-service'),
    service: await import('../../../src/services/threads/threads-service'),
    authorization: await import('../../../src/auth/authorization'),
  };
}

describe('threads observability', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { branches, service, authorization } = await mocks();
    vi.mocked(authorization.assertPermission).mockResolvedValue(undefined);
    vi.mocked(branches.getMainBranch).mockResolvedValue(makeBranch({ id: 'branch-main', siteId: SITE_ID }));
    vi.mocked(service.toThreadActor).mockResolvedValue({ type: 'user', id: USER_ID });
  });

  it('logs one comment posted line with ids, mention count and the reopen flag', async () => {
    const { handleThreadRoutes } = await loadRoute();
    const { service } = await mocks();
    vi.mocked(service.postComment).mockResolvedValue({
      thread: makeThread(),
      comment: makeComment(),
      reopened: false,
    });

    await handleThreadRoutes(
      request('/threads', {
        method: 'POST',
        body: { context: { type: 'block', id: 'Hero-3f2a' }, documentId: DOCUMENT_ID, body: 'Hi' },
      }),
      { siteId: SITE_ID, principal: viewer },
    );

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(infoLine('comment posted')).toMatchObject({
      site_id: SITE_ID,
      thread_id: THREAD_ID,
      comment_id: COMMENT_ID,
      context_type: 'block',
      mention_count: 0,
      reopened: false,
      outcome: 'ok',
    });
    expect(infoLine('comment posted')?.duration_ms).toEqual(expect.any(Number));
  });

  it('emits a comment_posted event at debug for every write that commits', async () => {
    const { handleThreadRoutes } = await loadRoute();
    const { service } = await mocks();
    vi.mocked(service.replyToThread).mockResolvedValue({
      thread: makeThread(),
      comment: makeComment(),
      reopened: true,
    });

    await handleThreadRoutes(
      request(`/threads/${THREAD_ID}/comments`, { method: 'POST', body: { body: 'Agreed.' } }),
      { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'comments', principal: viewer },
    );

    expect(logger.debug).toHaveBeenCalledWith('thread event', {
      event_type: 'comment_posted',
      site_id: SITE_ID,
      thread_id: THREAD_ID,
      comment_id: COMMENT_ID,
      context_type: 'block',
    });
    expect(infoLine('comment posted')).toMatchObject({ reopened: true });
  });

  it('logs the thread count when listing', async () => {
    const { handleThreadRoutes } = await loadRoute();
    const { service } = await mocks();
    vi.mocked(service.listThreads).mockResolvedValue({
      threads: [makeThread(), makeThread({ id: '77777777-7777-4777-8777-777777777777' })],
      nextCursor: null,
    });

    await handleThreadRoutes(request('/threads'), { siteId: SITE_ID, principal: viewer });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(infoLine('threads listed')).toMatchObject({ site_id: SITE_ID, thread_count: 2, outcome: 'ok' });
  });

  it('logs a status change and emits the event only when the status actually moved', async () => {
    const { handleThreadRoutes } = await loadRoute();
    const { service } = await mocks();
    const actor = { type: 'user' as const, id: USER_ID, name: 'Ada Lovelace', avatar: null };
    vi.mocked(service.setThreadStatus)
      .mockResolvedValueOnce({ thread: makeThread({ status: 'resolved' }), actor, changed: true })
      .mockResolvedValueOnce({ thread: makeThread({ status: 'resolved' }), actor, changed: false });
    const context = { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'status', principal: viewer };

    await handleThreadRoutes(
      request(`/threads/${THREAD_ID}/status`, { method: 'PUT', body: { status: 'resolved' } }),
      context,
    );
    await handleThreadRoutes(
      request(`/threads/${THREAD_ID}/status`, { method: 'PUT', body: { status: 'resolved' } }),
      context,
    );

    const lines = (logger.info.mock.calls as LogCall[]).filter(([m]) => m === 'thread status changed');
    expect(lines.map(([, fields]) => fields)).toEqual([
      expect.objectContaining({ thread_id: THREAD_ID, status: 'resolved', changed: true }),
      expect.objectContaining({ thread_id: THREAD_ID, status: 'resolved', changed: false }),
    ]);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      'thread event',
      expect.objectContaining({ event_type: 'thread_status_changed', thread_id: THREAD_ID }),
    );
  });

  it('logs a denied line at info instead of an error when the caller lacks permission', async () => {
    const { handleThreadRoutes } = await loadRoute();
    const { authorization } = await mocks();
    vi.mocked(authorization.assertPermission).mockRejectedValue(
      new authorization.AuthorizationError('Insufficient permissions', 'canComment', 'NO_ACCESS'),
    );

    await handleThreadRoutes(request(`/threads/${THREAD_ID}`), {
      siteId: SITE_ID,
      threadId: THREAD_ID,
      principal: viewer,
    });

    expect(infoLine('threads denied')).toMatchObject({
      site_id: SITE_ID,
      thread_id: THREAD_ID,
      principal_type: 'user',
      outcome: 'denied',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a route failed error with the cause when the service throws', async () => {
    const { handleThreadRoutes } = await loadRoute();
    const { service } = await mocks();
    const cause = new Error('connection reset');
    vi.mocked(service.getThread).mockRejectedValue(cause);

    await handleThreadRoutes(request(`/threads/${THREAD_ID}`), {
      siteId: SITE_ID,
      threadId: THREAD_ID,
      principal: viewer,
    });

    expect(logger.error).toHaveBeenCalledWith(
      'threads route failed',
      cause,
      expect.objectContaining({ site_id: SITE_ID, thread_id: THREAD_ID, outcome: 'error' }),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('does not log a served line for a request that fails validation', async () => {
    const { handleThreadRoutes } = await loadRoute();

    await handleThreadRoutes(request('/threads?limit=0'), { siteId: SITE_ID, principal: viewer });

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
