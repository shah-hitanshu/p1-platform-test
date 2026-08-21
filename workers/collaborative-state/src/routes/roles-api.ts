/**
 * Custom Role Management API
 *
 * The endpoint set for CRUD operations against roles themselves — the role
 * definitions a site can offer — as opposed to granting users or agents
 * access, which lives in the collaborator and agent-role routes. Currently
 * list-only: GET returns the user and agent role catalogs a UI should offer,
 * with display labels. Advisory to the UI and authoritative to nothing;
 * grant validation is enforced at the grant endpoints.
 *
 * The siteId parameter is accepted so role sets can become site-specific
 * without a route change, but does not affect the response yet.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { AuthenticatedPrincipal } from '../types';
import { USER_ROLES, AGENT_ROLES } from '../auth/role-catalog';
import { jsonResponse, errorResponse } from '../utils/http-helpers';

export interface RolesRouteContext {
  siteId: string;
  principal: AuthenticatedPrincipal;
}

export function handleRolesRoutes(
  request: Request,
  context: RolesRouteContext,
): Response {
  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    if (context.siteId === '') {
      return errorResponse('Site ID is required', 400);
    }

    return jsonResponse({
      userRoles: USER_ROLES,
      agentRoles: AGENT_ROLES,
    });
  } catch (error) {
    getLogger().error('allowed roles route failed', error, {
      site_id: context.siteId,
      outcome: 'error',
    });
    return errorResponse('Internal server error', 500);
  }
}
