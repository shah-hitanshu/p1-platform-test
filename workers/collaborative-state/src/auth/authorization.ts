/**
 * Phase 2.2: Authorization System - Branch-Level Authorization
 *
 * Core authorization logic for the collaborative state system.
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

import type {
  AuthenticatedPrincipal,
  RoleName,
  RolePermissions,
  AgentSiteRole,
  PantheonRole,
} from '../types';
import { query } from '../db';
import { ROLES, mapPantheonRole, mapAgentRole, maxRole, minRole } from './roles';
import type { MASClient } from '../services/mas-client';

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
export class AuthorizationError extends Error {
  public readonly name = 'AuthorizationError';

  constructor(
    message: string,
    public readonly requiredPermission: keyof RolePermissions,
    public readonly roleName: RoleName,
  ) {
    super(message);
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
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
    // Query agent_site_roles table
    const result = await query<{ role: AgentSiteRole }>(
      `SELECT role FROM app.agent_site_roles
       WHERE agent_id = $1 AND site_id = $2`,
      [principal.id, siteId],
    );

    if (result.rows[0]) {
      return mapAgentRole(result.rows[0].role);
    }
  } else if (masClient && isPantheonUser(principal)) {
    // Dual-source resolution for Pantheon users with MAS
    return await getDualSourceRole(principal, siteId, masClient);
  } else {
    // Query user_site_roles table (legacy single-source)
    // Use dbUserId (the DB users.id) when available, falling back to principal.id
    const userId = principal.dbUserId ?? principal.id;
    const result = await query<{ role: PantheonRole }>(
      `SELECT role FROM app.user_site_roles
       WHERE user_id = $1 AND site_id = $2`,
      [userId, siteId],
    );

    if (result.rows[0]) {
      return mapPantheonRole(result.rows[0].role);
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
  const result = await query<{ role: PantheonRole; source: string; updated_at: string }>(
    `SELECT role, source, updated_at FROM app.user_site_roles
     WHERE user_id = $1 AND site_id = $2`,
    [userId, siteId],
  );

  let localRole: RoleName = 'NO_ACCESS';
  let masRole: RoleName = 'NO_ACCESS';
  let masRow: { role: PantheonRole; updated_at: string } | null = null;

  for (const row of result.rows) {
    if (row.source === 'local') {
      localRole = mapPantheonRole(row.role);
    } else if (row.source === 'mas') {
      masRow = row;
      masRole = mapPantheonRole(row.role);
    }
  }

  const cacheTtlSeconds = masClient.cacheTtlSeconds;

  // Check if MAS data needs refresh
  const needsRefresh = masRow === null ||
    isMasRowStale(masRow.updated_at, cacheTtlSeconds);

  if (needsRefresh) {
    try {
      const freshRole = await masClient.getUserSiteRole(userId, siteId);

      if (freshRole !== null) {
        // Upsert the MAS role
        await query(
          `INSERT INTO app.user_site_roles (user_id, site_id, role, source, updated_at)
           VALUES ($1, $2, $3, 'mas', NOW())
           ON CONFLICT (user_id, site_id, source)
           DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
          [userId, siteId, freshRole],
        );
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
 */
function isMasRowStale(updatedAt: string, cacheTtlSeconds: number): boolean {
  const updatedTime = new Date(updatedAt).getTime();
  const staleThreshold = Date.now() - cacheTtlSeconds * 1000;
  return updatedTime < staleThreshold;
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

  // System admins have full access to all sites
  if (principal.systemRole === 'admin') {
    return {
      role: ROLES.ADMIN,
      roleName: 'ADMIN',
    };
  }

  // Step 1: Get baseline role from database (with JWT fallback)
  const baselineRoleName = await getSiteRole(principal, siteId, masClient);

  // Step 2: Check for branch-level elevation
  const actorId = principal.dbUserId ?? principal.id;
  const branchGrant = await query<{ site_id: string; role: RoleName | null }>(
    `SELECT b.site_id, bg.role
       FROM app.branches b
       LEFT JOIN app.branch_grants bg
         ON bg.branch_id = b.id AND bg.actor_id = $2
      WHERE b.id = $1`,
    [branchId, actorId],
  );

  // A branch id matching no row is left to the caller, which resolves the branch
  // itself and reports it missing.
  const branchSiteId = branchGrant.rows[0]?.site_id;
  if (branchSiteId !== undefined && branchSiteId !== siteId) {
    return {
      role: ROLES.NO_ACCESS,
      roleName: 'NO_ACCESS',
    };
  }

  const grantRoleName = branchGrant.rows[0]?.role ?? undefined;

  // Step 3: Effective role is the higher of the two
  const effectiveRoleName = maxRole(baselineRoleName, grantRoleName);

  // Step 4: Permission intersection for acting-user requests
  // When an agent acts on behalf of a user, the effective role is
  // min(agentEffectiveRole, actingUserSiteRole) to prevent privilege escalation.
  let finalRoleName = effectiveRoleName;
  if (principal.type === 'agent' && principal.actingUserEmail !== undefined && principal.actingUserEmail !== '') {
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
async function getActingUserSiteRole(actingUserEmail: string, siteId: string): Promise<RoleName> {
  const result = await query<{ role: PantheonRole; source: string }>(
    `SELECT usr.role, usr.source FROM app.user_site_roles usr
     JOIN app.users u ON u.id::text = usr.user_id
     WHERE u.email = $1 AND usr.site_id = $2`,
    [actingUserEmail.toLowerCase(), siteId],
  );

  if (result.rows.length === 0) {
    return 'NO_ACCESS';
  }

  // Resolve dual-source rows (local + MAS) by taking the max role,
  // consistent with getDualSourceRole() behavior.
  let resolvedRole: RoleName = 'NO_ACCESS';
  for (const row of result.rows) {
    resolvedRole = maxRole(resolvedRole, mapPantheonRole(row.role));
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
async function branchBelongsToSite(branchId: string, siteId: string): Promise<boolean> {
  if (!BRANCH_ID_PATTERN.test(branchId)) {
    return true;
  }
  const result = await query<{ site_id: string }>(
    'SELECT site_id FROM app.branches WHERE id = $1',
    [branchId],
  );
  const branchSiteId = result.rows[0]?.site_id;
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
    return hasServicePermission(principal, siteId) && (await branchBelongsToSite(branchId, siteId));
  }

  const { role } = await getEffectiveRole(principal, siteId, branchId, masClient);
  return role[permission];
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
    if (!hasServicePermission(principal, siteId)) {
      throw new AuthorizationError(
        `Service token is not bound to site ${siteId}.`,
        'canView',
        'NO_ACCESS',
      );
    }
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
