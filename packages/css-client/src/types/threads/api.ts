import type { Comment } from './comment.js';
import type { ThreadContextRef } from './context.js';
import type { ThreadOverview, ThreadStatus } from './thread.js';

export interface PostThreadParams {
  context: ThreadContextRef;
  /** Required for block and page threads, not allowed on site and workstream threads. */
  documentId?: string;
  branchId?: string;
  body: string;
}

export interface PostCommentResult {
  thread: ThreadOverview;
  comment: Comment;
}

export interface ThreadWithComments {
  thread: ThreadOverview;
  comments: Comment[];
}

export interface ListThreadsOptions {
  /** Narrow to one page's threads: one overview per context on that page. */
  documentId?: string;
  status?: ThreadStatus | 'all';
  limit?: number;
  cursor?: string;
}

export interface ThreadListPage {
  threads: ThreadOverview[];
  nextCursor: string | null;
}
