/**
 * CSS Client - Threads Endpoint Tests
 *
 * Threads are site-scoped and anchored to a context. Each method maps onto one
 * route; these tests pin the URL, method and body shape and that response
 * envelopes are unwrapped where the caller only wants the payload.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';
import { MissingParameterError, NotFoundError } from '../src/errors.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client threads', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';
  const siteId = 'site-1';
  const threadId = 'thread-1';

  const author = { type: 'user', id: 'user-1', name: 'Ada', avatar: null };
  const thread = {
    id: threadId,
    siteId,
    context: { type: 'block', id: 'HeadingBlock-1' },
    documentId: 'doc-1',
    status: 'open',
    commentCount: 2,
    lastCommentAt: '2026-09-12T00:00:02Z',
    createdAt: '2026-09-12T00:00:00Z',
    updatedAt: '2026-09-12T00:00:02Z',
    resolvedAt: null,
    resolvedBy: null,
  };
  const comment = {
    id: 'comment-1',
    threadId,
    kind: 'message',
    body: 'Looks good',
    author,
    mentions: [],
    createdAt: '2026-09-12T00:00:02Z',
    editedAt: null,
  };

  function respond(status: number, body: unknown) {
    mockFetch.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
  }

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listThreads', () => {
    it('GETs the site listing with no query when no options are given', async () => {
      respond(200, { threads: [thread], nextCursor: null });
      const client = new P1Client({ baseUrl, apiKey });

      const page = await client.threads.listThreads(siteId);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/sites/${siteId}/threads`);
      expect(init.method).toBe('GET');
      expect(page.threads).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    it('passes documentId, status, limit and cursor as query params', async () => {
      respond(200, { threads: [], nextCursor: 'abc' });
      const client = new P1Client({ baseUrl, apiKey });

      const page = await client.threads.listThreads(siteId, {
        documentId: 'doc-1',
        status: 'open',
        limit: 50,
        cursor: 'xyz',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/sites/${siteId}/threads?documentId=doc-1&status=open&limit=50&cursor=xyz`);
      expect(page.nextCursor).toBe('abc');
    });

    it('rejects with MissingParameterError before fetching when siteId is empty', async () => {
      const client = new P1Client({ baseUrl, apiKey });
      await expect(client.threads.listThreads('')).rejects.toBeInstanceOf(MissingParameterError);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('listContextThreads', () => {
    it('GETs the context route with the id encoded and unwraps the threads', async () => {
      respond(200, { threads: [thread] });
      const client = new P1Client({ baseUrl, apiKey });

      const threads = await client.threads.listContextThreads(siteId, {
        type: 'block',
        id: 'Hero/1',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/sites/${siteId}/contexts/block/Hero%2F1/threads`);
      expect(threads).toEqual([thread]);
    });
  });

  describe('getThread', () => {
    it('GETs one thread with its comments', async () => {
      respond(200, { thread, comments: [comment] });
      const client = new P1Client({ baseUrl, apiKey });

      const result = await client.threads.getThread(siteId, threadId);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/sites/${siteId}/threads/${threadId}`);
      expect(init.method).toBe('GET');
      expect(result.thread.id).toBe(threadId);
      expect(result.comments[0].body).toBe('Looks good');
    });

    it('rejects with NotFoundError when the thread does not exist', async () => {
      respond(404, { error: 'Thread not found' });
      const client = new P1Client({ baseUrl, apiKey });

      await expect(client.threads.getThread(siteId, 'missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('postThread', () => {
    it('POSTs the context, document and body and returns thread plus comment', async () => {
      respond(201, { thread, comment });
      const client = new P1Client({ baseUrl, apiKey });

      const result = await client.threads.postThread(siteId, {
        context: { type: 'block', id: 'HeadingBlock-1' },
        documentId: 'doc-1',
        body: 'Looks good',
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/sites/${siteId}/threads`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        context: { type: 'block', id: 'HeadingBlock-1' },
        documentId: 'doc-1',
        body: 'Looks good',
      });
      expect(result.thread.commentCount).toBe(2);
      expect(result.comment.id).toBe('comment-1');
    });
  });

  describe('postComment', () => {
    it('POSTs the body to the thread comments route', async () => {
      respond(201, { thread, comment });
      const client = new P1Client({ baseUrl, apiKey });

      await client.threads.postComment(siteId, threadId, 'Reply');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/sites/${siteId}/threads/${threadId}/comments`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ body: 'Reply' });
    });
  });

  describe('setThreadStatus', () => {
    it('PUTs the status and unwraps the thread', async () => {
      const resolved = { ...thread, status: 'resolved', resolvedAt: '2026-09-12T01:00:00Z', resolvedBy: author };
      respond(200, { thread: resolved });
      const client = new P1Client({ baseUrl, apiKey });

      const result = await client.threads.setThreadStatus(siteId, threadId, 'resolved');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/sites/${siteId}/threads/${threadId}/status`);
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ status: 'resolved' });
      expect(result.status).toBe('resolved');
      expect(result.resolvedBy).toEqual(author);
    });
  });
});
