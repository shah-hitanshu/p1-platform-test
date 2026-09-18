/**
 * Threads Endpoint
 *
 * Comment threads anchored to a block, page, site or workstream. Threads are
 * site-scoped: a block thread follows its block across branches.
 */

import type {
  ThreadContextRef,
  ListThreadsOptions,
  PostCommentResult,
  PostThreadParams,
  ThreadListPage,
  ThreadOverview,
  ThreadStatus,
  ThreadWithComments,
} from '../types/threads/index.js';
import { requirePathParams } from '../utils.js';
import type { BaseEndpoint } from './base.js';

export class ThreadsEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * List threads on a site, newest activity first. Pass `documentId` to get
   * that page's threads: one overview per context, the open thread when there
   * is one, otherwise the latest resolved one.
   */
  async listThreads(siteId: string, options?: ListThreadsOptions): Promise<ThreadListPage> {
    requirePathParams({ siteId }, 'threads.listThreads');

    const params = new URLSearchParams();
    if (options?.documentId !== undefined) params.set('documentId', options.documentId);
    if (options?.status !== undefined) params.set('status', options.status);
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.cursor !== undefined) params.set('cursor', options.cursor);

    const query = params.toString();
    const path = query
      ? `/api/sites/${siteId}/threads?${query}`
      : `/api/sites/${siteId}/threads`;

    return this.base.request<ThreadListPage>(path, { method: 'GET' });
  }

  /**
   * Every thread ever opened on one context, open and resolved alike.
   */
  async listContextThreads(siteId: string, context: ThreadContextRef): Promise<ThreadOverview[]> {
    requirePathParams({ siteId, contextId: context.id }, 'threads.listContextThreads');

    const response = await this.base.request<{ threads: ThreadOverview[] }>(
      `/api/sites/${siteId}/contexts/${context.type}/${encodeURIComponent(context.id)}/threads`,
      { method: 'GET' },
    );
    return response.threads;
  }

  /**
   * One thread with its comments, oldest first.
   */
  async getThread(siteId: string, threadId: string): Promise<ThreadWithComments> {
    requirePathParams({ siteId, threadId }, 'threads.getThread');

    return this.base.request<ThreadWithComments>(`/api/sites/${siteId}/threads/${threadId}`, {
      method: 'GET',
    });
  }

  /**
   * Open a thread on a context with its first comment. Posting to a context
   * that already has an open thread appends to it instead.
   */
  async postThread(siteId: string, params: PostThreadParams): Promise<PostCommentResult> {
    requirePathParams({ siteId }, 'threads.postThread');

    return this.base.request<PostCommentResult>(`/api/sites/${siteId}/threads`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Reply to an existing thread. Replying to a resolved thread reopens it.
   */
  async postComment(siteId: string, threadId: string, body: string): Promise<PostCommentResult> {
    requirePathParams({ siteId, threadId }, 'threads.postComment');

    return this.base.request<PostCommentResult>(`/api/sites/${siteId}/threads/${threadId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  /**
   * Resolve or reopen a thread. Setting the status it already has is a no-op.
   */
  async setThreadStatus(siteId: string, threadId: string, status: ThreadStatus): Promise<ThreadOverview> {
    requirePathParams({ siteId, threadId }, 'threads.setThreadStatus');

    const response = await this.base.request<{ thread: ThreadOverview }>(
      `/api/sites/${siteId}/threads/${threadId}/status`,
      { method: 'PUT', body: JSON.stringify({ status }) },
    );
    return response.thread;
  }
}
