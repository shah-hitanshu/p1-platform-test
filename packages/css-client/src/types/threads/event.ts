import type { Comment, CommentAuthor } from './comment.js';
import type { ThreadOverview } from './thread.js';

/**
 * Announced by the service after every thread write. The realtime
 * channel delivers these to other editors; a client applies its own writes
 * through the same shape.
 */
export type ThreadEvent =
  | { type: 'comment_posted'; siteId: string; thread: ThreadOverview; comment: Comment }
  | { type: 'thread_status_changed'; siteId: string; thread: ThreadOverview; actor: CommentAuthor };
