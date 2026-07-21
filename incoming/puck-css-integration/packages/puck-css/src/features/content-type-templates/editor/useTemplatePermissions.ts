/**
 * useTemplatePermissions Hook
 */

import { useMemo } from 'react';
import type { ContentRole } from '../types.js';
import {
  getPermissionsForRole,
  mergePermissions,
  type ComponentPermissions,
} from '../permissions/role-permissions.js';

export function useTemplatePermissions(
  role: ContentRole,
  isHistoricalVersion: boolean
): ComponentPermissions {
  return useMemo(() => {
    const rolePerms = getPermissionsForRole(role);
    return mergePermissions(rolePerms, isHistoricalVersion);
  }, [role, isHistoricalVersion]);
}
