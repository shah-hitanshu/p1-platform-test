import type { CommentAuthor } from './comment.js';
import type { ThreadContextRef } from './context.js';

export type ThreadStatus = 'open' | 'resolved';

/**
 * A thread without its comments: enough to draw a trigger's count and
 * resolved state.
 */
export interface ThreadOverview {
  id: string;
  siteId: string;
  context: ThreadContextRef;
  documentId: string | null;
  status: ThreadStatus;
  commentCount: number;
  lastCommentAt: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: CommentAuthor | null;
}
