/**
 * Phase 7.1a: Branch API Routes
 *
 * REST API endpoints for branch operations.
 */

import type { BranchStatus, AuthenticatedPrincipal } from '../types';
import {
  createBranch,
  getBranch,
  getMainBranch,
  listBranches,
  updateBranch,
  updateBranchStatus,
  deleteBranch,
  createCheckpoint,
  BranchNotFoundError,
  SiteNotFoundError,
  DuplicateBranchNameError,
} from '../services';
import { assertPermission, AuthorizationError } from '../auth/authorization';

/**
 * Request context for branch routes
 */
export interface BranchRouteContext {
  siteId: string;
  branchId?: string;
  principal: AuthenticatedPrincipal;
}

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  return json as T;
}

/**
 * Request body for creating a branch
 */
interface CreateBranchBody {
  name?: string;
  description?: string;
  parentBranchId?: string;
  /** @deprecated Use parentBranchId instead */
  sourceBranch?: string;
}

/**
 * Request body for updating a branch
 */
interface UpdateBranchBody {
  name?: string;
  description?: string;
  status?: BranchStatus;
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
 * Handle POST /api/sites/{siteId}/branches - Create Branch
 */
async function handleCreateBranch(
  request: Request,
  context: BranchRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<CreateBranchBody>(request);

  // Validate required fields
  if (body.name === undefined || body.name.trim() === '') {
    return errorResponse('Branch name is required', 400);
  }

  // Get source branch - supports parentBranchId (UUID) or falls back to main
  let sourceBranch;

  if (body.parentBranchId !== undefined && body.parentBranchId !== '') {
    // Look up parent branch by ID
    sourceBranch = await getBranch(body.parentBranchId);
    if (sourceBranch === null) {
      return errorResponse('Parent branch not found', 404);
    }
  } else {
    // Default to main branch
    sourceBranch = await getMainBranch(context.siteId);
    if (sourceBranch === null) {
      return errorResponse('Main branch not found', 404);
    }
  }

  // Authorize branch creation against the main branch
  const mainBranchForAuth = sourceBranch.isMain
    ? sourceBranch
    : await getMainBranch(context.siteId);
  if (mainBranchForAuth != null) {
    await assertPermission(context.principal, context.siteId, mainBranchForAuth.id, 'canCreateBranch');
  }

  // Always create a fresh checkpoint to capture the source branch's current state
  const { checkpoint } = await createCheckpoint({
    branchId: sourceBranch.id,
    name: 'Auto-created for branching',
    checkpointType: 'auto',
    createdById: context.principal.id,
    createdByType: context.principal.type as 'user' | 'agent',
  });

  const branch = await createBranch({
    siteId: context.siteId,
    name: body.name,
    description: body.description,
    sourceBranchId: sourceBranch.id,
    sourceCheckpointId: checkpoint.id,
    createdById: context.principal.id,
    createdByType: context.principal.type as 'user' | 'agent',
  });

  return jsonResponse(branch, 201);
}

/**
 * Handle GET /api/sites/{siteId}/branches - List Branches
 */
async function handleListBranches(
  request: Request,
  context: BranchRouteContext,
): Promise<Response> {
  // Authorize against main branch for collection-level access
  const mainBranch = await getMainBranch(context.siteId);
  if (mainBranch != null) {
    await assertPermission(context.principal, context.siteId, mainBranch.id, 'canView');
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const status = statusParam as BranchStatus | null;

  const branches = await listBranches(
    context.siteId,
    status !== null ? { status } : {},
  );

  return jsonResponse({ branches });
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId} - Get Branch
 */
async function handleGetBranch(context: BranchRouteContext): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }

  const branch = await getBranch(context.branchId);

  if (branch === null) {
    return errorResponse('Branch not found', 404);
  }

  return jsonResponse(branch);
}

/**
 * Handle PATCH /api/sites/{siteId}/branches/{branchId} - Update Branch
 */
async function handleUpdateBranch(
  request: Request,
  context: BranchRouteContext,
): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }

  const body = await parseJsonBody<UpdateBranchBody>(request);

  // If status is being updated, use updateBranchStatus
  if (body.status !== undefined) {
    const updatedBranch = await updateBranchStatus(context.branchId, body.status);
    return jsonResponse(updatedBranch);
  }

  // Otherwise update branch details
  const updatedBranch = await updateBranch(context.branchId, {
    name: body.name,
    description: body.description,
  });

  return jsonResponse(updatedBranch);
}

/**
 * Handle DELETE /api/sites/{siteId}/branches/{branchId} - Delete Branch
 */
async function handleDeleteBranch(
  context: BranchRouteContext,
): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }

  await deleteBranch(context.branchId);

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for branch operations
 */
export async function handleBranchRoutes(
  request: Request,
  context: BranchRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Routes with branchId (single branch operations)
    if (context.branchId !== undefined) {
      switch (method) {
        case 'GET':
          await assertPermission(context.principal, context.siteId, context.branchId, 'canView');
          return await handleGetBranch(context);
        case 'PATCH':
          await assertPermission(context.principal, context.siteId, context.branchId, 'canCreateBranch');
          return await handleUpdateBranch(request, context);
        case 'DELETE':
          await assertPermission(context.principal, context.siteId, context.branchId, 'canManageGrants');
          return await handleDeleteBranch(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes without branchId (collection operations)
    switch (method) {
      case 'GET':
        return await handleListBranches(request, context);
      case 'POST':
        return await handleCreateBranch(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    if (error instanceof BranchNotFoundError) {
      return errorResponse('Branch not found', 404);
    }
    if (error instanceof SiteNotFoundError) {
      return errorResponse('Site not found', 404);
    }
    if (error instanceof DuplicateBranchNameError) {
      return errorResponse('Branch with this name already exists', 409);
    }

    // Re-throw unknown errors
    throw error;
  }
}
