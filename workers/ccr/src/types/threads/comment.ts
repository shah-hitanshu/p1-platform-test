import type { CommentAuthor, CommentAuthorType } from './actor';

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
  /** Plain text with inline `${mention|user:uuid}` tokens; see the mentions service. */
  body: string;
  author: CommentAuthor;
  mentions: CommentMention[];
  createdAt: string;
  /** Editing is not built yet; always null for now. */
  editedAt: string | null;
}

/** A comment as persisted, before its mention tokens are hydrated against the roster. */
export type StoredComment = Omit<Comment, 'mentions'>;
