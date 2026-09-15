/**
 * User Site Role Service
 *
 * Manages per-site roles for users.
 * A user can hold one role per site per source (local, mas).
 */

import { sql } from 'drizzle-orm';
import { userSiteRoles } from '../db/schema';
import { db } from '../db/scope';
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

  await db()
    .insert(userSiteRoles)
    .values({
      userId: params.userId,
      siteId: params.siteId,
      role: params.role,
      source,
      createdById: params.grantedBy,
      updatedAt: sql`NOW()`,
    })
    .onConflictDoUpdate({
      target: [userSiteRoles.userId, userSiteRoles.siteId, userSiteRoles.source],
      set: { role: params.role, createdById: params.grantedBy, updatedAt: sql`NOW()` },
    });
}
