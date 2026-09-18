import type { ActorType } from '../enums';

/** Only users and agents take part in threads. */
export type CommentAuthorType = Extract<ActorType, 'user' | 'agent'>;

/** Who is writing, as the service records it. Names come from the roster at read time. */
export interface ThreadActor {
  type: CommentAuthorType;
  id: string;
  /** The user an agent is acting for, when known. */
  actingUserId?: string;
}

/** Author fields match the members roster so the UI renders both with one component. */
export interface CommentAuthor {
  type: CommentAuthorType;
  id: string;
  name: string | null;
  avatar: string | null;
  /** Present when an agent posted on a user's behalf. */
  requestedBy?: { id: string; name: string | null };
}
