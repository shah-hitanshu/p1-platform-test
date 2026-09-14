/**
 * Organization access checks.
 *
 * Shared by every org-scoped route so "who can see this business account"
 * has one answer. Membership is the same notion site listing already uses:
 * a row in organization_members, or a site role on one of the org's sites
 * (see handleListSites).
 */

import type { AuthenticatedPrincipal } from '../types';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  ORG_ADMIN_ROLES,
} from '../services/organization-service';
import { getAgentById } from '../services/agent-service';
import { isSuperAdmin } from './admin-check';
import { normalizePrincipalIdForDb } from '../auth/principal-id-normalization';
import { organizationMembers, sites, userSiteRoles, users } from '../db/schema';
import { db } from '../db/scope';

/** The principal fields an org access check needs. */
export type OrgAccessPrincipal = Pick<
  AuthenticatedPrincipal,
  'id' | 'type' | 'systemRole' | 'dbUserId'
> & { actingUserEmail?: string };

/**
 * The app.users id behind a user principal.
 *
 * Prefers what the request gate attached. Mock-auth deployments skip that gate
 * entirely, so nothing sets dbUserId there and every org check below would
 * refuse a genuine member — look the row up by the same normalized principal id
 * the writers stamp.
 */
export async function resolveUserId(
  principal: OrgAccessPrincipal,
): Promise<string | undefined> {
  if (principal.dbUserId !== undefined) {
    return principal.dbUserId;
  }
  if (principal.type !== 'user') {
    return undefined;
  }
  const rows = await db()
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.principalId, await normalizePrincipalIdForDb(principal.id)),
        eq(users.isActive, true),
      ),
    );
  return rows[0]?.id;
}

/**
 * Whether a principal may act inside an organization.
 *
 * Superadmins pass for every org — that is the whole point of the role.
 *
 * An agent belongs to exactly one organization, and inside it the agent is the
 * member — it has no dbUserId and needs no person to vouch for it. css-client
 * sends no acting-user headers, so without this an agent reading or updating
 * its own record gets 403 from its own account's routes.
 *
 * Status is checked here because nothing upstream does: validateKey matches on
 * the key hash and revoked_at only, so a suspended or disabled agent still
 * authenticates. Making a new grant path ignore status would render the field
 * decorative.
 *
 * An agent forwarding an acting user is otherwise checked against that user,
 * mirroring handleListSites; an agent that is neither in the org nor carrying a
 * resolvable acting user has no membership to check and is refused.
 */
export async function canAccessOrganization(
  principal: OrgAccessPrincipal,
  organizationId: string,
): Promise<boolean> {
  if (organizationId === '') {
    return false;
  }

  if (await isSuperAdmin(principal)) {
    return true;
  }

  if (principal.type === 'agent') {
    const agent = await getAgentById(principal.id);
    if (
      agent !== null
      && agent.organizationId === organizationId
      && agent.status === 'active'
    ) {
      return true;
    }
  }

  let userId = await resolveUserId(principal);

  if (
    userId === undefined
    && principal.type === 'agent'
    && principal.actingUserEmail !== undefined
    && principal.actingUserEmail !== ''
  ) {
    const actingUserRows = await db()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, principal.actingUserEmail.toLowerCase()), eq(users.isActive, true)));
    userId = actingUserRows[0]?.id;
  }

  if (userId === undefined) {
    return false;
  }

  // Check active direct membership OR site-role access. A deactivated direct
  // member can still reach the org through a site grant, but not through their
  // (suspended) membership row alone.
  const membershipRows = await db()
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.isActive, true),
      ),
    )
    .limit(1);
  if (membershipRows.length > 0) {
    return true;
  }

  const siteRoleRows = await db()
    .select({ id: userSiteRoles.id })
    .from(userSiteRoles)
    .innerJoin(users, sql`${users.id}::text = ${userSiteRoles.userId}`)
    .innerJoin(sites, eq(sites.id, userSiteRoles.siteId))
    .where(and(eq(users.id, userId), eq(sites.organizationId, organizationId), isNull(sites.archivedAt)))
    .limit(1);
  return siteRoleRows.length > 0;
}

/**
 * Whether a principal administers a business account (PCC-3479).
 *
 * This is the gate on everything that manages an account's roster: its users,
 * its agents, and those agents' API keys. It is deliberately *not*
 * app.users.system_role — that role is platform-wide, and with self-service
 * onboarding creating an account for everyone who signs up, using it here would
 * make each of them an admin of every account they were ever invited to.
 *
 * Only a direct membership row carries the admin role. Reaching an org through
 * a site grant makes you a member of it, never its administrator; and unlike
 * canAccessOrganization there is no acting-user fallback, so an agent never
 * administers an account on a person's behalf.
 *
 * `owner` counts as admin — it is the same authority plus the guarantee that
 * the roster API will not demote or remove them. An account created by
 * createOrgForUser has an owner and no separate admin, so treating the two
 * apart here would lock every self-service account out of its own roster.
 *
 * Superadmins pass everywhere, same as canAccessOrganization.
 */
export async function isOrgAdmin(
  principal: OrgAccessPrincipal,
  organizationId: string,
): Promise<boolean> {
  if (organizationId === '') {
    return false;
  }

  if (await isSuperAdmin(principal)) {
    return true;
  }

  const userId = await resolveUserId(principal);
  if (userId === undefined) {
    return false;
  }

  // Deactivated members lose their admin authority; the membership row exists
  // but is_active = false means "suspended from this account".
  const rows = await db()
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.isActive, true),
      ),
    );
  const role = rows[0]?.role;
  return role !== undefined && ORG_ADMIN_ROLES.includes(role as typeof ORG_ADMIN_ROLES[number]);
}
