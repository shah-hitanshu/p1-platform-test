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
  return principal.type === 'user' && principal.authProvider === 'auth0';
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
async function getSiteRole(
  principal: AuthenticatedPrincipal,
  siteId: string,
  masClient?: MASClient,
): Promise<RoleName> {
  if (principal.type === 'agent') {
    // Query agent_site_roles table
    const result = await query<{ role: AgentSiteRole }>(
      `SELECT role FROM agent_site_roles
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
      `SELECT role FROM user_site_roles
       WHERE user_id = $1 AND site_id = $2`,
      [userId, siteId],
    );

    if (result.rows[0]) {
      return mapPantheonRole(result.rows[0].role);
    }

    // TODO: Remove this default ADMIN grant once proper role management is in place.
    // To replace: add a role assignment step (e.g. auto-assign on site creation,
    // or via the collaborator API POST /api/sites/{siteId}/collaborators), then
    // delete this return so users without an explicit DB role get NO_ACCESS again.
    return 'ADMIN';
  }

  // Fallback to JWT-embedded roles for backwards compatibility (agents only)
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
  const branchGrant = await query<{ role: RoleName }>(
    `SELECT role FROM branch_grants
     WHERE branch_id = $1 AND actor_id = $2`,
    [branchId, actorId],
  );

  const grantRoleName = branchGrant.rows[0]?.role;

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
export async function hasPermission(
  principal: AuthenticatedPrincipal,
  siteId: string,
  branchId: string,
  permission: keyof RolePermissions,
  masClient?: MASClient,
): Promise<boolean> {
  const { role } = await getEffectiveRole(principal, siteId, branchId, masClient);
  return role[permission];
}

/**
 * Asserts that a principal has a specific permission on a branch.
 * Throws AuthorizationError if the permission is not granted.
 *
 * @param principal - The authenticated principal
 * @param siteId - The site ID
 * @param branchId - The branch ID
 * @param permission - The permission to assert
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
  const { role, roleName } = await getEffectiveRole(principal, siteId, branchId, masClient);

  if (!role[permission]) {
    throw new AuthorizationError(
      `Missing permission: ${permission}. Your role (${roleName}) does not grant this permission.`,
      permission,
      roleName,
    );
  }
}
