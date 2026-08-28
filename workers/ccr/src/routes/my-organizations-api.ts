/**
 * Business Accounts Phase 1: My Organizations API
 *
 * GET /api/organizations/mine — returns all organizations the
 * authenticated user belongs to (direct membership + site roles).
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { AuthenticatedPrincipal } from '../types';
import { getOrganizationsForUser, getUserPrimaryOrg, linkOrgToSpace, createOrgForUser } from '../services';
import { query } from '../db';

interface MyOrganizationsContext {
  principal: Pick<AuthenticatedPrincipal, 'id' | 'type' | 'dbUserId'>;
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

    const userRow = await query<{ email: string }>(
      'SELECT email FROM app.users WHERE id = $1',
      [dbUserId],
    );
    const email = userRow.rows[0]?.email;
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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (context.principal.dbUserId === undefined) {
    return new Response(JSON.stringify({ error: 'User not found in allowlist' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dbUserId = context.principal.dbUserId;
  const url = new URL(request.url);
  const linkSpaceId = url.searchParams.get('linkSpaceId');
  const linkSpaceName = url.searchParams.get('linkSpaceName');

  if (linkSpaceId !== null) {
    await linkOrCreateOrgForSpace(dbUserId, linkSpaceId, linkSpaceName);
  }

  const organizations = await getOrganizationsForUser(dbUserId);

  return new Response(JSON.stringify({ organizations }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
