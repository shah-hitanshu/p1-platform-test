import type { CommentAuthorType } from './actor';

/** One `${mention|type:id}` token as it appears in a body, before roster lookup. */
export interface ParsedMention {
  type: CommentAuthorType;
  id: string;
}
