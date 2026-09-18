import type { CommentAuthor } from './actor';
import type { Comment } from './comment';
import type { ThreadOverview } from './thread';

/**
 * What every write announces after commit. Realtime fan-out subscribes here;
 * the ids in the payload are the idempotency keys (`comment.id`, or
 * `thread.id` + `thread.updatedAt`). `comment_updated` carries the whole comment
 * as it now stands: an agent's working line becoming its answer, or a proposal
 * being accepted or dismissed.
 */
export type ThreadEvent =
  | {
    type: 'comment_posted';
    siteId: string;
    thread: ThreadOverview;
    comment: Comment;
    /** The poster with their email, when the roster has it, for consumers that act on their behalf. */
    requester?: { id: string; email: string; name: string | null };
  }
  | { type: 'comment_updated'; siteId: string; thread: ThreadOverview; comment: Comment }
  | { type: 'thread_status_changed'; siteId: string; thread: ThreadOverview; actor: CommentAuthor };

/** The event as sent to other editors: everything but the requester's email. */
export type ThreadBroadcast =
  | { type: 'comment_posted'; siteId: string; thread: ThreadOverview; comment: Comment }
  | { type: 'comment_updated'; siteId: string; thread: ThreadOverview; comment: Comment }
  | { type: 'thread_status_changed'; siteId: string; thread: ThreadOverview; actor: CommentAuthor };

export function toThreadBroadcast(event: ThreadEvent): ThreadBroadcast {
  switch (event.type) {
    case 'comment_posted':
      return { type: event.type, siteId: event.siteId, thread: event.thread, comment: event.comment };
    case 'comment_updated':
      return { type: event.type, siteId: event.siteId, thread: event.thread, comment: event.comment };
    case 'thread_status_changed':
      return { type: event.type, siteId: event.siteId, thread: event.thread, actor: event.actor };
  }
}
