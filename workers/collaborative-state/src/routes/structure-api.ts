/**
 * Phase 7.1.1b: Structure API Routes
 *
 * REST API endpoints for structure operations.
 * Structures are branch-scoped for isolation during development.
 */

import {
  createStructure,
  getBranch,
  getBranchStructure,
  listBranchStructures,
  updateBranchStructure,
  deleteBranchStructure,
  getStructureAtCheckpoint,
  getCheckpoint,
  BranchNotFoundError,
  StructureNotFoundError,
  DuplicateStructureSlugError,
  CheckpointNotFoundError,
  InvalidSlugError,
} from '../services';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import type { AuthenticatedPrincipal } from '../types';
import { validatePagination, validateJsonSize, SIZE_LIMITS } from './validation';

/**
 * Request context for structure routes
 */
export interface StructureRouteContext {
  siteId: string;
  branchId?: string;
  checkpointId?: string;
  structureId?: string;
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
 * Request body for creating a structure
 */
interface CreateStructureBody {
  name?: string;
  slug?: string;
  description?: string;
  structureType?: string;
  metadataSchema?: Record<string, unknown>;
  schemaEnforcement?: string;
}

/**
 * Request body for updating a structure
 */
interface UpdateStructureBody {
  name?: string;
  slug?: string;
  description?: string;
  metadataSchema?: Record<string, unknown>;
  schemaEnforcement?: string;
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
 * Handle POST /api/sites/{siteId}/branches/{branchId}/structures - Create Structure
 */
async function handleCreateStructure(
  request: Request,
  context: StructureRouteContext,
): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }

  const body = await parseJsonBody<CreateStructureBody>(request);

  // Validate required fields
  if (body.name === undefined || body.name.trim() === '') {
    return errorResponse('name is required', 400);
  }

  // Validate schema size
  const schemaError = validateJsonSize(
    body.metadataSchema,
    SIZE_LIMITS.MAX_SCHEMA_SIZE_BYTES,
    'metadataSchema',
  );
  if (schemaError !== undefined) {
    return errorResponse(schemaError, 400);
  }

  const structure = await createStructure({
    siteId: context.siteId,
    branchId: context.branchId,
    name: body.name,
    slug: body.slug,
    description: body.description,
    structureType: body.structureType as 'hierarchy' | 'collection' | undefined,
    metadataSchema: body.metadataSchema,
    schemaEnforcement: body.schemaEnforcement as 'strict' | 'warn' | 'none' | undefined,
  });

  return jsonResponse(structure, 201);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/structures - List Structures
 */
async function handleListStructures(
  request: Request,
  context: StructureRouteContext,
): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }

  const url = new URL(request.url);
  const structureType = url.searchParams.get('type');
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  // Validate pagination parameters
  const pagination = validatePagination(limitParam, offsetParam);
  if (!pagination.valid) {
    return errorResponse(pagination.error ?? 'Invalid pagination parameters', 400);
  }

  const structures = await listBranchStructures(context.branchId, {
    structureType: structureType as 'hierarchy' | 'collection' | undefined,
    limit: pagination.limit,
    offset: pagination.offset,
  });

  return jsonResponse({ structures });
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId} - Get Structure
 */
async function handleGetStructure(context: StructureRouteContext): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }
  if (context.structureId === undefined) {
    return errorResponse('Structure ID is required', 400);
  }

  const structure = await getBranchStructure(context.branchId, context.structureId);

  if (structure === null) {
    return errorResponse('Structure not found', 404);
  }

  return jsonResponse(structure);
}

/**
 * Handle GET /api/sites/{siteId}/checkpoints/{checkpointId}/structures/{structureId}
 */
async function handleGetStructureAtCheckpoint(
  context: StructureRouteContext,
): Promise<Response> {
  if (context.checkpointId === undefined) {
    return errorResponse('Checkpoint ID is required', 400);
  }
  if (context.structureId === undefined) {
    return errorResponse('Structure ID is required', 400);
  }

  const structure = await getStructureAtCheckpoint(
    context.checkpointId,
    context.structureId,
  );

  if (structure === null) {
    return errorResponse('Structure not found at checkpoint', 404);
  }

  return jsonResponse(structure);
}

/**
 * Handle PATCH /api/sites/{siteId}/branches/{branchId}/structures/{structureId}
 */
async function handleUpdateStructure(
  request: Request,
  context: StructureRouteContext,
): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }
  if (context.structureId === undefined) {
    return errorResponse('Structure ID is required', 400);
  }

  const body = await parseJsonBody<UpdateStructureBody>(request);

  // Validate schema size
  const schemaError = validateJsonSize(
    body.metadataSchema,
    SIZE_LIMITS.MAX_SCHEMA_SIZE_BYTES,
    'metadataSchema',
  );
  if (schemaError !== undefined) {
    return errorResponse(schemaError, 400);
  }

  const updatedStructure = await updateBranchStructure(
    context.branchId,
    context.structureId,
    {
      name: body.name,
      slug: body.slug,
      description: body.description,
      metadataSchema: body.metadataSchema,
      schemaEnforcement: body.schemaEnforcement as 'strict' | 'warn' | 'none' | undefined,
    },
  );

  return jsonResponse(updatedStructure);
}

/**
 * Handle DELETE /api/sites/{siteId}/branches/{branchId}/structures/{structureId}
 */
async function handleDeleteStructure(context: StructureRouteContext): Promise<Response> {
  if (context.branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }
  if (context.structureId === undefined) {
    return errorResponse('Structure ID is required', 400);
  }

  await deleteBranchStructure(context.branchId, context.structureId);

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for structure operations
 */
export async function handleStructureRoutes(
  request: Request,
  context: StructureRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Handle checkpoint structure lookups
    if (context.checkpointId !== undefined) {
      if (method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
      // Look up checkpoint to get branchId for authorization
      try {
        const checkpoint = await getCheckpoint(context.checkpointId);
        if (checkpoint != null) {
          await assertPermission(context.principal, context.siteId, checkpoint.branchId, 'canView');
        }
      } catch (error) {
        if (error instanceof AuthorizationError) {
          throw error;
        }
        // If checkpoint lookup fails, defer to handler for proper error handling
      }
      return await handleGetStructureAtCheckpoint(context);
    }

    // All remaining routes require branchId
    if (context.branchId === undefined) {
      return errorResponse('Branch ID is required', 400);
    }

    // Verify branch exists and belongs to the correct site
    const branch = await getBranch(context.branchId);
    if (branch?.siteId !== context.siteId) {
      return errorResponse('Branch not found', 404);
    }

    // Routes with structureId (single structure operations)
    if (context.structureId !== undefined) {
      switch (method) {
        case 'GET':
          await assertPermission(context.principal, context.siteId, context.branchId, 'canView');
          return await handleGetStructure(context);
        case 'PATCH':
          await assertPermission(context.principal, context.siteId, context.branchId, 'canEdit');
          return await handleUpdateStructure(request, context);
        case 'DELETE':
          await assertPermission(context.principal, context.siteId, context.branchId, 'canEdit');
          return await handleDeleteStructure(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes without structureId (collection operations)
    switch (method) {
      case 'GET':
        await assertPermission(context.principal, context.siteId, context.branchId, 'canView');
        return await handleListStructures(request, context);
      case 'POST':
        await assertPermission(context.principal, context.siteId, context.branchId, 'canEdit');
        return await handleCreateStructure(request, context);
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
    if (error instanceof StructureNotFoundError) {
      return errorResponse('Structure not found', 404);
    }
    if (error instanceof DuplicateStructureSlugError) {
      return errorResponse('Structure with this slug already exists', 409);
    }
    if (error instanceof InvalidSlugError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof CheckpointNotFoundError) {
      return errorResponse('Checkpoint not found', 404);
    }

    // Log and return generic error for unknown errors
    console.error('Structure API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
