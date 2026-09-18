/**
 * Threads API route tests: the gate, the request shapes, and how service
 * results become responses. The service is mocked; its SQL is covered under
 * tests/db.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/types';
import type {
  PostCommentResponse,
  ThreadListResponse,
  ThreadResponse,
} from '../../../src/routes/threads';
import { readJson } from '../../helpers/http';
import { makeBranch } from '../../helpers/branch';
import { makePrincipal } from '../../helpers/principal';
import {
  AGENT_ID,
  COMMENT_ID,
  DOCUMENT_ID,
  SITE_ID,
  THREAD_ID,
  USER_ID,
  makeComment,
  makeThread,
} from '../../helpers/threads';

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

const roster = {
  members: [{ id: USER_ID, name: 'Ada Lovelace', email: null, role: 'developer' as const, avatar: null, source: 'local' as const }],
  agents: [{ id: AGENT_ID, name: 'Copy Editor', role: 'editor' as const, avatar: null, isGlobal: false }],
  rosterSource: 'unconfigured' as const,
};

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
    members: await import('../../../src/services/site-members-service'),
    authorization: await import('../../../src/auth/authorization'),
  };
}

const validPost = {
  context: { type: 'block', id: 'Hero-3f2a' },
  documentId: DOCUMENT_ID,
  body: 'Can we tighten this headline?',
};

describe('threads routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { branches, service, members, authorization } = await mocks();
    vi.mocked(authorization.assertPermission).mockResolvedValue(undefined);
    vi.mocked(branches.getMainBranch).mockResolvedValue(makeBranch({ id: 'branch-main', siteId: SITE_ID }));
    vi.mocked(service.toThreadActor).mockResolvedValue({ type: 'user', id: USER_ID });
    vi.mocked(members.getSiteMembers).mockResolvedValue(roster);
  });

  describe('POST /threads', () => {
    it('posts the first comment and returns the thread with it', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.postComment).mockResolvedValue({
        thread: makeThread(),
        comment: makeComment(),
        reopened: false,
      });

      const response = await handleThreadRoutes(
        request('/threads', { method: 'POST', body: validPost }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(response.status).toBe(201);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      const body = await readJson<PostCommentResponse>(response);
      expect(body.thread.id).toBe(THREAD_ID);
      expect(body.comment).toMatchObject({ id: COMMENT_ID, mentions: [] });
      expect(service.postComment).toHaveBeenCalledWith({
        siteId: SITE_ID,
        actor: { type: 'user', id: USER_ID },
        context: { type: 'block', id: 'Hero-3f2a' },
        documentId: DOCUMENT_ID,
        body: 'Can we tighten this headline?',
      });
    });

    it('requires canComment', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { authorization } = await mocks();

      await handleThreadRoutes(request('/threads', { method: 'POST', body: validPost }), {
        siteId: SITE_ID,
        principal: viewer,
      });

      expect(authorization.assertPermission).toHaveBeenCalledWith(
        viewer,
        SITE_ID,
        'branch-main',
        'canComment',
        undefined,
      );
    });

    it('rejects an empty body without writing', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();

      const response = await handleThreadRoutes(
        request('/threads', { method: 'POST', body: { ...validPost, body: '   ' } }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(response.status).toBe(400);
      expect(service.postComment).not.toHaveBeenCalled();
    });

    it('rejects a body over 10,000 characters', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const response = await handleThreadRoutes(
        request('/threads', { method: 'POST', body: { ...validPost, body: 'x'.repeat(10_001) } }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(response.status).toBe(400);
    });

    it('requires documentId for a block thread and forbids it on a site thread', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const missing = await handleThreadRoutes(
        request('/threads', { method: 'POST', body: { ...validPost, documentId: undefined } }),
        { siteId: SITE_ID, principal: viewer },
      );
      const forbidden = await handleThreadRoutes(
        request('/threads', {
          method: 'POST',
          body: { ...validPost, context: { type: 'site', id: SITE_ID } },
        }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(missing.status).toBe(400);
      expect(forbidden.status).toBe(400);
    });

    it('rejects a page thread whose context id is not its document and a site thread named after another site', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();

      const page = await handleThreadRoutes(
        request('/threads', {
          method: 'POST',
          body: { ...validPost, context: { type: 'page', id: 'a4d0c6f2-5c3b-4c1e-9a8e-0f1e2d3c4b5a' } },
        }),
        { siteId: SITE_ID, principal: viewer },
      );
      const site = await handleThreadRoutes(
        request('/threads', {
          method: 'POST',
          body: { body: validPost.body, context: { type: 'site', id: 'a4d0c6f2-5c3b-4c1e-9a8e-0f1e2d3c4b5a' } },
        }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(page.status).toBe(400);
      expect(site.status).toBe(400);
      expect(await site.json()).toMatchObject({ details: { 'context.id': [expect.stringContaining('site id')] } });
      expect(service.postComment).not.toHaveBeenCalled();
    });

    it('rejects an unknown context type', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const response = await handleThreadRoutes(
        request('/threads', {
          method: 'POST',
          body: { ...validPost, context: { type: 'comment', id: 'x' } },
        }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(response.status).toBe(400);
    });

    it('rejects a malformed JSON body', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const response = await handleThreadRoutes(
        new Request(`https://api.example.com/api/sites/${SITE_ID}/threads`, {
          method: 'POST',
          body: '{not json',
        }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(response.status).toBe(400);
    });

    it('turns a document from another site into a 400', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.postComment).mockRejectedValue(
        new service.ThreadInputError('documentId', 'documentId does not belong to this site'),
      );

      const response = await handleThreadRoutes(
        request('/threads', { method: 'POST', body: validPost }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        error: 'documentId does not belong to this site',
        details: { documentId: ['documentId does not belong to this site'] },
      });
    });

    it('hydrates mentions from the roster and validates them before writing', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      const body = `\${mention|agent:${AGENT_ID}} can we tighten this?`;
      vi.mocked(service.postComment).mockResolvedValue({
        thread: makeThread(),
        comment: makeComment({ body }),
        reopened: false,
      });

      const response = await handleThreadRoutes(
        request('/threads', { method: 'POST', body: { ...validPost, body } }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(response.status).toBe(201);
      const result = await readJson<PostCommentResponse>(response);
      expect(result.comment.mentions).toEqual([{ type: 'agent', id: AGENT_ID, name: 'Copy Editor' }]);
    });

    it('rejects a mention of someone not on the site and names the id', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      const stranger = '00000000-0000-4000-8000-000000000000';

      const response = await handleThreadRoutes(
        request('/threads', {
          method: 'POST',
          body: { ...validPost, body: `\${mention|user:${stranger}} hello` },
        }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(response.status).toBe(400);
      expect((await readJson(response)).error).toContain(stranger);
      expect(service.postComment).not.toHaveBeenCalled();
    });

    it('rejects more than 50 mentions', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { members } = await mocks();
      const body = Array.from({ length: 51 }, () => `\${mention|user:${USER_ID}}`).join(' ');

      const response = await handleThreadRoutes(
        request('/threads', { method: 'POST', body: { ...validPost, body } }),
        { siteId: SITE_ID, principal: viewer },
      );

      expect(response.status).toBe(400);
      expect(members.getSiteMembers).not.toHaveBeenCalled();
    });

    it('refuses a service principal', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.toThreadActor).mockResolvedValue(null);

      const response = await handleThreadRoutes(
        request('/threads', { method: 'POST', body: validPost }),
        { siteId: SITE_ID, principal: makePrincipal({ id: 'sat_1', type: 'service' }) },
      );

      expect(response.status).toBe(403);
    });
  });

  describe('POST /threads/{threadId}/comments', () => {
    it('replies and reports the reopened thread', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.replyToThread).mockResolvedValue({
        thread: makeThread({ status: 'open', commentCount: 2 }),
        comment: makeComment(),
        reopened: true,
      });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments`, { method: 'POST', body: { body: 'Agreed.' } }),
        { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'comments', principal: viewer },
      );

      expect(response.status).toBe(201);
      expect(service.replyToThread).toHaveBeenCalledWith(SITE_ID, THREAD_ID, 'Agreed.', {
        type: 'user',
        id: USER_ID,
      });
      expect((await readJson<PostCommentResponse>(response)).thread.status).toBe('open');
    });

    it('returns 404 for a thread the site does not have', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.replyToThread).mockResolvedValue(null);

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments`, { method: 'POST', body: { body: 'Agreed.' } }),
        { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'comments', principal: viewer },
      );

      expect(response.status).toBe(404);
    });

    it('rejects a comment that mentions someone not on the site before writing', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      const stranger = '00000000-0000-4000-8000-000000000000';

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments`, {
          method: 'POST',
          body: { body: `\${mention|user:${stranger}} agreed` },
        }),
        { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'comments', principal: viewer },
      );

      expect(response.status).toBe(400);
      expect((await readJson(response)).error).toContain(stranger);
      expect(service.replyToThread).not.toHaveBeenCalled();
    });

    it('returns 404 for a thread id that is not a uuid without touching the service', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();

      const response = await handleThreadRoutes(
        request('/threads/not-a-uuid/comments', { method: 'POST', body: { body: 'Agreed.' } }),
        { siteId: SITE_ID, threadId: 'not-a-uuid', subResource: 'comments', principal: viewer },
      );

      expect(response.status).toBe(404);
      expect(service.replyToThread).not.toHaveBeenCalled();
    });
  });

  describe('GET /threads/{threadId}', () => {
    it('returns the thread with its comments hydrated', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      const comment = makeComment({ body: `\${mention|user:${USER_ID}} ok` });
      const { mentions, ...stored } = comment;
      expect(mentions).toEqual([]);
      vi.mocked(service.getThread).mockResolvedValue({ thread: makeThread(), comments: [stored] });

      const response = await handleThreadRoutes(request(`/threads/${THREAD_ID}`), {
        siteId: SITE_ID,
        threadId: THREAD_ID,
        principal: viewer,
      });

      expect(response.status).toBe(200);
      const body = await readJson<ThreadResponse>(response);
      expect(body.comments[0]?.mentions).toEqual([{ type: 'user', id: USER_ID, name: 'Ada Lovelace' }]);
    });

    it('needs only canView', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service, authorization } = await mocks();
      vi.mocked(service.getThread).mockResolvedValue({ thread: makeThread(), comments: [] });

      await handleThreadRoutes(request(`/threads/${THREAD_ID}`), {
        siteId: SITE_ID,
        threadId: THREAD_ID,
        principal: viewer,
      });

      expect(vi.mocked(authorization.assertPermission).mock.calls[0]?.[3]).toBe('canView');
    });

    it('returns 404 when the thread is missing', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.getThread).mockResolvedValue(null);

      const response = await handleThreadRoutes(request(`/threads/${THREAD_ID}`), {
        siteId: SITE_ID,
        threadId: THREAD_ID,
        principal: viewer,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /threads', () => {
    it('passes the parsed filters through with defaults', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.listThreads).mockResolvedValue({ threads: [makeThread()], nextCursor: 'abc' });

      const response = await handleThreadRoutes(request(`/threads?documentId=${DOCUMENT_ID}`), {
        siteId: SITE_ID,
        principal: viewer,
      });

      expect(response.status).toBe(200);
      expect(service.listThreads).toHaveBeenCalledWith(SITE_ID, {
        documentId: DOCUMENT_ID,
        status: 'all',
        limit: 100,
      });
      expect(await readJson<ThreadListResponse>(response)).toMatchObject({ nextCursor: 'abc' });
    });

    it('accepts status, limit and cursor', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.listThreads).mockResolvedValue({ threads: [], nextCursor: null });

      await handleThreadRoutes(request('/threads?status=open&limit=20&cursor=abc'), {
        siteId: SITE_ID,
        principal: viewer,
      });

      expect(service.listThreads).toHaveBeenCalledWith(SITE_ID, {
        status: 'open',
        limit: 20,
        cursor: 'abc',
      });
    });

    it('rejects a limit above 500 and a status outside the union', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const tooMany = await handleThreadRoutes(request('/threads?limit=501'), {
        siteId: SITE_ID,
        principal: viewer,
      });
      const badStatus = await handleThreadRoutes(request('/threads?status=closed'), {
        siteId: SITE_ID,
        principal: viewer,
      });

      expect(tooMany.status).toBe(400);
      expect(badStatus.status).toBe(400);
    });
  });

  describe('GET /contexts/{type}/{id}/threads', () => {
    it('returns every thread on the object', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.listThreadsForContext).mockResolvedValue([
        makeThread(),
        makeThread({ id: '77777777-7777-4777-8777-777777777777', status: 'resolved' }),
      ]);

      const response = await handleThreadRoutes(request('/contexts/block/Hero-3f2a/threads'), {
        siteId: SITE_ID,
        contextType: 'block',
        contextId: 'Hero-3f2a',
        principal: viewer,
      });

      expect(response.status).toBe(200);
      expect(service.listThreadsForContext).toHaveBeenCalledWith(SITE_ID, { type: 'block', id: 'Hero-3f2a' });
      expect((await readJson<{ threads: unknown[] }>(response)).threads).toHaveLength(2);
    });

    it('rejects a context type outside the union', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const response = await handleThreadRoutes(request('/contexts/comment/x/threads'), {
        siteId: SITE_ID,
        contextType: 'comment',
        contextId: 'x',
        principal: viewer,
      });

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /threads/{threadId}/status', () => {
    it('resolves the thread', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.setThreadStatus).mockResolvedValue({
        thread: makeThread({ status: 'resolved' }),
        actor: { type: 'user', id: USER_ID, name: 'Ada Lovelace', avatar: null },
        changed: true,
      });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/status`, { method: 'PUT', body: { status: 'resolved' } }),
        { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'status', principal: viewer },
      );

      expect(response.status).toBe(200);
      expect(service.setThreadStatus).toHaveBeenCalledWith(SITE_ID, THREAD_ID, 'resolved', {
        type: 'user',
        id: USER_ID,
      });
      expect(await readJson(response)).toMatchObject({ thread: { status: 'resolved' } });
    });

    it('rejects a status outside the union', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/status`, { method: 'PUT', body: { status: 'closed' } }),
        { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'status', principal: viewer },
      );

      expect(response.status).toBe(400);
    });
  });

  describe('gate', () => {
    it('returns 405 for a method the path does not serve', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const deleteThread = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}`, { method: 'DELETE' }),
        { siteId: SITE_ID, threadId: THREAD_ID, principal: viewer },
      );
      const getStatus = await handleThreadRoutes(request(`/threads/${THREAD_ID}/status`), {
        siteId: SITE_ID,
        threadId: THREAD_ID,
        subResource: 'status',
        principal: viewer,
      });

      expect(deleteThread.status).toBe(405);
      expect(getStatus.status).toBe(405);
    });

    it('returns 404 when the site has no main branch', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { branches } = await mocks();
      vi.mocked(branches.getMainBranch).mockResolvedValue(null);

      const response = await handleThreadRoutes(request('/threads'), {
        siteId: SITE_ID,
        principal: viewer,
      });

      expect(response.status).toBe(404);
    });

    it('returns 403 when the permission check refuses', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { authorization } = await mocks();
      vi.mocked(authorization.assertPermission).mockRejectedValue(
        new authorization.AuthorizationError('Insufficient permissions', 'canView', 'NO_ACCESS'),
      );

      const response = await handleThreadRoutes(request('/threads'), {
        siteId: SITE_ID,
        principal: viewer,
      });

      expect(response.status).toBe(403);
    });

    it('returns 500 when the service fails', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.listThreads).mockRejectedValue(new Error('boom'));

      const response = await handleThreadRoutes(request('/threads'), {
        siteId: SITE_ID,
        principal: viewer,
      });

      expect(response.status).toBe(500);
    });
  });
});
