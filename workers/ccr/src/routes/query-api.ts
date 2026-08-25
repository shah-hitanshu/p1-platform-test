/**
 * Query API Routes
 *
 * REST API endpoints for query operations.
 * Queries define WHAT to retrieve from a datasource.
 */

import {
  getQuery,
  listQueries,
  deleteQuery,
  executeQuery,
} from '../services/query-service';
import { HttpError } from '../services';
import { getBranch, getMainBranch } from '../services/branch-service';
import { assertPermission } from '../auth/authorization';
import { jsonResponse, errorResponse } from '../utils/http-helpers';
import { validatePagination } from './validation';
import type { AuthenticatedPrincipal } from '../types';

export interface QueryRouteContext {
  siteId: string;
  branchId?: string;
  queryName?: string;
  action?: string;
  principal: AuthenticatedPrincipal;
}

export async function handleQueryRoutes(
  request: Request,
  context: QueryRouteContext,
): Promise<Response> {
  const { siteId, branchId, queryName, action, principal } = context;
  const method = request.method;

  try {
    if (branchId === undefined) {
      return errorResponse('Branch ID is required', 400);
    }

    const branch = await getBranch(branchId);
    if (branch === null) {
      return errorResponse('Branch not found', 404);
    }
    const mainBranch = !branch.isMain ? await getMainBranch(siteId) : null;
    const mainBranchId = mainBranch?.id;

    if (queryName !== undefined && action === 'results') {
      if (method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
      await assertPermission(principal, siteId, branchId, 'canView');

      const url = new URL(request.url);
      const pagination = validatePagination(
        url.searchParams.get('limit'),
        url.searchParams.get('offset'),
      );
      if (!pagination.valid) {
        return errorResponse(pagination.error ?? 'Invalid pagination parameters', 400);
      }

      const result = await executeQuery({
        siteId,
        branchId,
        queryName,
        limit: pagination.limit,
        offset: pagination.offset,
        mainBranchId,
      });
      return jsonResponse(result);
    }

    if (queryName !== undefined) {
      switch (method) {
        case 'GET': {
          await assertPermission(principal, siteId, branchId, 'canView');
          const q = await getQuery(siteId, branchId, queryName, mainBranchId);
          if (q === null) {
            return errorResponse('Query not found', 404);
          }
          return jsonResponse(q);
        }
        case 'DELETE': {
          await assertPermission(principal, siteId, branchId, 'canEdit');
          const deleted = await deleteQuery({
            siteId,
            branchId,
            name: queryName,
            deletedById: principal.dbUserId ?? principal.id,
          });
          if (!deleted) {
            return errorResponse('Query not found', 404);
          }
          return jsonResponse({ deleted: true });
        }
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    switch (method) {
      case 'GET': {
        await assertPermission(principal, siteId, branchId, 'canView');
        const queries = await listQueries(siteId, branchId, mainBranchId);
        return jsonResponse({ queries });
      }
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status);
    }
    console.error('Query API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
