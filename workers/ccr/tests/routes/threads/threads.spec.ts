/**
 * Threads API route tests: the gate, the request shapes, and how service
 * results become responses. The service is mocked; its SQL is covered under
 * tests/db.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/types';
import type {
  AgentProposalMetadata,
  CommentResponse,
  PostCommentResponse,
  ThreadListResponse,
  ThreadResponse,
} from '../../../src/routes/threads';
import { ThreadForbiddenError } from '../../../src/services/threads/errors';
import type { Env } from '../../../src/env';
import { readJson } from '../../helpers/http';
import { makeBranch } from '../../helpers/branch';
import { makeDurableObjectNamespace } from '../../helpers/durable-object';
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
    ThreadForbiddenError: actual.ThreadForbiddenError,
    postComment: vi.fn(),
    updateComment: vi.fn(),
    claimProposal: vi.fn(),
    releaseProposal: vi.fn(),
    decideProposal: vi.fn(),
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

vi.mock('../../../src/services/document-service', () => ({
  getDocument: vi.fn(),
}));

vi.mock('../../../src/services/component-type-registry', () => ({
  loadCanonicalComponentNames: vi.fn().mockResolvedValue(new Set()),
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
    documents: await import('../../../src/services/document-service'),
  };
}

const agent: AuthenticatedPrincipal = makePrincipal({ id: AGENT_ID, type: 'agent' });

const proposal: AgentProposalMetadata = {
  status: 'proposed',
  summary: 'Shorten the headline',
  operations: [{ op: 'replace', path: 'content.0.props.title', value: 'Hello' }],
};

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

  describe('POST /threads/{threadId}/comments with a kind', () => {
    it('lets an agent leave a working line and passes the whole content through', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.toThreadActor).mockResolvedValue({ type: 'agent', id: AGENT_ID, actingUserId: USER_ID });
      vi.mocked(service.replyToThread).mockResolvedValue({
        thread: makeThread({ commentCount: 2 }),
        comment: makeComment({ kind: 'agent_activity', metadata: { status: 'working' }, body: 'Looking into it' }),
        reopened: false,
      });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments`, {
          method: 'POST',
          body: { kind: 'agent_activity', body: 'Looking into it', metadata: { status: 'working' } },
        }),
        { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'comments', principal: agent },
      );

      expect(response.status).toBe(201);
      expect(service.replyToThread).toHaveBeenCalledWith(
        SITE_ID,
        THREAD_ID,
        { kind: 'agent_activity', body: 'Looking into it', metadata: { status: 'working' } },
        { type: 'agent', id: AGENT_ID, actingUserId: USER_ID },
      );
      expect(await readJson<PostCommentResponse>(response)).toMatchObject({
        comment: { kind: 'agent_activity', metadata: { status: 'working' } },
      });
    });

    it('refuses a user posting an agent kind', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments`, {
          method: 'POST',
          body: { kind: 'agent_proposal', body: 'Try this', metadata: proposal },
        }),
        { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'comments', principal: viewer },
      );

      expect(response.status).toBe(403);
      expect(service.replyToThread).not.toHaveBeenCalled();
    });

    it('rejects a proposal that arrives already decided, without operations, or aimed outside the page data', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const outsidePage = [{ op: 'replace', path: 'siteId', value: 'other' }];
      for (const metadata of [
        { ...proposal, status: 'accepted' },
        { ...proposal, operations: [] },
        { ...proposal, operations: outsidePage },
        { ...proposal, operations: [{ op: 'move', path: 'content.1', from: 'settings.0' }] },
      ]) {
        const response = await handleThreadRoutes(
          request(`/threads/${THREAD_ID}/comments`, {
            method: 'POST',
            body: { kind: 'agent_proposal', body: 'Try this', metadata },
          }),
          { siteId: SITE_ID, threadId: THREAD_ID, subResource: 'comments', principal: agent },
        );
        expect(response.status).toBe(400);
      }
    });
  });

  describe('PUT /threads/{threadId}/comments/{commentId}', () => {
    const commentContext = {
      siteId: SITE_ID,
      threadId: THREAD_ID,
      subResource: 'comments',
      commentId: COMMENT_ID,
    };

    it('turns the working line into a proposal and announces the update', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.toThreadActor).mockResolvedValue({ type: 'agent', id: AGENT_ID, actingUserId: USER_ID });
      vi.mocked(service.updateComment).mockResolvedValue({
        thread: makeThread(),
        comment: makeComment({
          kind: 'agent_proposal',
          body: 'Here is a tighter headline.',
          metadata: proposal,
          author: { type: 'agent', id: AGENT_ID, name: 'Copy Editor', avatar: null },
        }),
      });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}`, {
          method: 'PUT',
          body: { kind: 'agent_proposal', body: 'Here is a tighter headline.', metadata: proposal },
        }),
        { ...commentContext, principal: agent },
      );

      expect(response.status).toBe(200);
      expect(service.updateComment).toHaveBeenCalledWith(
        SITE_ID,
        THREAD_ID,
        COMMENT_ID,
        { kind: 'agent_proposal', body: 'Here is a tighter headline.', metadata: proposal },
        { type: 'agent', id: AGENT_ID, actingUserId: USER_ID },
      );
      expect(await readJson<CommentResponse>(response)).toMatchObject({
        comment: { kind: 'agent_proposal', metadata: { summary: 'Shorten the headline' } },
      });
    });

    it('returns 403 when the comment belongs to someone else', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.toThreadActor).mockResolvedValue({ type: 'agent', id: AGENT_ID });
      vi.mocked(service.updateComment).mockRejectedValue(new ThreadForbiddenError('Only the author can change a comment'));

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}`, {
          method: 'PUT',
          body: { kind: 'message', body: 'Never mind.' },
        }),
        { ...commentContext, principal: agent },
      );

      expect(response.status).toBe(403);
    });

    it('returns 404 for a comment id that is not a uuid, and for one the thread does not have', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      vi.mocked(service.updateComment).mockResolvedValue(null);

      const malformed = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/nope`, { method: 'PUT', body: { kind: 'message', body: 'x' } }),
        { ...commentContext, commentId: 'nope', principal: viewer },
      );
      const missing = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}`, { method: 'PUT', body: { kind: 'message', body: 'x' } }),
        { ...commentContext, principal: viewer },
      );

      expect(malformed.status).toBe(404);
      expect(service.updateComment).toHaveBeenCalledTimes(1);
      expect(missing.status).toBe(404);
    });

    it('serves only PUT on a comment', async () => {
      const { handleThreadRoutes } = await loadRoute();

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}`, { method: 'DELETE' }),
        { ...commentContext, principal: viewer },
      );

      expect(response.status).toBe(405);
    });
  });

  describe('PUT /threads/{threadId}/comments/{commentId}/decision', () => {
    const decisionContext = {
      siteId: SITE_ID,
      threadId: THREAD_ID,
      subResource: 'comments',
      commentId: COMMENT_ID,
      commentAction: 'decision',
    };

    const BRANCH_ID = '77777777-7777-4777-8777-777777777777';
    const proposalComment = makeComment({ kind: 'agent_proposal', metadata: proposal, author: { type: 'agent', id: AGENT_ID, name: 'Copy Editor', avatar: null } });

    function documentSession(status = 200, body: unknown = { success: true }) {
      const stub = { fetch: vi.fn().mockResolvedValue(Response.json(body, { status })) };
      const namespace = makeDurableObjectNamespace(stub, { toString: () => 'do-1' });
      return { stub, env: { DOCUMENT_STATE: namespace } as unknown as Env };
    }

    async function primeAccept(branchId: string | null = BRANCH_ID) {
      const { service, documents } = await mocks();
      vi.mocked(service.claimProposal).mockResolvedValue({
        thread: makeThread({ branchId }),
        comment: { ...proposalComment, metadata: { ...proposal, status: 'applying', claimedAt: '2026-09-13T10:00:00.000Z' } },
      });
      vi.mocked(service.releaseProposal).mockResolvedValue(undefined);
      vi.mocked(documents.getDocument).mockResolvedValue({ id: DOCUMENT_ID, siteId: SITE_ID, path: '/about' } as never);
      vi.mocked(service.decideProposal).mockResolvedValue({
        thread: makeThread({ branchId }),
        comment: makeComment({ kind: 'agent_proposal', metadata: { ...proposal, status: 'accepted' } }),
      });
      return service;
    }

    it('puts the edits into the page as the decider before recording the acceptance', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { authorization } = await mocks();
      const service = await primeAccept();
      const { stub, env } = documentSession();
      const decider = makePrincipal({ ...viewer, dbUserId: 'db-user-1', email: 'ada@example.com', name: 'Ada Lovelace' });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: decider, env },
      );

      expect(response.status).toBe(200);
      expect(authorization.assertPermission).toHaveBeenCalledWith(decider, SITE_ID, BRANCH_ID, 'canEditDocuments', undefined);
      expect(stub.fetch).toHaveBeenCalledTimes(1);
      const applied = stub.fetch.mock.calls[0]?.[0] as Request;
      expect(applied.method).toBe('POST');
      expect(new URL(applied.url).pathname).toBe('/apply');
      expect(applied.headers.get('X-Session-Id')).toBe(`${SITE_ID}:${DOCUMENT_ID}:${BRANCH_ID}`);
      expect(applied.headers.get('X-Verified-Actor-Id')).toBe(USER_ID);
      expect(applied.headers.get('X-Verified-Actor-Type')).toBe('user');
      expect(applied.headers.get('X-Verified-Db-User-Id')).toBe('db-user-1');
      expect(applied.headers.get('X-Verified-Email')).toBe('ada@example.com');
      expect(await applied.json()).toEqual({
        operations: [{ type: 'replace', path: 'content.0.props.title', content: 'Hello' }],
        actorId: USER_ID,
        attribution: {
          agent: { id: AGENT_ID, name: 'Copy Editor' },
          onBehalfOf: { id: USER_ID, name: 'Ada Lovelace' },
          description: 'Shorten the headline',
        },
      });
      expect(stub.fetch.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(service.decideProposal).mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('claims the proposal before touching the page and keeps the claim once the edits are in', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const service = await primeAccept();
      const { stub, env } = documentSession();

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: viewer, env },
      );

      expect(response.status).toBe(200);
      expect(service.claimProposal).toHaveBeenCalledWith(SITE_ID, THREAD_ID, COMMENT_ID);
      expect(vi.mocked(service.claimProposal).mock.invocationCallOrder[0]).toBeLessThan(
        stub.fetch.mock.invocationCallOrder[0] ?? 0,
      );
      expect(service.getThread).not.toHaveBeenCalled();
      expect(service.releaseProposal).not.toHaveBeenCalled();
    });

    it('refuses a second accept while the first is still applying, without touching the page', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const service = await primeAccept();
      const { stub, env } = documentSession();
      const { ThreadInputError } = await import('../../../src/services/threads/errors');
      vi.mocked(service.claimProposal).mockRejectedValue(
        new ThreadInputError('decision', 'This proposal is being applied'),
      );

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: viewer, env },
      );

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ details: { decision: ['This proposal is being applied'] } });
      expect(stub.fetch).not.toHaveBeenCalled();
      expect(service.decideProposal).not.toHaveBeenCalled();
    });

    it('does not put the edits in again when the acceptance could not be recorded', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const service = await primeAccept();
      const { stub, env } = documentSession();
      vi.mocked(service.decideProposal).mockRejectedValue(new Error('connection reset'));

      const first = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: viewer, env },
      );
      expect(first.status).toBe(500);
      expect(stub.fetch).toHaveBeenCalledTimes(1);
      expect(service.releaseProposal).not.toHaveBeenCalled();

      // The claim is still held, so the client's retry is refused at the claim.
      const { ThreadInputError } = await import('../../../src/services/threads/errors');
      vi.mocked(service.claimProposal).mockRejectedValue(
        new ThreadInputError('decision', 'This proposal is being applied'),
      );
      const retry = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: viewer, env },
      );
      expect(retry.status).toBe(400);
      expect(stub.fetch).toHaveBeenCalledTimes(1);
    });

    it('records nothing when the page refuses the edits', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const service = await primeAccept();
      const { env } = documentSession(400, { error: 'Invalid operation type: nope' });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: viewer, env },
      );

      expect(response.status).toBe(400);
      expect(await readJson<{ error: string; details: { operations: string[] } }>(response)).toMatchObject({
        details: { operations: ['The page refused the proposed edits: Invalid operation type: nope'] },
      });
      expect(service.decideProposal).not.toHaveBeenCalled();
      expect(service.releaseProposal).toHaveBeenCalledWith(SITE_ID, THREAD_ID, COMMENT_ID);
    });

    it('refuses to accept for someone who cannot edit the page', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { authorization } = await mocks();
      const service = await primeAccept();
      const { stub, env } = documentSession();
      vi.mocked(authorization.assertPermission).mockImplementation(async (_p, _s, _b, permission) => {
        if (permission === 'canEditDocuments') {
          throw new authorization.AuthorizationError('Missing permission', 'canEditDocuments', 'NO_ACCESS');
        }
      });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: viewer, env },
      );

      expect(response.status).toBe(403);
      expect(stub.fetch).not.toHaveBeenCalled();
      expect(service.decideProposal).not.toHaveBeenCalled();
    });

    it('cannot accept a proposal on a thread with no page', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const service = await primeAccept(null);
      const { stub, env } = documentSession();

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: viewer, env },
      );

      expect(response.status).toBe(400);
      expect(stub.fetch).not.toHaveBeenCalled();
      expect(service.decideProposal).not.toHaveBeenCalled();
    });

    it('dismisses without touching the page', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      const { stub, env } = documentSession();
      vi.mocked(service.decideProposal).mockResolvedValue({
        thread: makeThread(),
        comment: makeComment({ kind: 'agent_proposal', metadata: { ...proposal, status: 'dismissed' } }),
      });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'dismissed' },
        }),
        { ...decisionContext, principal: viewer, env },
      );

      expect(response.status).toBe(200);
      expect(stub.fetch).not.toHaveBeenCalled();
      expect(service.claimProposal).not.toHaveBeenCalled();
      expect(service.getThread).not.toHaveBeenCalled();
    });

    it('records who accepted the proposal', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      await primeAccept();
      const { env } = documentSession();
      const decidedBy = { type: 'user' as const, id: USER_ID, name: 'Ada Lovelace', avatar: null };
      vi.mocked(service.decideProposal).mockResolvedValue({
        thread: makeThread(),
        comment: makeComment({
          kind: 'agent_proposal',
          metadata: { ...proposal, status: 'accepted', decidedBy, decidedAt: '2026-09-13T10:00:00.000Z' },
        }),
      });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: viewer, env },
      );

      expect(response.status).toBe(200);
      expect(service.decideProposal).toHaveBeenCalledWith(SITE_ID, THREAD_ID, COMMENT_ID, 'accepted', {
        type: 'user',
        id: USER_ID,
      });
      expect(await readJson<CommentResponse>(response)).toMatchObject({
        comment: { metadata: { status: 'accepted', decidedBy: { id: USER_ID } } },
      });
    });

    it("hydrates the decided proposal's mentions from its stored body", async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service, members } = await mocks();
      vi.mocked(service.decideProposal).mockResolvedValue({
        thread: makeThread(),
        comment: makeComment({
          kind: 'agent_proposal',
          body: `\${mention|user:${USER_ID}} Tightened the headline.`,
          metadata: { ...proposal, status: 'dismissed' },
        }),
      });

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'dismissed' },
        }),
        { ...decisionContext, principal: viewer },
      );

      expect(response.status).toBe(200);
      expect(members.getSiteMembers).toHaveBeenCalledWith(SITE_ID, undefined);
      const body = await readJson<CommentResponse>(response);
      expect(body.comment.mentions).toEqual([{ type: 'user', id: USER_ID, name: 'Ada Lovelace' }]);
    });

    it('rejects a decision outside accepted and dismissed', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'proposed' },
        }),
        { ...decisionContext, principal: viewer },
      );

      expect(response.status).toBe(400);
      expect(service.decideProposal).not.toHaveBeenCalled();
    });

    it('turns a repeated decision into a 400 naming the field', async () => {
      const { handleThreadRoutes } = await loadRoute();
      const { service } = await mocks();
      const { ThreadInputError } = await import('../../../src/services/threads/errors');
      vi.mocked(service.claimProposal).mockRejectedValue(
        new ThreadInputError('decision', 'This proposal was already dismissed'),
      );

      const response = await handleThreadRoutes(
        request(`/threads/${THREAD_ID}/comments/${COMMENT_ID}/decision`, {
          method: 'PUT',
          body: { decision: 'accepted' },
        }),
        { ...decisionContext, principal: viewer },
      );

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ details: { decision: ['This proposal was already dismissed'] } });
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
