import type { Principal } from '../index.js';

export type CommentAuthorType = Principal['type'];

/**
 * Who wrote a comment. Fields match the site members roster so one component
 * renders both.
 */
export interface CommentAuthor {
  type: CommentAuthorType;
  id: string;
  name: string | null;
  avatar: string | null;
  /** Present when an agent posted on a user's behalf. */
  requestedBy?: { id: string; name: string | null };
}

export interface CommentMention {
  type: CommentAuthorType;
  id: string;
  /** Null when the mentioned member has since left the site. */
  name: string | null;
}

export interface Comment {
  id: string;
  threadId: string;
  kind: 'message';
  /** Plain text with inline `${mention|user:uuid}` tokens. */
  body: string;
  author: CommentAuthor;
  mentions: CommentMention[];
  createdAt: string;
  editedAt: string | null;
}
