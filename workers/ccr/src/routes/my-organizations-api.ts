/**
 * Business Accounts Phase 1: My Organizations API
 *
 * GET /api/organizations/mine — returns all organizations the
 * authenticated user belongs to (direct membership + site roles).
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { AuthenticatedPrincipal } from '../types';
import {
  getOrganizationsForUser,
  getUserPrimaryOrg,
  linkOrgToSpace,
  createOrgForUser,
  listAllOrganizationsForSwitcher,
  SWITCHER_ORG_LIMIT,
} from '../services';
import { isSuperAdmin } from '../utils/admin-check';
import { errorResponse } from '../utils/http-helpers';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { db } from '../db/scope';

interface MyOrganizationsContext {
  principal: Pick<AuthenticatedPrincipal, 'id' | 'type' | 'dbUserId' | 'systemRole'>;
}

/**
 * Ensures the user's P1 organization is linked to their PCC primary space:
 * links their existing org if they have one, otherwise creates one first.
 *
 * Rule 1: a user with a primary space in PCC (signaled by `spaceId` being
 * present) must have an organization in P1 — this never leaves them orgless.
 *
 * Best-effort: never throws. Failures (e.g. unique constraint violations)
 * are logged and swallowed so they don't block the organizations response.
 */
export async function linkOrCreateOrgForSpace(
  dbUserId: string,
  spaceId: string,
  spaceName: string | null,
): Promise<void> {
  try {
    const primaryOrgId = await getUserPrimaryOrg(dbUserId);
    if (primaryOrgId !== null) {
      await linkOrgToSpace(primaryOrgId, spaceId, spaceName ?? undefined);
      return;
    }

    const userRows = await db().select({ email: users.email }).from(users).where(eq(users.id, dbUserId));
    const email = userRows[0]?.email;
    if (email !== undefined) {
      await createOrgForUser(dbUserId, email, spaceName ?? undefined, spaceId);
    }
  } catch (error) {
    // Unique-constraint violation (23505) means a concurrent request already
    // linked/created the org — expected TOCTOU race, not a real failure.
    if (!(error instanceof Error && 'code' in error && (error as { code: string }).code === '23505')) {
      getLogger().error('Failed to auto-link/create org for space', error, {});
    }
  }
}

export async function handleMyOrganizationsRoute(
  request: Request,
  context: MyOrganizationsContext,
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  if (context.principal.dbUserId === undefined) {
    return errorResponse('User not found in allowlist', 401);
  }

  const dbUserId = context.principal.dbUserId;
  const url = new URL(request.url);
  const linkSpaceId = url.searchParams.get('linkSpaceId');
  const linkSpaceName = url.searchParams.get('linkSpaceName');

  if (linkSpaceId !== null) {
    await linkOrCreateOrgForSpace(dbUserId, linkSpaceId, linkSpaceName);
  }

  // PCC-3479: a superadmin gets every P1 organization in the switcher. The
  // frontend merges these with the PCC spaces the user can actually reach, so
  // the result is "all P1 business accounts + only the PCC ones they're on" —
  // no Content Publisher counterpart to this role is needed.
  const isSystemAdmin = await isSuperAdmin(context.principal);
  const organizations = isSystemAdmin
    ? await listAllOrganizationsForSwitcher()
    : await getOrganizationsForUser(dbUserId);

  // The switcher has no paging, so a full page is silently a partial answer.
  if (isSystemAdmin && organizations.length >= SWITCHER_ORG_LIMIT) {
    getLogger().warn('Superadmin organization switcher truncated', {
      limit: SWITCHER_ORG_LIMIT,
    });
  }

  // isSystemAdmin rides along so the dashboard doesn't need a second request
  // for an answer this route already computed. It can't be read off the
  // entries: a superadmin's all say role 'admin', same as a business account
  // admin's. Sent precomputed so which system roles count as administrative
  // stays defined only in admin-check.ts.
  return new Response(JSON.stringify({ organizations, isSystemAdmin }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
