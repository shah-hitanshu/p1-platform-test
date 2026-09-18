/**
 * Mention tokens inside a comment body: `${mention|user:<uuid>}` or
 * `${mention|agent:<uuid>}`. The body is the canonical record of who was
 * mentioned; it is parsed on write to validate against the roster and again
 * on read to hydrate names. Anything not matching the grammar is ordinary text.
 */

import type { MASClient } from '../mas-client';
import { getSiteMembers, type SiteMembers } from '../site-members-service';
import {
  MAX_MENTIONS,
  type Comment,
  type CommentAuthorType,
  type CommentMention,
  type ParsedMention,
  type StoredComment,
} from '../../types/threads';
import { UUID_SOURCE } from '../../utils/uuid';
import { ThreadInputError } from './errors';

export const MENTION_TOKEN_PATTERN = new RegExp(`\\$\\{mention\\|(user|agent):(${UUID_SOURCE})\\}`, 'gi');

/** Every well-formed token in order of appearance, duplicates kept. */
export function parseMentions(body: string): ParsedMention[] {
  return Array.from(body.matchAll(MENTION_TOKEN_PATTERN)).flatMap(([, type, id]) =>
    type !== undefined && id !== undefined
      ? [{ type: type.toLowerCase() as CommentAuthorType, id: id.toLowerCase() }]
      : [],
  );
}

/** The ids not on the roster, so a rejection can name them. Empty means valid. */
export function findUnknownMentions(mentions: ParsedMention[], roster: SiteMembers): ParsedMention[] {
  const userIds = new Set(roster.members.map((member) => member.id));
  const agentIds = new Set(roster.agents.map((agent) => agent.id));
  return mentions.filter((mention) =>
    mention.type === 'user' ? !userIds.has(mention.id) : !agentIds.has(mention.id),
  );
}

/**
 * Checks a body's mentions against the site before it is written. Returns the
 * roster when tokens are present (the response hydrates from it) or null when
 * there are none; throws when a token is over the cap or names a non-member.
 */
export async function resolveMentions(
  siteId: string,
  body: string,
  masClient?: MASClient,
): Promise<SiteMembers | null> {
  const mentions = parseMentions(body);
  if (mentions.length === 0) return null;
  if (mentions.length > MAX_MENTIONS) {
    throw new ThreadInputError('body', `A comment may mention at most ${String(MAX_MENTIONS)} members`);
  }

  const roster = await getSiteMembers(siteId, masClient);
  const unknown = findUnknownMentions(mentions, roster);
  if (unknown.length > 0) {
    const named = unknown.map((mention) => `${mention.type}:${mention.id}`).join(', ');
    throw new ThreadInputError(
      'body',
      `Mentioned members are not on this site: ${named}`,
      unknown.map((mention) => `unknown ${mention.type} ${mention.id}`),
    );
  }
  return roster;
}

/** Unique mentions with roster names; a departed member keeps its id with a null name. */
export function hydrateMentions(body: string, roster: SiteMembers): CommentMention[] {
  const users = new Map(roster.members.map((member) => [member.id, member.name]));
  const agents = new Map(roster.agents.map((agent) => [agent.id, agent.name]));
  const seen = new Set<string>();
  const hydrated: CommentMention[] = [];

  for (const mention of parseMentions(body)) {
    const key = `${mention.type}:${mention.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = mention.type === 'user' ? users.get(mention.id) : agents.get(mention.id);
    hydrated.push({ type: mention.type, id: mention.id, name: name ?? null });
  }

  return hydrated;
}

export function withMentions(comment: StoredComment, roster: SiteMembers | null): Comment {
  return { ...comment, mentions: roster === null ? [] : hydrateMentions(comment.body, roster) };
}

/** Hydrates one stored comment, fetching the roster only when its body has a token. */
export async function hydrateComment(siteId: string, comment: StoredComment, masClient?: MASClient): Promise<Comment> {
  const roster = parseMentions(comment.body).length > 0 ? await getSiteMembers(siteId, masClient) : null;
  return withMentions(comment, roster);
}

/** Hydrates a thread's comments, fetching the roster only when some body has a token. */
export async function hydrateComments(
  siteId: string,
  comments: StoredComment[],
  masClient?: MASClient,
): Promise<Comment[]> {
  const anyMentions = comments.some((comment) => parseMentions(comment.body).length > 0);
  const roster = anyMentions ? await getSiteMembers(siteId, masClient) : null;
  return comments.map((comment) => withMentions(comment, roster));
}
