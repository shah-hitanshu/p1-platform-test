/**
 * Branch Drift API Routes
 *
 * Read-only, admin-gated listing of upstream drift across a branch. Returns one
 * row per source document that has drifted from its upstream edge target — a
 * translation's canonical for `localization`, a document's template for
 * `template` — each with the classified counts a collapsed dashboard row needs.
 * The full change list stays behind the per-document upstream-diff request.
 */

import type { AuthenticatedPrincipal } from '../types';
import { listBranchDrift } from '../services';
import { getEffectiveRole, AuthorizationError } from '../auth/authorization';
import { jsonResponse, errorResponse } from '../utils/http-helpers';
import { validateQuery, validationErrorResponse } from './validation/request-validation';
import { handleDriftRoutesValidation } from './validation/drift-api.validation';

/**
 * Request context for the branch drift route.
 */
export interface DriftRouteContext {
  siteId: string;
  branchId?: string;
  principal: AuthenticatedPrincipal;
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/drift
 */
export async function handleDriftRoutes(
  request: Request,
  context: DriftRouteContext,
): Promise<Response> {
  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    const branchId = context.branchId;
    if (branchId === undefined || branchId === '') {
      return errorResponse('Branch ID is required', 400);
    }

    // Drift listing is admin-only, matching the Migrations tab's visibility.
    if (context.principal.type === 'service') {
      return errorResponse('Drift listing requires ADMIN role', 403);
    }
    const { role, roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
    if (!role.canManageTemplates) {
      throw new AuthorizationError('Drift listing requires ADMIN role', 'canManageTemplates', roleName);
    }

    const { relationType, limit, offset } = validateQuery(
      handleDriftRoutesValidation.query,
      new URL(request.url).searchParams,
    );

    const page = await listBranchDrift(branchId, relationType, { limit, offset });
    return jsonResponse(page);
  } catch (error) {
    const invalidRequest = validationErrorResponse(error);
    if (invalidRequest !== null) {
      return invalidRequest;
    }
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    console.error('Drift API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
