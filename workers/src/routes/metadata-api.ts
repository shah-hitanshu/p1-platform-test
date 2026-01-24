/**
 * Phase 7.1.1b: Metadata API Routes
 *
 * REST API endpoints for document metadata operations.
 * Metadata is branch-scoped via structure association.
 */

import {
  getBranchStructureState,
  updateBranchStructureState,
  getDocumentMetadata,
  setDocumentMetadata,
  deleteDocumentMetadata,
  listDocumentMetadata,
  validateAllDocuments,
  getSchemaValidationSummary,
  StructureNotFoundError,
  BranchStructureStateNotFoundError,
  DocumentMetadataNotFoundError,
  SchemaValidationError,
} from '../services';

/**
 * Request context for metadata routes
 */
export interface MetadataRouteContext {
  siteId: string;
  branchId: string;
  structureId: string;
  documentId?: string;
  action?: 'state' | 'schema' | 'validate' | 'list';
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
 * Request body for updating schema
 */
interface UpdateSchemaBody {
  schema?: Record<string, unknown>;
  enforcement?: string;
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
 * Handle GET /structures/{structureId}/state - Get Branch Structure State
 */
async function handleGetStructureState(
  context: MetadataRouteContext,
): Promise<Response> {
  const state = await getBranchStructureState(context.branchId, context.structureId);

  if (state === null) {
    return errorResponse('Structure state not found', 404);
  }

  return jsonResponse(state);
}

/**
 * Handle PUT /structures/{structureId}/schema - Update Schema
 */
async function handleUpdateSchema(
  request: Request,
  context: MetadataRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<UpdateSchemaBody>(request);

  const updatedState = await updateBranchStructureState(context.branchId, context.structureId, {
    metadataSchema: body.schema,
    schemaEnforcement: body.enforcement as 'strict' | 'warn' | 'none' | undefined,
  });

  // Get validation summary after schema update
  const validationResult = await getSchemaValidationSummary(
    context.branchId,
    context.structureId,
  );

  return jsonResponse({
    ...updatedState,
    validationResult,
  });
}

/**
 * Handle POST /structures/{structureId}/validate - Validate All Documents
 */
async function handleValidateDocuments(
  context: MetadataRouteContext,
): Promise<Response> {
  const result = await validateAllDocuments(context.branchId, context.structureId);

  return jsonResponse(result);
}

/**
 * Handle GET /documents/{documentId}/metadata - Get Document Metadata
 */
async function handleGetDocumentMetadata(
  context: MetadataRouteContext,
): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const metadata = await getDocumentMetadata({
    branchId: context.branchId,
    structureId: context.structureId,
    documentId: context.documentId,
  });

  if (metadata === null) {
    return errorResponse('Document metadata not found', 404);
  }

  return jsonResponse(metadata);
}

/**
 * Handle PUT /documents/{documentId}/metadata - Update Document Metadata
 */
async function handleUpdateDocumentMetadata(
  request: Request,
  context: MetadataRouteContext,
): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const metadata = await parseJsonBody<Record<string, unknown>>(request);

  const result = await setDocumentMetadata({
    branchId: context.branchId,
    structureId: context.structureId,
    documentId: context.documentId,
    metadata,
  });

  return jsonResponse(result);
}

/**
 * Handle DELETE /documents/{documentId}/metadata - Delete Document Metadata
 */
async function handleDeleteDocumentMetadata(
  context: MetadataRouteContext,
): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  await deleteDocumentMetadata({
    branchId: context.branchId,
    structureId: context.structureId,
    documentId: context.documentId,
  });

  return new Response(null, { status: 204 });
}

/**
 * Handle GET /structures/{structureId}/metadata - List Document Metadata
 */
async function handleListDocumentMetadata(
  request: Request,
  context: MetadataRouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  const conformingParam = url.searchParams.get('conforming');

  const conforming =
    conformingParam === 'true'
      ? true
      : conformingParam === 'false'
        ? false
        : undefined;

  const documents = await listDocumentMetadata({
    branchId: context.branchId,
    structureId: context.structureId,
    conforming,
  });

  return jsonResponse({ documents });
}

/**
 * Main route handler for metadata operations
 */
export async function handleMetadataRoutes(
  request: Request,
  context: MetadataRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Handle action-based routes
    switch (context.action) {
      case 'state':
        if (method !== 'GET') {
          return errorResponse('Method not allowed', 405);
        }
        return await handleGetStructureState(context);

      case 'schema':
        if (method !== 'PUT') {
          return errorResponse('Method not allowed', 405);
        }
        return await handleUpdateSchema(request, context);

      case 'validate':
        if (method !== 'POST') {
          return errorResponse('Method not allowed', 405);
        }
        return await handleValidateDocuments(context);

      case 'list':
        if (method !== 'GET') {
          return errorResponse('Method not allowed', 405);
        }
        return await handleListDocumentMetadata(request, context);
    }

    // Document-specific metadata routes
    if (context.documentId !== undefined) {
      switch (method) {
        case 'GET':
          return await handleGetDocumentMetadata(context);
        case 'PUT':
          return await handleUpdateDocumentMetadata(request, context);
        case 'DELETE':
          return await handleDeleteDocumentMetadata(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    return errorResponse('Invalid route', 400);
  } catch (error) {
    // Handle known errors
    if (error instanceof StructureNotFoundError) {
      return errorResponse('Structure not found', 404);
    }
    if (error instanceof BranchStructureStateNotFoundError) {
      return errorResponse('Structure state not found', 404);
    }
    if (error instanceof DocumentMetadataNotFoundError) {
      return errorResponse('Document metadata not found', 404);
    }
    if (error instanceof SchemaValidationError) {
      return errorResponse('Schema validation failed', 400, {
        documentId: error.documentId,
        errors: error.validationErrors,
      });
    }

    // Log and return generic error for unknown errors
    console.error('Metadata API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
