/**
 * Everyone who collaborates on one site, as the two lists the members endpoint
 * serves.
 *
 * Two sources have to agree on the human half. app.user_site_roles is local and
 * knowingly incomplete — rows for MAS users are a cache populated only for
 * people authorized recently — so the upstream roster, which is the authority
 * on who belongs to a Pantheon site, is unioned in.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import { mapPantheonRole, maxRole } from '../auth/roles';
import { query } from '../db';
import type { AgentSiteRole, PantheonRole } from '../types';
import { listRolesBySite } from './agent-site-role-service';
import type { MASClient } from './mas-client';
import { getSiteRoster, type RosterSource } from './mas-roster-cache';

/** Where a person's role came from. 'mas' means it exists only upstream. */
export type SiteMemberSource = 'local' | 'mas';

export interface SiteMemberUser {
  id: string;
  /** Null for someone known upstream who has never signed in here. */
  name: string | null;
  email: string | null;
  role: PantheonRole;
  avatar: string | null;
  source: SiteMemberSource;
}

export interface SiteMemberAgent {
  id: string;
  name: string;
  role: AgentSiteRole;
  /** Agents carry no stored image; clients derive one from the id. */
  avatar: null;
  /** True when the agent reaches every site rather than holding a grant here. */
  isGlobal: boolean;
}

/** Neither half decides a fold alone: the role gives the tier, the source breaks a tie. */
export interface RoleGrant {
  role: PantheonRole;
  source: SiteMemberSource;
}

/** For logging. 'unconfigured' — no MAS client bound — is by design, not a failure. */
export type MembersRosterSource = RosterSource | 'unconfigured';

export interface SiteMembers {
  members: SiteMemberUser[];
  agents: SiteMemberAgent[];
  rosterSource: MembersRosterSource;
}

/** Members keyed by user id, so two rows for one person can be folded. */
type MemberIndex = Map<string, SiteMemberUser>;

/** The LEFT JOIN, not the columns, is why name, email and avatar_url are nullable here. */
interface MemberRow {
  user_id: string;
  role: PantheonRole;
  source: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

/** The agent half shares no input with the human half, so the two I/O paths run together. */
export async function getSiteMembers(siteId: string, masClient?: MASClient): Promise<SiteMembers> {
  const [{ members, rosterSource }, agents] = await Promise.all([
    resolveMembers(siteId, masClient),
    loadAgents(siteId),
  ]);

  return { members, agents, rosterSource };
}

async function resolveMembers(
  siteId: string,
  masClient?: MASClient,
): Promise<{ members: SiteMemberUser[]; rosterSource: MembersRosterSource }> {
  const members = await loadLocalMembers(siteId);

  const rosterSource: MembersRosterSource =
    masClient === undefined ? 'unconfigured' : await mergeUpstreamMembers(siteId, members, masClient);

  return { members: Array.from(members.values()), rosterSource };
}

/**
 * The stronger of two grants for the same person. mapPantheonRole flattens
 * developer/team_member/author/editor onto one tier, so two roles can rank
 * equal without being equal; a local grant wins that tie, having been made
 * against this site deliberately. Taking the maximum is how authorization
 * resolves an effective role, so anything weaker would misreport access.
 */
export function strongerGrant(current: RoleGrant, candidate: RoleGrant): RoleGrant {
  const currentTier = mapPantheonRole(current.role);
  const candidateTier = mapPantheonRole(candidate.role);

  if (currentTier === candidateTier) {
    return current.source === 'local' ? current : candidate;
  }

  return maxRole(currentTier, candidateTier) === currentTier ? current : candidate;
}

/** The column is a bare string; an unknown value is likelier a new local grant than a MAS one. */
export function normalizeSource(source: string): SiteMemberSource {
  return source === 'mas' ? 'mas' : 'local';
}

/**
 * Keyed by id so the MAS merge can fold someone in one step. Ordered by
 * created_at because folding two rows for one person must not depend on the
 * planner.
 */
async function loadLocalMembers(siteId: string): Promise<MemberIndex> {
  const result = await query<MemberRow>(
    `SELECT usr.user_id, usr.role, usr.source,
            u.name, u.email, u.avatar_url
     FROM app.user_site_roles usr
     LEFT JOIN app.users u ON u.id::text = usr.user_id
     WHERE usr.site_id = $1
     ORDER BY usr.created_at ASC`,
    [siteId],
  );

  const members: MemberIndex = new Map();

  for (const row of result.rows) {
    const grant = { role: row.role, source: normalizeSource(row.source) };
    const existing = members.get(row.user_id);

    if (existing === undefined) {
      members.set(row.user_id, {
        id: row.user_id,
        name: row.name,
        email: row.email,
        avatar: row.avatar_url,
        ...grant,
      });
      continue;
    }

    members.set(row.user_id, { ...existing, ...strongerGrant(existing, grant) });
  }

  return members;
}

/**
 * An upstream outage is not a reason to fail: the roster comes back null and the
 * locally-known members are still a useful answer. The returned source is the
 * only evidence of whether the memo is working.
 */
async function mergeUpstreamMembers(
  siteId: string,
  members: MemberIndex,
  masClient: MASClient,
): Promise<MembersRosterSource> {
  const { roster, source } = await getSiteRoster(siteId, masClient);

  if (roster === null) {
    getLogger().warn('site members: MAS roster unavailable, serving local grants only', {
      site_id: siteId,
      outcome: 'degraded',
    });
    return source;
  }

  const introduced: string[] = [];

  for (const membership of roster) {
    const grant = { role: membership.role, source: 'mas' as const };
    const existing = members.get(membership.userId);

    if (existing === undefined) {
      members.set(membership.userId, {
        id: membership.userId,
        name: null,
        email: null,
        avatar: null,
        ...grant,
      });
      introduced.push(membership.userId);
      continue;
    }

    members.set(membership.userId, { ...existing, ...strongerGrant(existing, grant) });
  }

  await hydrateIntroduced(introduced, members);

  return source;
}

/**
 * People the roster introduced hold no role row, so loadLocalMembers' join
 * never saw them — but they may have signed in. Anyone with no app.users row
 * keeps a null name: appearing in a picker unnamed beats not appearing.
 */
async function hydrateIntroduced(userIds: string[], members: MemberIndex): Promise<void> {
  if (userIds.length === 0) return;

  const result = await query<{
    id: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  }>(
    `SELECT id::text AS id, name, email, avatar_url
     FROM app.users
     WHERE id::text = ANY($1)`,
    [userIds],
  );

  for (const row of result.rows) {
    const member = members.get(row.id);
    if (member === undefined) continue;

    members.set(row.id, {
      ...member,
      name: row.name,
      email: row.email,
      avatar: row.avatar_url,
    });
  }
}

/**
 * Keyed on agentId, not the row's own `id`: listRolesBySite synthesizes a
 * global agent with no grant behind it, so there `id` is already the agent's
 * and is the wrong thing to hand a client as a stable identifier.
 */
async function loadAgents(siteId: string): Promise<SiteMemberAgent[]> {
  const roles = await listRolesBySite(siteId);

  return roles.map((role) => ({
    id: role.agentId,
    name: role.agentName,
    role: role.role,
    avatar: null,
    isGlobal: role.isGlobal,
  }));
}
