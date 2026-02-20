/**
 * Phase 7.1b: Checkpoint API Routes
 *
 * REST API endpoints for checkpoint operations.
 */

import type { CheckpointType, AuthenticatedPrincipal } from '../types';
import {
  createCheckpoint,
  getCheckpoint,
  listCheckpoints,
  getDocumentsAtCheckpoint,
  revertToCheckpoint,
  deleteCheckpoint,
  getBranch,
  CheckpointNotFoundError,
  BranchNotFoundError,
} from '../services';
import { assertPermission, AuthorizationError } from '../auth/authorization';

/**
 * Request context for checkpoint routes
 */
export interface CheckpointRouteContext {
  siteId: string;
  branchId?: string;
  checkpointId?: string;
  documentsPath?: boolean;
  revert?: boolean;
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
 * Request body for creating a checkpoint
 */
interface CreateCheckpointBody {
  name?: string;
  type?: CheckpointType;
}

/**
 * Request body for reverting to a checkpoint
 */
interface RevertCheckpointBody {
  name?: string;
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
 * Handle POST /api/sites/{siteId}/branches/{branchId}/checkpoints - Create Checkpoint
 */
async function handleCreateCheckpoint(
  request: Request,
  context: CheckpointRouteContext,
): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }

  // Verify branch exists
  const branch = await getBranch(context.branchId);
  if (branch === null) {
    return errorResponse('Branch not found', 404);
  }

  const body = await parseJsonBody<CreateCheckpointBody>(request);

  const trimmedName = body.name?.trim();
  const result = await createCheckpoint({
    branchId: context.branchId,
    name: trimmedName !== undefined && trimmedName !== '' ? trimmedName : undefined,
    checkpointType: body.type ?? 'manual',
    createdById: context.principal.id,
    createdByType: context.principal.type as 'user' | 'agent',
  });

  return jsonResponse(result, 201);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/checkpoints - List Checkpoints
 */
async function handleListCheckpoints(
  request: Request,
  context: CheckpointRouteContext,
): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  const limit = limitParam !== null ? parseInt(limitParam, 10) : undefined;
  const offset = offsetParam !== null ? parseInt(offsetParam, 10) : undefined;

  const checkpoints = await listCheckpoints(
    context.branchId ?? '',
    {
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
    },
  );

  return jsonResponse({ checkpoints });
}

/**
 * Handle GET /api/sites/{siteId}/checkpoints/{checkpointId}/documents - Get Documents at Checkpoint
 */
async function handleGetDocumentsAtCheckpoint(
  context: CheckpointRouteContext,
): Promise<Response> {
  if (context.checkpointId === undefined) {
    return errorResponse('Checkpoint ID is required', 400);
  }

  const documents = await getDocumentsAtCheckpoint(context.checkpointId);

  return jsonResponse({ documents });
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/checkpoints/{checkpointId}/revert
 */
async function handleRevertToCheckpoint(
  request: Request,
  context: CheckpointRouteContext,
): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }
  if (context.checkpointId === undefined) {
    return errorResponse('Checkpoint ID is required', 400);
  }

  const body = await parseJsonBody<RevertCheckpointBody>(request);

  const result = await revertToCheckpoint({
    checkpointId: context.checkpointId,
    branchId: context.branchId,
    name: body.name ?? 'Reverted to checkpoint',
    createdById: context.principal.id,
    createdByType: context.principal.type as 'user' | 'agent',
  });

  return jsonResponse(result);
}

/**
 * Handle DELETE /api/sites/{siteId}/checkpoints/{checkpointId} - Delete Checkpoint
 */
async function handleDeleteCheckpoint(
  context: CheckpointRouteContext,
): Promise<Response> {
  if (context.checkpointId === undefined) {
    return errorResponse('Checkpoint ID is required', 400);
  }

  const deleted = await deleteCheckpoint(context.checkpointId);

  if (!deleted) {
    return errorResponse('Checkpoint not found', 404);
  }

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for checkpoint operations
 */
export async function handleCheckpointRoutes(
  request: Request,
  context: CheckpointRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Handle revert operation
    if (context.revert === true && context.checkpointId !== undefined) {
      if (method === 'POST') {
        if (context.branchId === undefined) {
          return errorResponse('Branch ID is required', 400);
        }
        await assertPermission(context.principal, context.siteId, context.branchId, 'canCreateCheckpoint');
        return await handleRevertToCheckpoint(request, context);
      }
      return errorResponse('Method not allowed', 405);
    }

    // Handle documents at checkpoint
    if (context.documentsPath === true && context.checkpointId !== undefined) {
      if (method === 'GET') {
        // Look up checkpoint to get branchId for authorization
        const checkpoint = await getCheckpoint(context.checkpointId);
        if (checkpoint != null) {
          await assertPermission(context.principal, context.siteId, checkpoint.branchId, 'canView');
        }
        return await handleGetDocumentsAtCheckpoint(context);
      }
      return errorResponse('Method not allowed', 405);
    }

    // Handle single checkpoint operations (with checkpointId, no branchId)
    if (context.checkpointId !== undefined && context.branchId === undefined) {
      // Look up checkpoint to get branchId for authorization
      const checkpoint = await getCheckpoint(context.checkpointId);
      if (checkpoint == null) {
        // Checkpoint not found - for GET, return 404 immediately.
        // For DELETE, delegate to handler for consistent 404 handling.
        if (method === 'GET') {
          return errorResponse('Checkpoint not found', 404);
        }
        if (method === 'DELETE') {
          return await handleDeleteCheckpoint(context);
        }
        return errorResponse('Method not allowed', 405);
      }
      switch (method) {
        case 'GET':
          await assertPermission(context.principal, context.siteId, checkpoint.branchId, 'canView');
          // Return the already-fetched checkpoint to avoid a second getCheckpoint call
          return jsonResponse(checkpoint);
        case 'DELETE':
          await assertPermission(context.principal, context.siteId, checkpoint.branchId, 'canManageGrants');
          return await handleDeleteCheckpoint(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Handle branch checkpoint operations
    if (context.branchId !== undefined) {
      switch (method) {
        case 'GET':
          await assertPermission(context.principal, context.siteId, context.branchId, 'canView');
          return await handleListCheckpoints(request, context);
        case 'POST':
          await assertPermission(context.principal, context.siteId, context.branchId, 'canCreateCheckpoint');
          return await handleCreateCheckpoint(request, context);
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
    if (error instanceof CheckpointNotFoundError) {
      return errorResponse('Checkpoint not found', 404);
    }
    if (error instanceof BranchNotFoundError) {
      return errorResponse('Branch not found', 404);
    }

    // Re-throw unknown errors
    throw error;
  }
}
