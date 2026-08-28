/**
 * Branch Locale Coverage API Routes
 *
 * Read-only listing of which canonical documents on a branch hold which locale
 * variants, plus the distinct locales across them. One request covers the whole
 * branch, so a page listing can render a per-page coverage indicator and a locale
 * filter without a per-page lookup.
 */

import type { AuthenticatedPrincipal } from '../types';
import { getBranch, getBranchLocaleCoverage } from '../services';
import { HttpError } from '../services/errors';
import { assertPermission } from '../auth/authorization';
import { jsonResponse, errorResponse } from '../utils/http-helpers';
import { getLogger } from '@pantheon-systems/p1-telemetry';

/**
 * Request context for the branch locale coverage route.
 */
export interface LocaleCoverageRouteContext {
  siteId: string;
  branchId?: string;
  principal: AuthenticatedPrincipal;
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/locale-coverage
 */
export async function handleLocaleCoverageRoutes(
  request: Request,
  context: LocaleCoverageRouteContext,
): Promise<Response> {
  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    const branchId = context.branchId;
    if (branchId === undefined || branchId === '') {
      return errorResponse('Branch ID is required', 400);
    }

    // Resolved before the permission check: an authorization check against a branch
    // on another site reports no access, which would serve a 403 for what is a
    // branch this site does not have.
    const branch = await getBranch(branchId);
    if (branch?.siteId !== context.siteId) {
      return errorResponse('Branch not found', 404);
    }

    await assertPermission(context.principal, context.siteId, branchId, 'canView');

    return jsonResponse(await getBranchLocaleCoverage(branch));
  } catch (error) {
    // Service errors carry the status they should be served as, so only an
    // unrecognised failure is a 500.
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status);
    }
    getLogger().error('locale coverage route failed', error, {
      site_id: context.siteId,
      branch_id: context.branchId,
      outcome: 'error',
    });
    return errorResponse('Internal server error', 500);
  }
}
