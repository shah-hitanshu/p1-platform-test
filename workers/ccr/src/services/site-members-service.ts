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
import { asc, eq, sql } from 'drizzle-orm';
import { mapPantheonRole, maxRole } from '../auth/roles';
import { db } from '../db/scope';
import { users, userSiteRoles } from '../db/schema';
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

/** The LEFT JOIN, not the columns, is why name, email and avatarUrl are nullable here. */
interface MemberRow {
  userId: string;
  role: PantheonRole;
  source: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
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
  // app.users.id is uuid and user_site_roles.user_id is text, so the join casts
  // rather than comparing across types.
  const rows: MemberRow[] = await db()
    .select({
      userId: userSiteRoles.userId,
      role: sql<PantheonRole>`${userSiteRoles.role}`,
      source: userSiteRoles.source,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(userSiteRoles)
    .leftJoin(users, eq(sql`${users.id}::text`, userSiteRoles.userId))
    .where(eq(userSiteRoles.siteId, siteId))
    .orderBy(asc(userSiteRoles.createdAt));

  const members: MemberIndex = new Map();

  for (const row of rows) {
    const grant = { role: row.role, source: normalizeSource(row.source) };
    const existing = members.get(row.userId);

    if (existing === undefined) {
      members.set(row.userId, {
        id: row.userId,
        name: row.name,
        email: row.email,
        avatar: row.avatarUrl,
        ...grant,
      });
      continue;
    }

    members.set(row.userId, { ...existing, ...strongerGrant(existing, grant) });
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

  // The ids arrive as text and the column is uuid. The array is bound through
  // sql.param: interpolated directly, the sql tag spreads it into a row
  // constructor, which ANY cannot read as an array.
  const rows = await db()
    .select({
      id: sql<string>`${users.id}::text`,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(sql`${users.id}::text = ANY(${sql.param(userIds)}::text[])`);

  for (const row of rows) {
    const member = members.get(row.id);
    if (member === undefined) continue;

    members.set(row.id, {
      ...member,
      name: row.name,
      email: row.email,
      avatar: row.avatarUrl,
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
