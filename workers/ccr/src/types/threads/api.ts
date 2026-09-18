/**
 * The wire contract of /api/sites/{siteId}/threads and
 * /api/sites/{siteId}/contexts/{type}/{id}/threads: the part clients are
 * coupled to.
 */

import type { Comment, CommentContent, ProposalDecision } from './comment';
import type { ThreadContextRef } from './context';
import type { ThreadOverview, ThreadStatus } from './thread';

export interface PostThreadRequest {
  context: ThreadContextRef;
  documentId?: string;
  branchId?: string;
  body: string;
}

/** A bare `body` posts a plain comment; an agent may post the other kinds with their state. */
export type PostCommentRequest = { body: string } | CommentContent;

/** Replaces an agent's own comment wholesale: kind, body and state together. */
export type UpdateCommentRequest = CommentContent;

export interface DecideProposalRequest {
  decision: ProposalDecision;
}

export interface SetThreadStatusRequest {
  status: ThreadStatus;
}

export interface PostCommentResponse {
  thread: ThreadOverview;
  comment: Comment;
}

export interface CommentResponse {
  thread: ThreadOverview;
  comment: Comment;
}

export interface ThreadResponse {
  thread: ThreadOverview;
  comments: Comment[];
}

export interface ThreadListResponse {
  threads: ThreadOverview[];
  nextCursor: string | null;
}

export interface ContextThreadsResponse {
  threads: ThreadOverview[];
}

export interface ThreadStatusResponse {
  thread: ThreadOverview;
}
