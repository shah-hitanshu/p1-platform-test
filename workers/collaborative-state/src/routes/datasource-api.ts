/**
 * Datasource API Routes
 *
 * REST API endpoints for datasource operations.
 * Datasources define WHERE data comes from (content type template).
 */

import {
  getDatasource,
  listDatasources,
  deleteDatasource,
} from '../services/datasource-service';
import { getBranch, getMainBranch } from '../services/branch-service';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { jsonResponse, errorResponse } from '../utils/http-helpers';
import type { AuthenticatedPrincipal } from '../types';

export interface DatasourceRouteContext {
  siteId: string;
  branchId?: string;
  datasourceName?: string;
  principal: AuthenticatedPrincipal;
}

export async function handleDatasourceRoutes(
  request: Request,
  context: DatasourceRouteContext,
): Promise<Response> {
  const { siteId, branchId, datasourceName, principal } = context;
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

    if (datasourceName !== undefined) {
      switch (method) {
        case 'GET': {
          await assertPermission(principal, siteId, branchId, 'canView');
          const ds = await getDatasource(siteId, branchId, datasourceName, mainBranchId);
          if (ds === null) {
            return errorResponse('Datasource not found', 404);
          }
          return jsonResponse(ds);
        }
        case 'DELETE': {
          await assertPermission(principal, siteId, branchId, 'canEdit');
          const deleted = await deleteDatasource({
            siteId,
            branchId,
            name: datasourceName,
            deletedById: principal.dbUserId ?? principal.id,
          });
          if (!deleted) {
            return errorResponse('Datasource not found', 404);
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
        const datasources = await listDatasources(siteId, branchId, mainBranchId);
        return jsonResponse({ datasources });
      }
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    console.error('Datasource API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
