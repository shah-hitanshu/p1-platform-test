import type { CommentAuthor } from './actor';
import type { ThreadContextRef } from './context';

export const THREAD_STATUSES = ['open', 'resolved'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

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
