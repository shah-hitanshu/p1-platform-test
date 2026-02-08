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
  getLatestDocumentVersion,
  mergeCrdtStates,
  MergeRequestNotFoundError,
  SourceBranchNotFoundError,
  TargetBranchNotFoundError,
  MergeConflictsError,
  MergeNotAllowedError,
  MergeExecutionError,
  InvalidCrdtStateError,
  MissingCrdtStateError,
} from '../services';

/**
 * Request context for merge routes
 */
export interface MergeRouteContext {
  siteId: string;
  operation?: 'check' | 'execute' | 'preview' | 'crdt-preview';
  mergeRequests?: boolean;
  executeRequest?: boolean;
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
 * Request body for merge preview
 */
interface MergePreviewBody {
  sourceBranchId?: string;
  targetBranchId?: string;
  /** When true, includes full document snapshots and diff operations */
  includeContent?: boolean;
}

/**
 * Request body for CRDT merge preview
 */
interface CrdtPreviewBody {
  documentId?: string;
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
  const body = await parseJsonBody<MergePreviewBody>(request);

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  const result = await previewMerge(
    body.sourceBranchId,
    body.targetBranchId,
    { includeContent: body.includeContent },
  );

  return jsonResponse(result);
}

/**
 * Handle POST /api/sites/{siteId}/merge/crdt-preview - Preview CRDT Merge
 *
 * Returns a merged snapshot without committing any changes.
 */
async function handleCrdtPreview(
  request: Request,
): Promise<Response> {
  const body = await parseJsonBody<CrdtPreviewBody>(request);

  if (body.documentId === undefined || body.documentId === '') {
    return errorResponse('documentId is required', 400);
  }

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  // Get latest document versions on each branch
  const sourceVersion = await getLatestDocumentVersion(body.documentId, body.sourceBranchId);
  if (sourceVersion === null) {
    return errorResponse('Source document version not found', 404);
  }

  const targetVersion = await getLatestDocumentVersion(body.documentId, body.targetBranchId);
  if (targetVersion === null) {
    return errorResponse('Target document version not found', 404);
  }

  // Validate both have CRDT state
  if (sourceVersion.crdtState === undefined || sourceVersion.crdtState === '') {
    return errorResponse('Source version is missing CRDT state required for merge', 422);
  }

  if (targetVersion.crdtState === undefined || targetVersion.crdtState === '') {
    return errorResponse('Target version is missing CRDT state required for merge', 422);
  }

  // Merge CRDT states — pure function, no commit
  const mergeResult = mergeCrdtStates({
    sourceState: sourceVersion.crdtState,
    targetState: targetVersion.crdtState,
  });

  return jsonResponse({
    success: mergeResult.success,
    snapshot: mergeResult.mergedSnapshot,
  });
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
): Promise<Response> {
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
        strategy: r.strategy as 'take-source' | 'take-target' | 'merge-crdt' | 'manual',
        resolvedSnapshot: r.resolvedSnapshot,
      })),
      mergedById: context.principal.id,
      mergedByType: context.principal.type,
    });
  } else {
    result = await executeMerge({
      mergeRequestId: context.mergeRequestId,
      mergedById: context.principal.id,
      mergedByType: context.principal.type,
    });
  }

  // Note: executeMerge already updates the merge request status to 'merged'

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
          return await handleCheckMergeability(request);
        case 'execute':
          return await handleExecuteMerge(request, context);
        case 'preview':
          return await handlePreviewMerge(request);
        case 'crdt-preview':
          return await handleCrdtPreview(request);
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
    if (error instanceof InvalidCrdtStateError) {
      return errorResponse(error.message, 422, {
        source: error.source,
        reason: error.reason,
      });
    }
    if (error instanceof MissingCrdtStateError) {
      return errorResponse(error.message, 422, {
        versionId: error.versionId,
      });
    }

    // Re-throw unknown errors
    throw error;
  }
}
