import type { CommentAuthor } from './actor';
import type { Comment } from './comment';
import type { ThreadOverview } from './thread';

/**
 * What every write announces after commit. Realtime fan-out subscribes here;
 * the ids in the payload are the idempotency keys (`comment.id`, or
 * `thread.id` + `thread.updatedAt`).
 */
export type ThreadEvent =
  | { type: 'comment_posted'; siteId: string; thread: ThreadOverview; comment: Comment }
  | { type: 'thread_status_changed'; siteId: string; thread: ThreadOverview; actor: CommentAuthor };
