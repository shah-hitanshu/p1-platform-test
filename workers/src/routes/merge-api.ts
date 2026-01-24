/**
 * Phase 7.1c: Merge API Routes
 *
 * REST API endpoints for merge operations.
 */

import type { ConflictResolutionStrategy, MergeRequestStatus } from '../types';
import {
  checkMergeability,
  executeMerge,
  executeMergeWithResolution,
  previewMerge,
  createMergeRequest,
  getMergeRequest,
  listMergeRequests,
  updateMergeRequest,
  updateMergeRequestStatus,
  deleteMergeRequest,
  MergeRequestNotFoundError,
  SourceBranchNotFoundError,
  TargetBranchNotFoundError,
  MergeConflictsError,
} from '../services';

/**
 * Request context for merge routes
 */
export interface MergeRouteContext {
  siteId: string;
  operation?: 'check' | 'execute' | 'preview';
  mergeRequests?: boolean;
  mergeRequestId?: string;
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
 * Request body for merge check
 */
interface MergeCheckBody {
  sourceBranchId?: string;
  targetBranchId?: string;
}

/**
 * Request body for merge execute
 */
interface MergeExecuteBody {
  sourceBranchId?: string;
  targetBranchId?: string;
  message?: string;
  conflictResolutions?: {
    documentId: string;
    strategy: ConflictResolutionStrategy;
  }[];
}

/**
 * Request body for creating a merge request
 */
interface CreateMergeRequestBody {
  sourceBranchId?: string;
  targetBranchId?: string;
  title?: string;
  description?: string;
}

/**
 * Request body for updating a merge request
 */
interface UpdateMergeRequestBody {
  title?: string;
  description?: string;
  status?: MergeRequestStatus;
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
 * Handle POST /api/sites/{siteId}/merge/check - Check Mergeability
 */
async function handleCheckMergeability(
  request: Request,
): Promise<Response> {
  const body = await parseJsonBody<MergeCheckBody>(request);

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  const result = await checkMergeability(
    body.sourceBranchId,
    body.targetBranchId,
  );

  return jsonResponse(result);
}

/**
 * Handle POST /api/sites/{siteId}/merge/execute - Execute Merge
 */
async function handleExecuteMerge(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<MergeExecuteBody>(request);

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  // If conflict resolutions are provided, use executeMergeWithResolution
  if (body.conflictResolutions !== undefined && body.conflictResolutions.length > 0) {
    const result = await executeMergeWithResolution({
      sourceBranchId: body.sourceBranchId,
      targetBranchId: body.targetBranchId,
      message: body.message ?? 'Merge with resolutions',
      resolutions: body.conflictResolutions,
      createdById: context.principal.id,
      createdByType: context.principal.type,
    });

    return jsonResponse(result);
  }

  // Otherwise execute simple merge
  const result = await executeMerge({
    sourceBranchId: body.sourceBranchId,
    targetBranchId: body.targetBranchId,
    message: body.message ?? 'Merge',
    createdById: context.principal.id,
    createdByType: context.principal.type,
  });

  return jsonResponse(result);
}

/**
 * Handle POST /api/sites/{siteId}/merge/preview - Preview Merge
 */
async function handlePreviewMerge(
  request: Request,
): Promise<Response> {
  const body = await parseJsonBody<MergeCheckBody>(request);

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  const result = await previewMerge(
    body.sourceBranchId,
    body.targetBranchId,
  );

  return jsonResponse(result);
}

/**
 * Handle POST /api/sites/{siteId}/merge-requests - Create Merge Request
 */
async function handleCreateMergeRequest(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<CreateMergeRequestBody>(request);

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  if (body.title === undefined || body.title.trim() === '') {
    return errorResponse('Title is required', 400);
  }

  const mergeRequest = await createMergeRequest({
    siteId: context.siteId,
    sourceBranchId: body.sourceBranchId,
    targetBranchId: body.targetBranchId,
    title: body.title,
    description: body.description,
    createdById: context.principal.id,
    createdByType: context.principal.type,
  });

  return jsonResponse(mergeRequest, 201);
}

/**
 * Handle GET /api/sites/{siteId}/merge-requests - List Merge Requests
 */
async function handleListMergeRequests(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status') as MergeRequestStatus | null;

  const mergeRequests = await listMergeRequests({
    siteId: context.siteId,
    ...(statusParam !== null ? { status: statusParam } : {}),
  });

  return jsonResponse({ mergeRequests });
}

/**
 * Handle GET /api/sites/{siteId}/merge-requests/{requestId} - Get Merge Request
 */
async function handleGetMergeRequest(
  context: MergeRouteContext,
): Promise<Response> {
  if (context.mergeRequestId === undefined) {
    return errorResponse('Merge request ID is required', 400);
  }

  const mergeRequest = await getMergeRequest(context.mergeRequestId);

  if (mergeRequest === null) {
    return errorResponse('Merge request not found', 404);
  }

  return jsonResponse(mergeRequest);
}

/**
 * Handle PATCH /api/sites/{siteId}/merge-requests/{requestId} - Update Merge Request
 */
async function handleUpdateMergeRequest(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  if (context.mergeRequestId === undefined) {
    return errorResponse('Merge request ID is required', 400);
  }

  const body = await parseJsonBody<UpdateMergeRequestBody>(request);

  // If status is being updated, use updateMergeRequestStatus
  if (body.status !== undefined) {
    const mergeRequest = await updateMergeRequestStatus(
      context.mergeRequestId,
      body.status,
    );
    return jsonResponse(mergeRequest);
  }

  // Otherwise update merge request details
  const mergeRequest = await updateMergeRequest(context.mergeRequestId, {
    title: body.title,
    description: body.description,
  });

  return jsonResponse(mergeRequest);
}

/**
 * Handle DELETE /api/sites/{siteId}/merge-requests/{requestId} - Delete Merge Request
 */
async function handleDeleteMergeRequest(
  context: MergeRouteContext,
): Promise<Response> {
  if (context.mergeRequestId === undefined) {
    return errorResponse('Merge request ID is required', 400);
  }

  await deleteMergeRequest(context.mergeRequestId);

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for merge operations
 */
export async function handleMergeRoutes(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Handle merge operations (check, execute, preview)
    if (context.operation !== undefined) {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }

      switch (context.operation) {
        case 'check':
          return await handleCheckMergeability(request);
        case 'execute':
          return await handleExecuteMerge(request, context);
        case 'preview':
          return await handlePreviewMerge(request);
        default:
          return errorResponse('Unknown operation', 400);
      }
    }

    // Handle merge requests CRUD
    if (context.mergeRequests === true) {
      // Single merge request operations
      if (context.mergeRequestId !== undefined) {
        switch (method) {
          case 'GET':
            return await handleGetMergeRequest(context);
          case 'PATCH':
            return await handleUpdateMergeRequest(request, context);
          case 'DELETE':
            return await handleDeleteMergeRequest(context);
          default:
            return errorResponse('Method not allowed', 405);
        }
      }

      // Collection operations
      switch (method) {
        case 'GET':
          return await handleListMergeRequests(request, context);
        case 'POST':
          return await handleCreateMergeRequest(request, context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    return errorResponse('Invalid route', 400);
  } catch (error) {
    // Handle known errors
    if (error instanceof MergeRequestNotFoundError) {
      return errorResponse('Merge request not found', 404);
    }
    if (error instanceof SourceBranchNotFoundError) {
      return errorResponse('Source branch not found', 404);
    }
    if (error instanceof TargetBranchNotFoundError) {
      return errorResponse('Target branch not found', 404);
    }
    if (error instanceof MergeConflictsError) {
      return errorResponse('Merge has unresolved conflicts', 409, {
        mergeRequestId: error.mergeRequestId,
        conflictCount: error.conflictCount,
      });
    }

    // Re-throw unknown errors
    throw error;
  }
}
