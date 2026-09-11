/**
 * GET /api/sites/{siteId}/members — the people and agents on one site.
 *
 * Built for pickers, so it needs only canView. The grant-management endpoints
 * next door stay behind canManageGrants: reading who your collaborators are is
 * not the same act as changing who they are.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import { assertPermission, AuthorizationError } from '../../auth/authorization';
import { getMainBranch } from '../../services/branch-service';
import { getSiteMembers, type SiteMembers } from '../../services/site-members-service';
import { errorResponse, jsonResponse } from '../../utils/http-helpers';
import type { SiteMembersResponse, SiteMembersRouteContext } from './types';

export type {
  MembersRosterSource,
  SiteMemberAgent,
  SiteMemberSource,
  SiteMemberUser,
  SiteMembersResponse,
  SiteMembersRouteContext,
} from './types';

// Not cacheable in front of the worker: a shared cache there keys on the bare
// URL and never sees the per-member gate, so these names and email addresses
// would go to anyone who guessed the path. The memo lives behind the gate.
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

/** A stale roster was rescued by the memo after a failed upstream call, so it is not 'ok'. */
const DEGRADED_SOURCES = new Set(['unavailable', 'stale']);

export async function handleSiteMembersRoutes(
  request: Request,
  context: SiteMembersRouteContext,
): Promise<Response> {
  const startedAt = Date.now();

  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    if (context.siteId === '') {
      return errorResponse('Site ID is required', 400);
    }

    // Permissions are branch-scoped; a site's main branch is the one every
    // member of the site can see, so it stands in for "can view this site".
    const mainBranch = await getMainBranch(context.siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }

    await assertPermission(
      context.principal,
      context.siteId,
      mainBranch.id,
      'canView',
      context.masClient,
    );

    const roster = await getSiteMembers(context.siteId, context.masClient);
    const body: SiteMembersResponse = { members: roster.members, agents: roster.agents };

    logServed(context.siteId, roster, startedAt);

    return jsonResponse(body, 200, NO_STORE_HEADERS);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      getLogger().info('site members denied', {
        site_id: context.siteId,
        principal_type: context.principal.type,
        duration_ms: Date.now() - startedAt,
        outcome: 'denied',
      });
      return errorResponse(error.message, 403);
    }

    getLogger().error('site members route failed', error, {
      site_id: context.siteId,
      duration_ms: Date.now() - startedAt,
      outcome: 'error',
    });
    return errorResponse('Internal server error', 500);
  }
}

/**
 * member_count, agent_count and roster_source are allow-listed in telemetry.ts;
 * without that they are redacted in the deployed lanes. duration_ms measures
 * waiting rather than work — the runtime clock only advances on I/O.
 */
function logServed(siteId: string, roster: SiteMembers, startedAt: number): void {
  getLogger().info('site members served', {
    site_id: siteId,
    member_count: roster.members.length,
    agent_count: roster.agents.length,
    roster_source: roster.rosterSource,
    duration_ms: Date.now() - startedAt,
    outcome: DEGRADED_SOURCES.has(roster.rosterSource) ? 'degraded' : 'ok',
  });
}
