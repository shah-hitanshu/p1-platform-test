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
