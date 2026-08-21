/**
 * Role-Based Permissions
 *
 * Permission calculations for content editing roles.
 */

import type { ContentRole } from '../types.js';

/**
 * Component-level permissions.
 */
export interface ComponentPermissions {
  /** Can add new components */
  canAddComponents: boolean;
  /** Can remove components */
  canRemoveComponents: boolean;
  /** Can move/reorder components */
  canMoveComponents: boolean;
  /** Can edit component props */
  canEditProps: boolean;
  /** Can override default URL pattern */
  canOverrideUrl: boolean;
}

/**
 * Get permissions for a content role.
 *
 * - admin: Full access - can create/edit templates, full structural control
 * - editor: Pinned components locked (cannot move/delete), can add/remove non-pinned
 * - author: Same component permissions as editor
 * - junior-editor: View/edit props only, no structural changes
 */
export function getPermissionsForRole(role: ContentRole): ComponentPermissions {
  switch (role) {
    case 'admin':
      return {
        canAddComponents: true,
        canRemoveComponents: true,
        canMoveComponents: true,
        canEditProps: true,
        canOverrideUrl: true,
      };
    case 'editor':
    case 'author':
      return {
        canAddComponents: true,
        canRemoveComponents: true,
        canMoveComponents: true,
        canEditProps: true,
        canOverrideUrl: true,
      };
    case 'junior-editor':
      return {
        canAddComponents: false,
        canRemoveComponents: false,
        canMoveComponents: false,
        canEditProps: true,
        canOverrideUrl: false,
      };
  }
}

/**
 * Check if a role can perform structural actions (add/remove/move components).
 */
export function canPerformStructuralAction(role: ContentRole): boolean {
  const perms = getPermissionsForRole(role);
  return perms.canAddComponents || perms.canRemoveComponents || perms.canMoveComponents;
}

/**
 * Check if a role can edit component props.
 */
export function canEditProps(role: ContentRole): boolean {
  return getPermissionsForRole(role).canEditProps;
}

/**
 * Check if a role can override default URL pattern.
 */
export function canOverrideUrl(role: ContentRole): boolean {
  return getPermissionsForRole(role).canOverrideUrl;
}

/**
 * Merge template-based permissions with historical version lock.
 *
 * When viewing a historical version, all editing is disabled.
 * This combines with role-based permissions to enforce the most restrictive policy.
 */
export function mergePermissions(
  templatePerms: ComponentPermissions,
  isHistoricalVersion: boolean
): ComponentPermissions {
  if (isHistoricalVersion) {
    // Historical versions are read-only
    return {
      canAddComponents: false,
      canRemoveComponents: false,
      canMoveComponents: false,
      canEditProps: false,
      canOverrideUrl: false,
    };
  }

  return templatePerms;
}
