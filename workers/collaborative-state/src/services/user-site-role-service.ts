/**
 * User Site Role Service
 *
 * Manages per-site roles for users.
 * A user can hold one role per site per source (local, mas).
 */

import { query } from '../db';
import type { PantheonRole } from '../types';

// =============================================================================
// Types
// =============================================================================

export interface GrantUserRoleParams {
  userId: string;
  siteId: string;
  role: PantheonRole;
  source?: 'local' | 'mas';
  grantedBy: string;
}

// =============================================================================
// Constants
// =============================================================================

const VALID_ROLES: readonly PantheonRole[] = ['owner', 'admin', 'developer', 'team_member'];

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Grant (or update) a site role for a user.
 *
 * Uses ON CONFLICT upsert on (user_id, site_id, source).
 */
export async function grantRole(params: GrantUserRoleParams): Promise<void> {
  if (!params.userId || params.userId.trim() === '') {
    throw new Error('userId is required');
  }
  if (!params.siteId || params.siteId.trim() === '') {
    throw new Error('siteId is required');
  }
  if (!VALID_ROLES.includes(params.role)) {
    throw new Error(`role must be one of: ${VALID_ROLES.join(', ')}`);
  }
  if (!params.grantedBy || params.grantedBy.trim() === '') {
    throw new Error('grantedBy is required');
  }

  const source = params.source ?? 'local';

  await query(
    `INSERT INTO app.user_site_roles (user_id, site_id, role, source, created_by_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, site_id, source)
     DO UPDATE SET role = $3, created_by_id = $5, updated_at = NOW()`,
    [params.userId, params.siteId, params.role, source, params.grantedBy],
  );
}
