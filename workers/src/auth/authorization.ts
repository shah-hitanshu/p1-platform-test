/**
 * Phase 2.2: Authorization System - Branch-Level Authorization
 *
 * Core authorization logic for the collaborative state system.
 * Calculates effective roles based on Pantheon site roles and branch grants.
 *
 * Effective Role = max(Pantheon Site Role, Branch Grant)
 * Branch grants can elevate access but never restrict it.
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
import { ROLES, mapPantheonRole, mapAgentRole, maxRole } from './roles';

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
 * Gets the site-level role for a principal from the database.
 * Falls back to JWT-embedded roles for backwards compatibility.
 *
 * @param principal - The authenticated principal
 * @param siteId - The site ID
 * @returns The system role name for this principal on this site
 */
async function getSiteRole(
  principal: AuthenticatedPrincipal,
  siteId: string,
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
  } else {
    // Query user_site_roles table
    const result = await query<{ role: PantheonRole }>(
      `SELECT role FROM user_site_roles
       WHERE user_id = $1 AND site_id = $2`,
      [principal.id, siteId],
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
): Promise<EffectiveRoleResult> {
  // Step 1: Get baseline role from database (with JWT fallback)
  const baselineRoleName = await getSiteRole(principal, siteId);

  // Step 2: Check for branch-level elevation
  const branchGrant = await query<{ role: RoleName }>(
    `SELECT role FROM branch_grants
     WHERE branch_id = $1 AND actor_id = $2`,
    [branchId, principal.id],
  );

  const grantRoleName = branchGrant.rows[0]?.role;

  // Step 3: Effective role is the higher of the two
  const effectiveRoleName = maxRole(baselineRoleName, grantRoleName);

  return {
    role: ROLES[effectiveRoleName],
    roleName: effectiveRoleName,
  };
}

/**
 * Checks if a principal has a specific permission on a branch.
 *
 * @param principal - The authenticated principal
 * @param siteId - The site ID
 * @param branchId - The branch ID
 * @param permission - The permission to check
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
): Promise<boolean> {
  const { role } = await getEffectiveRole(principal, siteId, branchId);
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
): Promise<void> {
  const { role, roleName } = await getEffectiveRole(principal, siteId, branchId);

  if (!role[permission]) {
    throw new AuthorizationError(
      `Missing permission: ${permission}. Your role (${roleName}) does not grant this permission.`,
      permission,
      roleName,
    );
  }
}
