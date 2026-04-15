/**
 * Phase 7.1c: Merge API Routes
 *
 * REST API endpoints for merge operations.
 */

import type { ConflictResolutionStrategy, MergeRequestStatus, AuthenticatedPrincipal } from '../types';
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
  getMainBranch,
  MergeRequestNotFoundError,
  SourceBranchNotFoundError,
  TargetBranchNotFoundError,
  MergeConflictsError,
  MergeNotAllowedError,
  MergeExecutionError,
} from '../services';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { writeBranchInvalidation } from '../services/branch-invalidation-service';

/**
 * Request context for merge routes
 */
export interface MergeRouteContext {
  siteId: string;
  operation?: 'check' | 'execute' | 'preview';
  mergeRequests?: boolean;
  executeRequest?: boolean;
  mergeRequestId?: string;
  principal: AuthenticatedPrincipal;
  /** KV namespace for writing branch invalidation signals after merge */
  configKV?: KVNamespace;
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
 * Request body for merge preview
 */
interface MergePreviewBody {
  sourceBranchId?: string;
  targetBranchId?: string;
  /** When true, includes full document snapshots and diff operations */
  includeContent?: boolean;
  /** Exclude documents whose path starts with any of these prefixes */
  excludePathPrefixes?: string[];
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
    /** Required when strategy is 'manual'. The client-provided merged snapshot. */
    resolvedSnapshot?: Record<string, unknown>;
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
  context: MergeRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<MergeCheckBody>(request);

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  await assertPermission(context.principal, context.siteId, body.sourceBranchId, 'canView');

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

  await assertPermission(context.principal, context.siteId, body.sourceBranchId, 'canMerge');

  let result;

  // If conflict resolutions are provided, use executeMergeWithResolution
  if (body.conflictResolutions !== undefined && body.conflictResolutions.length > 0) {
    result = await executeMergeWithResolution({
      sourceBranchId: body.sourceBranchId,
      targetBranchId: body.targetBranchId,
      message: body.message ?? 'Merge with resolutions',
      resolutions: body.conflictResolutions,
      createdById: context.principal.id,
      createdByType: context.principal.type as 'user' | 'agent',
    });
  } else {
    // Otherwise execute simple merge
    result = await executeMerge({
      sourceBranchId: body.sourceBranchId,
      targetBranchId: body.targetBranchId,
      message: body.message ?? 'Merge',
      createdById: context.principal.id,
      createdByType: context.principal.type as 'user' | 'agent',
    });
  }

  // Write branch invalidation signal (fire-and-forget, errors swallowed)
  if (context.configKV !== undefined) {
    try {
      await writeBranchInvalidation(context.configKV, body.targetBranchId);
    } catch (error) {
      console.warn('Failed to write branch invalidation after merge:', error);
    }
  }

  return jsonResponse(result);
}

/**
 * Handle POST /api/sites/{siteId}/merge/preview - Preview Merge
 */
async function handlePreviewMerge(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<MergePreviewBody>(request);

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  await assertPermission(context.principal, context.siteId, body.sourceBranchId, 'canView');

  const result = await previewMerge(
    body.sourceBranchId,
    body.targetBranchId,
    {
      includeContent: body.includeContent,
      excludePathPrefixes: body.excludePathPrefixes,
    },
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

  await assertPermission(context.principal, context.siteId, body.sourceBranchId, 'canProposeMerge');

  const mergeRequest = await createMergeRequest({
    siteId: context.siteId,
    sourceBranchId: body.sourceBranchId,
    targetBranchId: body.targetBranchId,
    title: body.title,
    description: body.description,
    createdById: context.principal.id,
    createdByType: context.principal.type as 'user' | 'agent',
  });

  return jsonResponse(mergeRequest, 201);
}

/**
 * Valid merge request statuses for filtering
 */
const VALID_STATUSES: readonly MergeRequestStatus[] = [
  'open',
  'approved',
  'conflicted',
  'merged',
  'closed',
];

/**
 * Handle GET /api/sites/{siteId}/merge-requests - List Merge Requests
 */
async function handleListMergeRequests(
  request: Request,
  context: MergeRouteContext,
  mainBranchId: string,
): Promise<Response> {
  await assertPermission(context.principal, context.siteId, mainBranchId, 'canView');

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');

  // Validate status parameter if provided
  if (statusParam !== null && !VALID_STATUSES.includes(statusParam as MergeRequestStatus)) {
    return errorResponse('Invalid status parameter', 400);
  }

  const mergeRequests = await listMergeRequests(
    context.siteId,
    statusParam !== null ? { status: statusParam as MergeRequestStatus } : {},
  );

  return jsonResponse({ mergeRequests });
}

/**
 * Handle GET /api/sites/{siteId}/merge-requests/{requestId} - Get Merge Request
 */
async function handleGetMergeRequest(
  context: MergeRouteContext,
  mainBranchId: string,
): Promise<Response> {
  if (context.mergeRequestId === undefined) {
    return errorResponse('Merge request ID is required', 400);
  }

  await assertPermission(context.principal, context.siteId, mainBranchId, 'canView');

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
  mainBranchId: string,
): Promise<Response> {
  if (context.mergeRequestId === undefined) {
    return errorResponse('Merge request ID is required', 400);
  }

  await assertPermission(context.principal, context.siteId, mainBranchId, 'canMerge');

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
  mainBranchId: string,
): Promise<Response> {
  if (context.mergeRequestId === undefined) {
    return errorResponse('Merge request ID is required', 400);
  }

  await assertPermission(context.principal, context.siteId, mainBranchId, 'canManageGrants');

  await deleteMergeRequest(context.mergeRequestId);

  return new Response(null, { status: 204 });
}

/**
 * Request body for executing a merge request
 */
interface ExecuteMergeRequestBody {
  resolutions?: {
    documentId: string;
    strategy: ConflictResolutionStrategy;
    /** Required when strategy is 'manual'. The client-provided merged snapshot. */
    resolvedSnapshot?: Record<string, unknown>;
  }[];
}

/**
 * Handle POST /api/sites/{siteId}/merge-requests/{requestId}/execute - Execute Merge Request
 */
async function handleExecuteMergeRequest(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  if (context.mergeRequestId === undefined) {
    return errorResponse('Merge request ID is required', 400);
  }

  // Get the merge request to validate it exists and check status
  const mergeRequest = await getMergeRequest(context.mergeRequestId);
  if (mergeRequest === null) {
    return errorResponse('Merge request not found', 404);
  }

  await assertPermission(context.principal, context.siteId, mergeRequest.sourceBranchId, 'canMerge');

  // Check if merge request is in a valid state for execution
  if (mergeRequest.status !== 'approved' && mergeRequest.status !== 'conflicted') {
    return errorResponse(
      `Cannot execute merge request with status '${mergeRequest.status}'. Must be 'approved' or 'conflicted'.`,
      400,
    );
  }

  // Parse optional resolutions from body
  let resolutions: ExecuteMergeRequestBody['resolutions'];
  try {
    const body = await parseJsonBody<ExecuteMergeRequestBody>(request);
    resolutions = body.resolutions;
  } catch {
    // Empty body is fine
    resolutions = undefined;
  }

  // Execute the merge
  let result;
  if (resolutions !== undefined && resolutions.length > 0) {
    result = await executeMergeWithResolution({
      mergeRequestId: context.mergeRequestId,
      resolutionStrategy: 'take-source', // Default for any conflicts without a per-document resolution
      resolutions: resolutions.map((r) => ({
        documentId: r.documentId,
        strategy: r.strategy as 'take-source' | 'take-target' | 'manual',
        resolvedSnapshot: r.resolvedSnapshot,
      })),
      mergedById: context.principal.id,
      mergedByType: context.principal.type as 'user' | 'agent',
    });
  } else {
    result = await executeMerge({
      mergeRequestId: context.mergeRequestId,
      mergedById: context.principal.id,
      mergedByType: context.principal.type as 'user' | 'agent',
    });
  }

  // Note: executeMerge already updates the merge request status to 'merged'

  // Write branch invalidation signal (fire-and-forget, errors swallowed)
  if (context.configKV !== undefined) {
    try {
      await writeBranchInvalidation(context.configKV, mergeRequest.targetBranchId);
    } catch (error) {
      console.warn('Failed to write branch invalidation after merge request execute:', error);
    }
  }

  return jsonResponse(result);
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
          return await handleCheckMergeability(request, context);
        case 'execute':
          return await handleExecuteMerge(request, context);
        case 'preview':
          return await handlePreviewMerge(request, context);
        default:
          return errorResponse('Unknown operation', 400);
      }
    }

    // Handle execute merge request
    if (context.executeRequest === true) {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleExecuteMergeRequest(request, context);
    }

    // Handle merge requests CRUD
    if (context.mergeRequests === true) {
      const mainBranch = await getMainBranch(context.siteId);
      if (mainBranch === null) {
        return errorResponse('Site not found', 404);
      }

      // Single merge request operations
      if (context.mergeRequestId !== undefined) {
        switch (method) {
          case 'GET':
            return await handleGetMergeRequest(context, mainBranch.id);
          case 'PATCH':
            return await handleUpdateMergeRequest(request, context, mainBranch.id);
          case 'DELETE':
            return await handleDeleteMergeRequest(context, mainBranch.id);
          default:
            return errorResponse('Method not allowed', 405);
        }
      }

      // Collection operations
      switch (method) {
        case 'GET':
          return await handleListMergeRequests(request, context, mainBranch.id);
        case 'POST':
          return await handleCreateMergeRequest(request, context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    return errorResponse('Invalid route', 400);
  } catch (error) {
    // Handle known errors
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
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
    if (error instanceof MergeNotAllowedError) {
      return errorResponse(error.message, 400, {
        mergeRequestId: error.mergeRequestId,
        currentStatus: error.currentStatus,
      });
    }
    if (error instanceof MergeExecutionError) {
      return errorResponse(error.message, 500, {
        mergeRequestId: error.mergeRequestId,
      });
    }
    // Re-throw unknown errors
    throw error;
  }
}
