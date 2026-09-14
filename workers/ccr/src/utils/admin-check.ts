import type { AuthenticatedPrincipal } from '../types';
import { and, eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { db } from '../db/scope';
import { normalizePrincipalIdForDb } from '../auth/principal-id-normalization';

/**
 * The only platform-wide administrative role (PCC-3479).
 *
 * `system_role` also has a legacy `admin` value that used to mean nearly the
 * same thing. Nothing reads it any more — a row still carrying it is exactly a
 * member. Two names for one idea is how a check ends up written against the
 * wrong one, so there is one: administering a *business account* is
 * `organization_members.role`, and this column says only whether someone is
 * Pantheon staff.
 */
const SUPERADMIN_ROLE = 'superadmin';

/**
 * Whether a persisted `system_role` value is an administrative one.
 *
 * Exported so the definition of "admin" lives in exactly one place, shared by
 * the checks and by the /api/users/me payload that reports it.
 */
export function isAdminSystemRole(role: string | null | undefined): boolean {
  return role === SUPERADMIN_ROLE;
}

/**
 * Resolves the principal's persisted system role.
 *
 * Prefers the value the request gate already attached to the principal so the
 * common case costs no extra query; falls back to a lookup for principals that
 * bypassed enrichment (agents, broker-authenticated callers).
 *
 * Returns null when the principal has no active row in app.users.
 */
export async function getSystemRole(
  principal: Pick<AuthenticatedPrincipal, 'id' | 'systemRole'>,
): Promise<string | null> {
  if (principal.systemRole !== undefined && principal.systemRole !== '') {
    return principal.systemRole;
  }

  // PCC-3457: principal_id is stored normalized (UUIDv5) — look it up by the
  // same key the writers stamp, or a broker-authenticated admin (raw
  // `provider|subject` principal.id) can never match its own row.
  const rows = await db()
    .select({ systemRole: users.systemRole })
    .from(users)
    .where(
      and(
        eq(users.principalId, await normalizePrincipalIdForDb(principal.id)),
        eq(users.isActive, true),
      ),
    );

  return rows[0]?.systemRole ?? null;
}

/**
 * Check if the current principal is a superadmin (PCC-3479).
 *
 * Unlike isSystemAdmin there is no bootstrap escape hatch: superadmin is
 * granted explicitly, never inferred from an empty users table.
 */
export async function isSuperAdmin(
  principal: Pick<AuthenticatedPrincipal, 'id' | 'systemRole'>,
): Promise<boolean> {
  return (await getSystemRole(principal)) === SUPERADMIN_ROLE;
}

/**
 * Check if the current principal is a system admin.
 * If no users exist in the table, the current principal is treated as admin.
 *
 * Same role as isSuperAdmin, plus the bootstrap escape hatch: this is what the
 * platform staff tools (/api/admin/users, the backfills) gate on, and an empty
 * database has nobody who could have been granted the role yet.
 */
export async function isSystemAdmin(
  principal: Pick<AuthenticatedPrincipal, 'id' | 'systemRole'>,
): Promise<boolean> {
  const anyUserRows = await db().select({ id: users.id }).from(users).limit(1);

  // If no users exist, treat current principal as admin (bootstrap mode)
  if (anyUserRows.length === 0) {
    return true;
  }

  return isAdminSystemRole(await getSystemRole(principal));
}
