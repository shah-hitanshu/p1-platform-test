/**
 * Threads Endpoint
 *
 * Comment threads anchored to a block, page, site or workstream. Threads are
 * site-scoped: a block thread follows its block across branches.
 */

import type {
  CommentContent,
  ThreadContextRef,
  ListThreadsOptions,
  PostCommentResult,
  PostThreadParams,
  ProposalDecision,
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
   * Reply to an existing thread. Replying to a resolved thread reopens it. A
   * plain string posts a message; an agent passes the full content to leave
   * a working line or a proposal.
   */
  async postComment(siteId: string, threadId: string, content: string | CommentContent): Promise<PostCommentResult> {
    requirePathParams({ siteId, threadId }, 'threads.postComment');

    return this.base.request<PostCommentResult>(`/api/sites/${siteId}/threads/${threadId}/comments`, {
      method: 'POST',
      body: JSON.stringify(typeof content === 'string' ? { body: content } : content),
    });
  }

  /**
   * Replace one of the caller's own comments, kind and state included. This is
   * how an agent turns its working line into its answer.
   */
  async updateComment(
    siteId: string,
    threadId: string,
    commentId: string,
    content: CommentContent,
  ): Promise<PostCommentResult> {
    requirePathParams({ siteId, threadId, commentId }, 'threads.updateComment');

    return this.base.request<PostCommentResult>(
      `/api/sites/${siteId}/threads/${threadId}/comments/${commentId}`,
      { method: 'PUT', body: JSON.stringify(content) },
    );
  }

  /**
   * Accept or dismiss an agent's proposal. Only a proposal still waiting can be
   * decided. Accepting applies the proposed operations to the document as the
   * deciding user before the decision is recorded, so the change reaches every
   * open editor over realtime; a refusal leaves the proposal undecided.
   */
  async decideProposal(
    siteId: string,
    threadId: string,
    commentId: string,
    decision: ProposalDecision,
  ): Promise<PostCommentResult> {
    requirePathParams({ siteId, threadId, commentId }, 'threads.decideProposal');

    return this.base.request<PostCommentResult>(
      `/api/sites/${siteId}/threads/${threadId}/comments/${commentId}/decision`,
      { method: 'PUT', body: JSON.stringify({ decision }) },
    );
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
