import type { AuthenticatedPrincipal } from '../types';
import { query } from '../db';
import { normalizePrincipalIdForDb } from '../auth/principal-id-normalization';

/**
 * Check if the current principal is a system admin.
 * If no users exist in the table, the current principal is treated as admin.
 */
export async function isSystemAdmin(principal: AuthenticatedPrincipal): Promise<boolean> {
  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM app.users',
  );
  const countRow = countResult.rows[0];
  if (countRow === undefined) {
    return false;
  }
  const userCount = parseInt(countRow.count, 10);

  // If no users exist, treat current principal as admin (bootstrap mode)
  if (userCount === 0) {
    return true;
  }

  // Check if the principal has admin role.
  // PCC-3457: principal_id is stored normalized (UUIDv5) — look it up by the
  // same key the writers stamp, or a broker-authenticated admin (raw
  // `provider|subject` principal.id) can never match its own row.
  const adminResult = await query<{ system_role: string }>(
    'SELECT system_role FROM app.users WHERE principal_id = $1 AND is_active = true',
    [await normalizePrincipalIdForDb(principal.id)],
  );

  const adminRow = adminResult.rows[0];
  if (adminRow === undefined) {
    return false;
  }

  return adminRow.system_role === 'admin';
}
