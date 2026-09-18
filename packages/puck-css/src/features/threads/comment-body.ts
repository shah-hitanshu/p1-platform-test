import type { Comment, CommentAuthorType } from '@pantheon-systems/css-client';

// Ids are uuids; the bound keeps a body that opens a token and never closes it from
// being rescanned from every position it could have started at.
const MENTION = /\$\{mention\|(user|agent):([\w-]{1,64})\}/g;

export type CommentBodyPart =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; type: CommentAuthorType; name: string };

/** The body split into runs of text and the members it mentions, in reading order. */
export function commentBodyParts(comment: Comment): CommentBodyPart[] {
  const parts: CommentBodyPart[] = [];
  let last = 0;
  for (const match of comment.body.matchAll(MENTION)) {
    const [token, type, id] = match as unknown as [string, CommentAuthorType, string];
    const mention = comment.mentions.find((m) => m.type === type && m.id === id);
    if (!mention) continue;
    if (match.index > last) parts.push({ kind: 'text', text: comment.body.slice(last, match.index) });
    parts.push({ kind: 'mention', type, name: mention.name ?? 'former member' });
    last = match.index + token.length;
  }
  if (last < comment.body.length) parts.push({ kind: 'text', text: comment.body.slice(last) });
  return parts;
}

/** The body as plain text, with each mention read as the member's name. */
export function commentBodyText(comment: Comment): string {
  return commentBodyParts(comment)
    .map((part) => (part.kind === 'text' ? part.text : `@${part.name}`))
    .join('');
}
