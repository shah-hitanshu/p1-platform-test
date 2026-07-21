/**
 * useContentRole Hook
 *
 * React hook for managing content editing role and permissions.
 */

import { useMemo } from 'react';
import type { ContentRole } from '../types.js';
import { getPermissionsForRole, type ComponentPermissions } from './role-permissions.js';

/**
 * Return value from useContentRole hook.
 */
export interface UseContentRoleReturn {
  /** Current content editing role */
  role: ContentRole;
  /** Computed permissions for the role */
  permissions: ComponentPermissions;
}

/**
 * Hook for managing content editing role and permissions.
 *
 * @param role - Content editing role (defaults to 'admin')
 * @returns Current role and computed permissions
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const { role, permissions } = useContentRole('editor');
 *
 *   if (!permissions.canAddComponents) {
 *     return <div>Read-only mode</div>;
 *   }
 *
 *   return <PuckEditor />;
 * }
 * ```
 */
export function useContentRole(role: ContentRole = 'admin'): UseContentRoleReturn {
  const permissions = useMemo(() => getPermissionsForRole(role), [role]);

  return {
    role,
    permissions,
  };
}
