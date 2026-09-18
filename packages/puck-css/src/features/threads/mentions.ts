/**
 * Mentions in a draft: finding the one being typed, putting a chosen one in, and
 * turning the names back into tokens when the draft is sent.
 *
 * The draft is plain text, so a mention is carried as `@Full Name` while it is being
 * written and only becomes a `${mention|type:id}` token on the way out. The names the
 * reader picked are remembered so that the same text typed by hand, or a name that
 * two members share, does not turn into a mention of someone they never chose.
 */
import type {
  AgentSiteRole,
  CommentAuthorType,
  SiteMemberRole,
  SiteMembers,
} from '@pantheon-systems/css-client';

export interface MentionCandidate {
  type: CommentAuthorType;
  id: string;
  name: string;
  role: string;
  avatar: string | null;
}

/** Where in the draft the mention being typed sits, and what has been typed so far. */
export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** Just past the last character of the query. */
  end: number;
  query: string;
}

const USER_ROLE_LABEL: Record<SiteMemberRole, string> = {
  owner: 'Site owner',
  admin: 'Admin',
  developer: 'Developer',
  team_member: 'Team member',
  author: 'Author',
  editor: 'Editor',
};

const AGENT_ROLE_LABEL: Record<AgentSiteRole, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  admin: 'Admin',
};

/** Agents first, then people; someone with no name to show is left out. */
export function mentionCandidates(roster: SiteMembers): MentionCandidate[] {
  const agents = roster.agents.map<MentionCandidate>((agent) => ({
    type: 'agent',
    id: agent.id,
    name: agent.name,
    role: AGENT_ROLE_LABEL[agent.role] ?? agent.role,
    avatar: null,
  }));
  const members = roster.members.flatMap<MentionCandidate>((member) => {
    const name = member.name ?? member.email;
    if (!name) return [];
    return [{ type: 'user', id: member.id, name, role: USER_ROLE_LABEL[member.role] ?? member.role, avatar: member.avatar }];
  });
  return [...agents, ...members];
}

export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...candidates];
  return candidates.filter((c) => c.name.toLowerCase().includes(needle));
}

/**
 * The mention being typed at the caret, if there is one: an `@` that starts a word,
 * with no whitespace between it and the caret. `@` followed by a space is a plain
 * at-sign, and so is one in the middle of an email address.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start === -1) return null;
  if (start > 0 && !/\s/.test(before[start - 1] ?? '')) return null;
  const query = before.slice(start + 1);
  if (/\s/.test(query)) return null;
  return { start, end: caret, query };
}

/** Puts the chosen name where the query was, followed by a space so typing carries on. */
export function insertMention(
  text: string,
  at: MentionQuery,
  candidate: MentionCandidate,
): { text: string; caret: number } {
  const inserted = `@${candidate.name} `;
  return {
    text: text.slice(0, at.start) + inserted + text.slice(at.end),
    caret: at.start + inserted.length,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces each chosen name still present in the draft with its token. Longer names go
 * first so "@Marco Reyes" is never read as "@Marco" plus " Reyes".
 */
export function serializeMentions(text: string, chosen: readonly MentionCandidate[]): string {
  const byLength = [...chosen].sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const candidate of byLength) {
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(candidate.name)}(?![^\\s.,;:!?)])`, 'g');
    out = out.replace(pattern, `$1\${mention|${candidate.type}:${candidate.id}}`);
  }
  return out;
}
