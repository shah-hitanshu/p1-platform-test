/**
 * Phase 2.2: Authorization System - Role Definitions
 *
 * Defines the role system for the collaborative state system.
 * Roles determine what actions an actor can perform.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Role System"
 */

import type { RoleName, RolePermissions, PantheonRole, AgentSiteRole } from '../types';

/**
 * Role definitions with their associated permissions.
 * Each role has 9 permission flags that control access to various operations.
 */
export const ROLES: Record<RoleName, RolePermissions> = {
  NO_ACCESS: {
    canView: false,
    canEdit: false,
    canCreateBranch: false,
    canEditDocuments: false,
    canCreateCheckpoint: false,
    canProposeMerge: false,
    canMerge: false,
    canMergeToMain: false,
    canManageGrants: false,
  },

  VIEWER: {
    canView: true,
    canEdit: false,
    canCreateBranch: false,
    canEditDocuments: false,
    canCreateCheckpoint: false,
    canProposeMerge: false,
    canMerge: false,
    canMergeToMain: false,
    canManageGrants: false,
  },

  EDITOR: {
    canView: true,
    canEdit: true,
    canCreateBranch: true,
    canEditDocuments: true,
    canCreateCheckpoint: true,
    canProposeMerge: true,
    canMerge: true,
    canMergeToMain: false,
    canManageGrants: false,
  },

  ADMIN: {
    canView: true,
    canEdit: true,
    canCreateBranch: true,
    canEditDocuments: true,
    canCreateCheckpoint: true,
    canProposeMerge: true,
    canMerge: true,
    canMergeToMain: true,
    canManageGrants: true,
  },
} as const;

/**
 * Ordered list of role names from lowest to highest privilege.
 * Used for role comparison operations.
 */
const ROLE_ORDER: RoleName[] = ['NO_ACCESS', 'VIEWER', 'EDITOR', 'ADMIN'];

/**
 * Maps a Pantheon site role to the corresponding system role name.
 *
 * Pantheon roles map as follows:
 * - owner, admin -> ADMIN
 * - developer, team_member -> EDITOR
 * - undefined/unknown -> NO_ACCESS
 *
 * @param pantheonRole - The Pantheon site role (owner, admin, developer, team_member)
 * @returns The corresponding system role name
 */
export function mapPantheonRole(pantheonRole: PantheonRole | undefined): RoleName {
  switch (pantheonRole) {
    case 'owner':
    case 'admin':
      return 'ADMIN';
    case 'developer':
    case 'team_member':
      return 'EDITOR';
    default:
      return 'NO_ACCESS';
  }
}

/**
 * Maps an agent site role to the corresponding system role name.
 *
 * Agent roles map as follows:
 * - admin -> ADMIN
 * - editor -> EDITOR
 * - viewer -> VIEWER
 * - undefined/unknown -> NO_ACCESS
 *
 * @param agentRole - The agent site role (admin, editor, viewer)
 * @returns The corresponding system role name
 */
export function mapAgentRole(agentRole: AgentSiteRole | undefined): RoleName {
  switch (agentRole) {
    case 'admin':
      return 'ADMIN';
    case 'editor':
      return 'EDITOR';
    case 'viewer':
      return 'VIEWER';
    default:
      return 'NO_ACCESS';
  }
}

/**
 * Returns the higher of two roles based on privilege level.
 * Branch grants can elevate access but never restrict it.
 *
 * @param a - First role name
 * @param b - Second role name (optional)
 * @returns The role with higher privileges
 */
export function maxRole(a: RoleName, b: RoleName | undefined): RoleName {
  if (!b) return a;
  const indexA = ROLE_ORDER.indexOf(a);
  const indexB = ROLE_ORDER.indexOf(b);
  return indexA > indexB ? a : b;
}

/**
 * Checks if a role meets or exceeds a minimum required role level.
 *
 * @param role - The role to check
 * @param minRole - The minimum required role (EDITOR or ADMIN)
 * @returns True if the role meets or exceeds the minimum
 */
export function roleAtLeast(role: RoleName, minRole: 'EDITOR' | 'ADMIN'): boolean {
  const roleIndex = ROLE_ORDER.indexOf(role);
  const minIndex = ROLE_ORDER.indexOf(minRole);
  return roleIndex >= minIndex;
}

/**
 * Gets the permissions object for a given role name.
 *
 * @param roleName - The name of the role
 * @returns The permissions object for that role
 */
export function getRolePermissions(roleName: RoleName): RolePermissions {
  return ROLES[roleName];
}
