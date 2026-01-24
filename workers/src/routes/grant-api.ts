/**
 * Phase 7.1d: Grant API Routes
 *
 * REST API endpoints for branch grant operations.
 */

import type { RoleName } from '../types';
import {
  createGrant,
  getGrant,
  listGrants,
  deleteGrant,
  getBranch,
  GrantNotFoundError,
  DuplicateGrantError,
  BranchNotFoundError,
} from '../services';

/**
 * Request context for grant routes
 */
export interface GrantRouteContext {
  siteId: string;
  branchId: string;
  grantId?: string;
  principal: {
    id: string;
    type: 'user' | 'agent';
  };
}

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  return json as T;
}

/**
 * Request body for creating a grant
 */
interface CreateGrantBody {
  actorId?: string;
  actorType?: 'user' | 'agent';
  role?: RoleName;
  reason?: string;
}

/**
 * JSON response helper
 */
function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Error response helper
 */
function errorResponse(
  error: string,
  status: number,
  details?: unknown,
): Response {
  return jsonResponse({ error, details }, status);
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/grants - Create Grant
 */
async function handleCreateGrant(
  request: Request,
  context: GrantRouteContext,
): Promise<Response> {
  // Verify branch exists
  const branch = await getBranch(context.branchId);
  if (branch === null) {
    return errorResponse('Branch not found', 404);
  }

  const body = await parseJsonBody<CreateGrantBody>(request);

  // Validate required fields
  if (body.actorId === undefined || body.actorId.trim() === '') {
    return errorResponse('Actor ID is required', 400);
  }

  if (body.actorType === undefined) {
    return errorResponse('Actor type is required', 400);
  }

  if (body.role === undefined) {
    return errorResponse('Role is required', 400);
  }

  const grant = await createGrant({
    branchId: context.branchId,
    actorId: body.actorId,
    actorType: body.actorType,
    role: body.role,
    grantedById: context.principal.id,
    grantedByType: context.principal.type,
    reason: body.reason,
  });

  return jsonResponse(grant, 201);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/grants - List Grants
 */
async function handleListGrants(
  context: GrantRouteContext,
): Promise<Response> {
  const grants = await listGrants({
    branchId: context.branchId,
  });

  return jsonResponse({ grants });
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/grants/{grantId} - Get Grant
 */
async function handleGetGrant(
  context: GrantRouteContext,
): Promise<Response> {
  if (context.grantId === undefined) {
    return errorResponse('Grant ID is required', 400);
  }

  const grant = await getGrant(context.grantId);

  if (grant === null) {
    return errorResponse('Grant not found', 404);
  }

  return jsonResponse(grant);
}

/**
 * Handle DELETE /api/sites/{siteId}/branches/{branchId}/grants/{grantId} - Delete Grant
 */
async function handleDeleteGrant(
  context: GrantRouteContext,
): Promise<Response> {
  if (context.grantId === undefined) {
    return errorResponse('Grant ID is required', 400);
  }

  const deleted = await deleteGrant(context.grantId);

  if (!deleted) {
    return errorResponse('Grant not found', 404);
  }

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for grant operations
 */
export async function handleGrantRoutes(
  request: Request,
  context: GrantRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Single grant operations (with grantId)
    if (context.grantId !== undefined) {
      switch (method) {
        case 'GET':
          return await handleGetGrant(context);
        case 'DELETE':
          return await handleDeleteGrant(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Collection operations
    switch (method) {
      case 'GET':
        return await handleListGrants(context);
      case 'POST':
        return await handleCreateGrant(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof GrantNotFoundError) {
      return errorResponse('Grant not found', 404);
    }
    if (error instanceof DuplicateGrantError) {
      return errorResponse('Grant already exists for this actor on this branch', 409);
    }
    if (error instanceof BranchNotFoundError) {
      return errorResponse('Branch not found', 404);
    }

    // Re-throw unknown errors
    throw error;
  }
}
