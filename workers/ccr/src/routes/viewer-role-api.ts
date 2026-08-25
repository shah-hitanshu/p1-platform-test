/**
 * Viewer Role API Route
 *
 * Reports the calling principal's own effective role on a branch, together with
 * the permission flags that role carries. The editor uses it to decide which
 * affordances to render; every gated operation is still enforced server-side at
 * its own route, so this endpoint is advisory to the UI and authoritative to
 * nothing.
 *
 * Denied access is a 200 carrying NO_ACCESS rather than a 403 — the client needs
 * to distinguish "you may look but not touch" from "the request failed", and a
 * 403 collapses those into one error path.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { AuthenticatedPrincipal, RoleName, RolePermissions } from '../types';
import { AuthorizationError, getEffectiveRole } from '../auth/authorization';
import { getRolePermissions } from '../auth/roles';
import type { MASClient } from '../services/mas-client';
import { jsonResponse, errorResponse } from '../utils/http-helpers';

export interface ViewerRoleRouteContext {
  siteId: string;
  branchId?: string;
  principal: AuthenticatedPrincipal;
  masClient?: MASClient;
}

export interface ViewerRoleResponse {
  roleName: RoleName;
  permissions: RolePermissions;
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/auth/role
 */
export async function handleViewerRoleRoutes(
  request: Request,
  context: ViewerRoleRouteContext,
): Promise<Response> {
  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    const { siteId, branchId, principal } = context;
    if (siteId === '') {
      return errorResponse('Site ID is required', 400);
    }
    if (branchId === undefined || branchId === '') {
      return errorResponse('Branch ID is required', 400);
    }

    // Service principals authorize per-route against their token's scopes rather
    // than through the role ladder, so they have no role to report here. The
    // scope gate in index.ts already 403s them before dispatch; this mirrors
    // that status so the two entry paths can't disagree.
    if (principal.type === 'service') {
      return errorResponse('Role lookup is not available for service principals', 403);
    }

    const { roleName } = await getEffectiveRole(principal, siteId, branchId, context.masClient);

    const body: ViewerRoleResponse = {
      roleName,
      permissions: getRolePermissions(roleName),
    };
    return jsonResponse(body);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    getLogger().error('viewer role route failed', error, {
      site_id: context.siteId,
      branch_id: context.branchId,
      outcome: 'error',
    });
    return errorResponse('Internal server error', 500);
  }
}
