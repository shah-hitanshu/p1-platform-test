/**
 * Phase 2.2: Authorization System - Branch-Level Authorization
 *
 * Core authorization logic for the collaborative content repository.
 * Calculates effective roles based on Pantheon site roles and branch grants.
 *
 * Effective Role = max(Pantheon Site Role, Branch Grant)
 * Branch grants can elevate access but never restrict it.
 *
 * Supports dual-source role resolution: local database roles + MAS-synced roles.
 * When MAS client is provided, stale cached roles are refreshed from MAS.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Branch-Level Authorization"
 */

import { and, eq, sql } from 'drizzle-orm';
import type {
  AuthenticatedPrincipal,
  RoleName,
  RolePermissions,
  PantheonRole,
} from '../types';
import { branchGrants, branches, userSiteRoles, users } from '../db/schema';
import { db } from '../db/scope';
import type { MASClient } from '../services/mas-client';
import { resolveAgentSiteRole } from '../services/agent-site-role-service';
import { HttpError } from '../services/errors';
import { ROLES, mapPantheonRole, mapAgentRole, maxRole, minRole } from './roles';

/**
 * Result of an effective role calculation.
 */
export interface EffectiveRoleResult {
  role: RolePermissions;
  roleName: RoleName;
}

/**
 * Error thrown when a principal lacks the required permission.
 */
export class AuthorizationError extends HttpError {
  readonly status = 403;

  constructor(
    message: string,
    public readonly requiredPermission: keyof RolePermissions,
    public readonly roleName: RoleName,
  ) {
    super(message);
  }
}

/**
 * Whether an agent principal is forwarding an acting user, whose own access
 * bounds what the agent may do.
 */
export function hasActingUser(principal: AuthenticatedPrincipal): boolean {
  return principal.type === 'agent'
    && principal.actingUserEmail !== undefined
    && principal.actingUserEmail !== '';
}

/**
 * Checks if a principal is a Pantheon user authenticated via Auth0.
 */
export function isPantheonUser(principal: AuthenticatedPrincipal): boolean {
  return principal.type === 'user' &&
    (principal.authProvider === 'auth0' || principal.authProvider === 'broker');
}

/**
 * Gets the site-level role for a principal from the database.
 * Falls back to JWT-embedded roles for backwards compatibility.
 *
 * When masClient is provided and the principal is a Pantheon user,
 * performs dual-source role resolution:
 * 1. Queries both source='local' and source='mas' rows
 * 2. Refreshes stale MAS cache from the MAS API
 * 3. Returns max(localRole, masRole)
 *
 * @param principal - The authenticated principal
 * @param siteId - The site ID
 * @param masClient - Optional MAS client for live role fetching
 * @returns The system role name for this principal on this site
 */
export async function getSiteRole(
  principal: AuthenticatedPrincipal,
  siteId: string,
  masClient?: MASClient,
): Promise<RoleName> {
  if (principal.type === 'agent') {
    // Resolved through the same function the site agent-access list reads, so a
    // global agent's implicit access authorizes exactly as it is displayed. That
    // implicit access needs an acting user to bound it; an explicit grant does not.
    const resolved = await resolveAgentSiteRole(
      principal.id,
      siteId,
      hasActingUser(principal),
    );

    if (resolved !== null) {
      const agentRole = mapAgentRole(resolved.role);

      // Bound the delegated role here rather than only in getEffectiveRole:
      // this function is exported and read directly, so the bound cannot
      // depend on the entry point. minRole makes the later intersection a
      // no-op. An explicit grant is standalone authority and stays as-is.
      if (resolved.implicit && principal.actingUserEmail !== undefined) {
        const actingUserSiteRole = await getActingUserSiteRole(
          principal.actingUserEmail,
          siteId,
        );
        return minRole(agentRole, actingUserSiteRole);
      }

      return agentRole;
    }
  } else if (masClient && isPantheonUser(principal)) {
    // Dual-source resolution for Pantheon users with MAS
    return await getDualSourceRole(principal, siteId, masClient);
  } else {
    // Query user_site_roles table (legacy single-source)
    // Use dbUserId (the DB users.id) when available, falling back to principal.id
    const userId = principal.dbUserId ?? principal.id;
    const rows = await db()
      .select({ role: userSiteRoles.role })
      .from(userSiteRoles)
      .where(and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.siteId, siteId)));

    if (rows[0]) {
      return mapPantheonRole(rows[0].role as PantheonRole);
    }
  }

  // Fallback to JWT-embedded roles for backwards compatibility
  const jwtRole = principal.pantheonSiteRoles[siteId];
  return mapPantheonRole(jwtRole);
}

/**
 * Performs dual-source role resolution for Pantheon users.
 * Queries both local and MAS-synced roles, refreshing stale MAS data.
 */
async function getDualSourceRole(
  principal: AuthenticatedPrincipal,
  siteId: string,
  masClient: MASClient,
): Promise<RoleName> {
  // Query both sources in one query
  // Use dbUserId (the DB users.id) when available, falling back to principal.id
  const userId = principal.dbUserId ?? principal.id;
  const rows = await db()
    .select({
      role: userSiteRoles.role,
      source: userSiteRoles.source,
      updatedAt: userSiteRoles.updatedAt,
    })
    .from(userSiteRoles)
    .where(and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.siteId, siteId)));

  let localRole: RoleName = 'NO_ACCESS';
  let masRole: RoleName = 'NO_ACCESS';
  let masRow: { role: string; updatedAt: Date | null } | null = null;

  for (const row of rows) {
    if (row.source === 'local') {
      localRole = mapPantheonRole(row.role as PantheonRole);
    } else if (row.source === 'mas') {
      masRow = row;
      masRole = mapPantheonRole(row.role as PantheonRole);
    }
  }

  const cacheTtlSeconds = masClient.cacheTtlSeconds;

  // Check if MAS data needs refresh
  const needsRefresh = masRow === null ||
    isMasRowStale(masRow.updatedAt, cacheTtlSeconds);

  if (needsRefresh) {
    try {
      const freshRole = await masClient.getUserSiteRole(userId, siteId);

      if (freshRole !== null) {
        // Upsert the MAS role
        await db()
          .insert(userSiteRoles)
          .values({
            userId,
            siteId,
            role: freshRole,
            source: 'mas',
            updatedAt: sql`NOW()`,
          })
          .onConflictDoUpdate({
            target: [userSiteRoles.userId, userSiteRoles.siteId, userSiteRoles.source],
            set: { role: sql`excluded.role`, updatedAt: sql`NOW()` },
          });
        masRole = mapPantheonRole(freshRole);
      } else if (masRow === null) {
        // No MAS data and fetch returned null - masRole stays NO_ACCESS
        masRole = 'NO_ACCESS';
      }
      // If fetch failed but we have stale data, keep using stale masRole
    } catch {
      // MAS fetch failed - use stale cache if available, otherwise masRole stays as-is
      console.error('MASClient: Failed to refresh MAS role, using cached data');
    }
  }

  // If both sources are NO_ACCESS, fall back to JWT
  if (localRole === 'NO_ACCESS' && masRole === 'NO_ACCESS') {
    const jwtRole = principal.pantheonSiteRoles[siteId];
    return mapPantheonRole(jwtRole);
  }

  return maxRole(localRole, masRole);
}

/**
 * Checks if a MAS cache row is stale based on TTL.
 *
 * A row carrying no refresh time counts as stale, so it is refetched.
 */
function isMasRowStale(updatedAt: Date | null, cacheTtlSeconds: number): boolean {
  if (updatedAt === null) {
    return true;
  }
  const staleThreshold = Date.now() - cacheTtlSeconds * 1000;
  return updatedAt.getTime() < staleThreshold;
}

/**
 * Calculates the effective role for a principal on a specific branch.
 *
 * The effective role is calculated as the maximum of:
 * 1. The principal's site role (from database or JWT fallback)
 * 2. Any branch-level grant for this principal on this branch
 *
 * Branch grants can elevate access but never restrict it.
 *
 * @param principal - The authenticated principal
 * @param siteId - The site ID
 * @param branchId - The branch ID
 * @param masClient - Optional MAS client for live role fetching
 * @returns The effective role and role name
 *
 * @example
 * ```typescript
 * const { role, roleName } = await getEffectiveRole(principal, 'site-1', 'branch-1');
 * if (role.canEditDocuments) {
 *   // Allow document editing
 * }
 * ```
 */
export async function getEffectiveRole(
  principal: AuthenticatedPrincipal,
  siteId: string,
  branchId: string,
  masClient?: MASClient,
): Promise<EffectiveRoleResult> {
  if (principal.type === 'service') {
    // Service principals (sat_ tokens) should be authenticated and asserted independent
  // of the role-based authorization system.
    console.error(
      '[authorization] getEffectiveRole called with a service principal; assertPermission/hasPermission must dispatch service principals to hasServicePermission',
    );
    throw new AuthorizationError(
      'Authorization not available for this principal type.',
      'canView',
      'NO_ACCESS',
    );
  }

  // Superadmins have full access to all sites — that is the role's purpose:
  // Pantheon staff reaching every organization and every site under them.
  //
  // PCC-3479: this used to accept the legacy `admin` value too. Administering a
  // business account is organization_members.role now, and must not carry
  // access to every site on the platform with it.
  if (principal.systemRole === 'superadmin') {
    return {
      role: ROLES.ADMIN,
      roleName: 'ADMIN',
    };
  }

  // Step 1: Get baseline role from database (with JWT fallback)
  const baselineRoleName = await getSiteRole(principal, siteId, masClient);

  // Step 2: Check for branch-level elevation
  const actorId = principal.dbUserId ?? principal.id;
  const branchGrant = await db()
    .select({ siteId: branches.siteId, role: branchGrants.role })
    .from(branches)
    .leftJoin(
      branchGrants,
      and(eq(branchGrants.branchId, branches.id), eq(branchGrants.actorId, actorId)),
    )
    .where(eq(branches.id, branchId));

  // A branch id matching no row is left to the caller, which resolves the branch
  // itself and reports it missing.
  const branchSiteId = branchGrant[0]?.siteId;
  if (branchSiteId !== undefined && branchSiteId !== siteId) {
    return {
      role: ROLES.NO_ACCESS,
      roleName: 'NO_ACCESS',
    };
  }

  const grantRoleName = (branchGrant[0]?.role as RoleName | null | undefined) ?? undefined;

  // Step 3: Effective role is the higher of the two
  const effectiveRoleName = maxRole(baselineRoleName, grantRoleName);

  // Step 4: Permission intersection for acting-user requests
  // When an agent acts on behalf of a user, the effective role is
  // min(agentEffectiveRole, actingUserSiteRole) to prevent privilege escalation.
  let finalRoleName = effectiveRoleName;
  if (hasActingUser(principal) && principal.actingUserEmail !== undefined) {
    const actingUserSiteRole = await getActingUserSiteRole(principal.actingUserEmail, siteId);
    finalRoleName = minRole(effectiveRoleName, actingUserSiteRole);
  }

  return {
    role: ROLES[finalRoleName],
    roleName: finalRoleName,
  };
}

/**
 * Look up an acting user's effective site role from the database.
 * Used for permission intersection when an agent acts on behalf of a user.
 *
 * Lookup path: users.email -> users.id -> user_site_roles.user_id
 *
 * If the user has never been added to the users allowlist, the
 * query returns no rows and the effective role is NO_ACCESS.
 */
async function getActingUserSiteRole(
  actingUserEmail: string,
  siteId: string,
): Promise<RoleName> {
  // users.id is a uuid and user_site_roles.user_id is text, so the join casts.
  const rows = await db()
    .select({ role: userSiteRoles.role, source: userSiteRoles.source })
    .from(userSiteRoles)
    .innerJoin(users, sql`${users.id}::text = ${userSiteRoles.userId}`)
    .where(and(eq(users.email, actingUserEmail.toLowerCase()), eq(userSiteRoles.siteId, siteId)));

  if (rows.length === 0) {
    return 'NO_ACCESS';
  }

  // Resolve dual-source rows (local + MAS) by taking the max role,
  // consistent with getDualSourceRole() behavior.
  let resolvedRole: RoleName = 'NO_ACCESS';
  for (const row of rows) {
    resolvedRole = maxRole(resolvedRole, mapPantheonRole(row.role as PantheonRole));
  }

  return resolvedRole;
}

/**
 * Checks if a principal has a specific permission on a branch.
 *
 * @param principal - The authenticated principal
 * @param siteId - The site ID
 * @param branchId - The branch ID
 * @param permission - The permission to check
 * @param masClient - Optional MAS client for live role fetching
 * @returns True if the principal has the permission
 *
 * @example
 * ```typescript
 * const canEdit = await hasPermission(principal, 'site-1', 'branch-1', 'canEditDocuments');
 * ```
 */
const BRANCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether the named branch is one of the site's.
 *
 * A service token is bound to a site, not a branch, so the branch it names has to
 * be checked against that binding — role resolution, which carries the same rule
 * for users and agents, never runs for a service principal.
 *
 * An id that cannot name a branch — absent, or not a branch id at all — is left to
 * the caller, which resolves the branch itself and reports it missing.
 */
async function branchBelongsToSite(
  branchId: string,
  siteId: string,
): Promise<boolean> {
  if (!BRANCH_ID_PATTERN.test(branchId)) {
    return true;
  }
  const rows = await db()
    .select({ siteId: branches.siteId })
    .from(branches)
    .where(eq(branches.id, branchId));
  const branchSiteId = rows[0]?.siteId;
  return branchSiteId === undefined || branchSiteId === siteId;
}

export async function hasPermission(
  principal: AuthenticatedPrincipal,
  siteId: string,
  branchId: string,
  permission: keyof RolePermissions,
  masClient?: MASClient,
): Promise<boolean> {
  if (principal.type === 'service') {
    return (
      hasServicePermission(principal, siteId) && (await branchBelongsToSite(branchId, siteId))
    );
  }

  const { role } = await getEffectiveRole(principal, siteId, branchId, masClient);
  return role[permission];
}

/**
 * The half of authorization that needs no database state: whether this
 * principal is entitled to ask about this site at all.
 *
 * Split out so a handler can refuse a request before spending a branch or
 * document lookup on it. A service token is bound to one site and the route
 * names the site being asked about, so that comparison is settled from the
 * principal alone. Nothing is deniable this cheaply for a user or an agent:
 * their role lives in the database, and the JWT-embedded role is only a
 * fallback the database can override upward — those callers pass through here
 * and are decided by assertPermission.
 *
 * index.ts checks the same binding on the way in. Route handlers are exported
 * and reachable without it, so this re-checks rather than assumes, the same way
 * assertPermission always has.
 *
 * @throws AuthorizationError if the principal is bound to a different site
 */
export function assertSiteBinding(
  principal: AuthenticatedPrincipal,
  siteId: string,
): void {
  if (principal.type === 'service' && !hasServicePermission(principal, siteId)) {
    throw new AuthorizationError(
      `Service token is not bound to site ${siteId}.`,
      'canView',
      'NO_ACCESS',
    );
  }
}

/**
 * Asserts that a principal has a specific permission on a branch.
 * Throws AuthorizationError if the permission is not granted.
 *
 * Dispatches by principal type:
 * - Service principals (sat_ tokens) are mainly authorised by the scope check
 *   in isServicePrincipalAllowed. This function re-verifies that the request's
 *   siteId matches the token's bound site, and that the branch named belongs to
 *   that site. The `permission` argument is ignored for service principals
 *   because their access is governed by scopes, not roles.
 * - User/agent principals: role-based check via getEffectiveRole.
 *
 * @param principal - The authenticated principal
 * @param siteId - The site ID
 * @param branchId - The branch ID (ignored for service principals)
 * @param permission - The permission to assert (ignored for service principals)
 * @param masClient - Optional MAS client for live role fetching
 * @throws AuthorizationError if the permission is not granted
 *
 * @example
 * ```typescript
 * await assertPermission(principal, 'site-1', 'branch-1', 'canMergeToMain');
 * // If we get here, the principal has the permission
 * ```
 */
export async function assertPermission(
  principal: AuthenticatedPrincipal,
  siteId: string,
  branchId: string,
  permission: keyof RolePermissions,
  masClient?: MASClient,
): Promise<void> {
  if (principal.type === 'service') {
    assertSiteBinding(principal, siteId);
    if (!(await branchBelongsToSite(branchId, siteId))) {
      throw new AuthorizationError(
        `Branch ${branchId} does not belong to site ${siteId}.`,
        'canView',
        'NO_ACCESS',
      );
    }
    return;
  }

  const { role, roleName } = await getEffectiveRole(principal, siteId, branchId, masClient);

  if (!role[permission]) {
    throw new AuthorizationError(
      `Missing permission: ${permission}. Your role (${roleName}) does not grant this permission.`,
      permission,
      roleName,
    );
  }
}

/**
 * Returns true if the principal is a service principal (sat_ token) bound
 * to the given site.
 *
 * Service principals are gated by the scope check at index.ts
 * (isServicePrincipalAllowed), which validates method, handler, and branch
 * constraint against the token's scopes. By the time this runs, that gate
 * has already passed. This function only re-verifies that the request's
 * siteId matches the token's bound siteId.
 *
 * @param principal - The authenticated principal
 * @param siteId - The site ID being accessed
 * @returns True if the principal is a service principal bound to siteId
 */
export  function hasServicePermission(
  principal: AuthenticatedPrincipal,
  siteId: string,
): boolean {
  return principal.type === 'service' && principal.siteId === siteId;
}
