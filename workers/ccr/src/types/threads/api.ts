/**
 * The wire contract of /api/sites/{siteId}/threads and
 * /api/sites/{siteId}/contexts/{type}/{id}/threads: the part clients are
 * coupled to.
 */

import type { Comment } from './comment';
import type { ThreadContextRef } from './context';
import type { ThreadOverview, ThreadStatus } from './thread';

export interface PostThreadRequest {
  context: ThreadContextRef;
  documentId?: string;
  branchId?: string;
  body: string;
}

export interface PostCommentRequest {
  body: string;
}

export interface SetThreadStatusRequest {
  status: ThreadStatus;
}

export interface PostCommentResponse {
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
