/**
 * Phase 7.1.1b: Document CRUD API Routes
 *
 * REST API endpoints for document CRUD operations.
 * Includes soft-delete with archive/restore functionality.
 */

import type { AuthenticatedPrincipal } from '../types';
import {
  createDocument,
  getDocument,
  getDocumentByPath,
  updateDocumentPath,
  archiveDocument,
  restoreDocument,
  listDocuments,
  // Branch-scoped document operations
  listDocumentsOnBranch,
  createDocumentOnBranch,
  documentExistsOnBranch,
  deleteDocumentOnBranch,
  getBranch,
  getMainBranch,
  // Document version operations
  getLatestDocumentVersion,
  getLatestDocumentVersionWithFallback,
  getDocumentVersion,
  listDocumentVersions,
  createDocumentVersion,
  SiteNotFoundError,
  DuplicateDocumentPathError,
  InvalidDocumentPathError,
  DocumentNotFoundError,
  DocumentPathConflictError,
  InvalidDocumentVersionParamsError,
} from '../services';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { validatePagination } from './validation';

/**
 * Request context for document routes
 */
export interface DocumentRouteContext {
  siteId: string;
  branchId?: string;
  documentId?: string;
  documentPath?: string;
  action?: 'restore';
  versionsPath?: boolean;
  versionAction?: 'latest' | 'by-id';
  versionId?: string;
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
 * Request body for creating a document
 */
interface CreateDocumentBody {
  path?: string;
  snapshot?: Record<string, unknown>;
}

/**
 * Request body for updating a document
 */
interface UpdateDocumentBody {
  path?: string;
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
 * Handle POST /api/sites/{siteId}/documents - Create Document
 */
async function handleCreateDocument(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<CreateDocumentBody>(request);

  // Validate required fields
  if (body.path === undefined || body.path.trim() === '') {
    return errorResponse('path is required', 400);
  }

  const document = await createDocument({
    siteId: context.siteId,
    path: body.path,
  });

  return jsonResponse(document, 201);
}

/**
 * Handle GET /api/sites/{siteId}/documents - List Documents
 */
async function handleListDocuments(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const pathPrefix = url.searchParams.get('pathPrefix');
  const archivedParam = url.searchParams.get('archived');

  // Validate pagination parameters
  const pagination = validatePagination(limitParam, offsetParam);
  if (!pagination.valid) {
    return errorResponse(pagination.error ?? 'Invalid pagination parameters', 400);
  }

  const archived = archivedParam === 'true' ? true : archivedParam === 'false' ? false : undefined;

  const documents = await listDocuments(context.siteId, {
    limit: pagination.limit,
    offset: pagination.offset,
    pathPrefix: pathPrefix ?? undefined,
    archived,
  });

  return jsonResponse({ documents });
}

/**
 * Handle GET /api/sites/{siteId}/documents/{documentId} - Get Document
 */
async function handleGetDocument(context: DocumentRouteContext): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const document = await getDocument(context.documentId);

  if (document === null) {
    return errorResponse('Document not found', 404);
  }

  return jsonResponse(document);
}

/**
 * Handle GET /api/sites/{siteId}/documents/by-path/{documentPath} - Get by Path
 */
async function handleGetDocumentByPath(context: DocumentRouteContext): Promise<Response> {
  if (context.documentPath === undefined) {
    return errorResponse('Document path is required', 400);
  }

  const document = await getDocumentByPath(context.siteId, context.documentPath);

  if (document === null) {
    return errorResponse('Document not found at path', 404);
  }

  return jsonResponse(document);
}

/**
 * Handle PATCH /api/sites/{siteId}/documents/{documentId} - Update Document Path
 */
async function handleUpdateDocument(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const body = await parseJsonBody<UpdateDocumentBody>(request);

  if (body.path === undefined || body.path.trim() === '') {
    return errorResponse('path is required', 400);
  }

  const updatedDocument = await updateDocumentPath(context.documentId, body.path);

  if (updatedDocument === null) {
    return errorResponse('Document not found', 404);
  }

  return jsonResponse(updatedDocument);
}

/**
 * Handle DELETE /api/sites/{siteId}/documents/{documentId} - Soft Delete (Archive)
 */
async function handleDeleteDocument(context: DocumentRouteContext): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const archived = await archiveDocument(context.documentId);

  if (!archived) {
    return errorResponse('Document not found', 404);
  }

  return new Response(null, { status: 204 });
}

/**
 * Handle POST /api/sites/{siteId}/documents/{documentId}/restore - Restore Document
 */
async function handleRestoreDocument(context: DocumentRouteContext): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const document = await restoreDocument(context.documentId);

  return jsonResponse(document);
}

// =============================================================================
// Branch-Scoped Document Operations
// =============================================================================

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents
 *
 * For non-main branches, includes inherited documents from main via COW fallback.
 */
async function handleListDocumentsOnBranch(
  request: Request,
  siteId: string,
  branchId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const pathPrefix = url.searchParams.get('pathPrefix');

  // For non-main branches, pass mainBranchId to enable copy-on-write fallback
  const branch = await getBranch(branchId);
  const mainBranch = branch && !branch.isMain ? await getMainBranch(siteId) : null;

  const documents = await listDocumentsOnBranch(branchId, {
    pathPrefix: pathPrefix ?? undefined,
    mainBranchId: mainBranch?.id,
  });

  return jsonResponse({ documents });
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/documents
 */
async function handleCreateDocumentOnBranch(
  request: Request,
  siteId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<CreateDocumentBody>(request);

  if (body.path === undefined || body.path.trim() === '') {
    return errorResponse('path is required', 400);
  }

  const result = await createDocumentOnBranch({
    siteId,
    branchId,
    path: body.path,
    snapshot: body.snapshot,
    createdById: principal.id,
    createdByType: principal.type as 'user' | 'agent',
  });

  return jsonResponse(result, 201);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}
 */
async function handleGetDocumentOnBranch(
  documentId: string,
  branchId: string,
  siteId: string,
  isMainBranch: boolean,
): Promise<Response> {
  // Check if document exists on this branch
  const exists = await documentExistsOnBranch(documentId, branchId);
  if (!exists) {
    // For non-main branches, check if document is inherited from main
    if (!isMainBranch) {
      const mainBranch = await getMainBranch(siteId);
      if (mainBranch !== null) {
        const fallback = await getLatestDocumentVersionWithFallback(
          documentId, branchId, mainBranch.id,
        );
        if (fallback !== null) {
          // Document exists on main — return it
          const document = await getDocument(documentId);
          if (document !== null) {
            return jsonResponse(document);
          }
        }
      }
    }
    return errorResponse('Document not found on this branch', 404);
  }

  // Get the document details
  const document = await getDocument(documentId);
  if (document === null) {
    return errorResponse('Document not found', 404);
  }

  return jsonResponse(document);
}

/**
 * Handle DELETE /api/sites/{siteId}/branches/{branchId}/documents/{documentId}
 */
async function handleDeleteDocumentOnBranch(
  documentId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  await deleteDocumentOnBranch({
    documentId,
    branchId,
    deletedById: principal.id,
    deletedByType: principal.type as 'user' | 'agent',
  });

  return new Response(null, { status: 204 });
}

// =============================================================================
// Document Version Operations
// =============================================================================

/**
 * Request body for creating a document version
 */
interface CreateVersionBody {
  snapshot?: Record<string, unknown> | null;
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions
 */
async function handleListDocumentVersions(
  documentId: string,
  branchId: string,
): Promise<Response> {
  const versions = await listDocumentVersions(documentId, branchId);
  return jsonResponse({ versions });
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/latest
 */
async function handleGetLatestDocumentVersion(
  documentId: string,
  branchId: string,
  siteId: string,
  isMainBranch: boolean,
): Promise<Response> {
  // Try local version first
  const version = await getLatestDocumentVersion(documentId, branchId);
  if (version !== null) {
    return jsonResponse(version);
  }

  // For non-main branches, fall back to main's published version
  if (!isMainBranch) {
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch !== null) {
      const fallback = await getLatestDocumentVersionWithFallback(
        documentId, branchId, mainBranch.id,
      );
      if (fallback !== null) {
        return jsonResponse({ ...fallback.version, inherited: fallback.inherited });
      }
    }
  }

  return errorResponse('No versions found for this document on this branch', 404);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/{versionId}
 */
async function handleGetDocumentVersionById(
  documentId: string,
  branchId: string,
  versionId: string,
): Promise<Response> {
  // Fetch version by ID
  const version = await getDocumentVersion(versionId);

  // Validate version exists and belongs to this document/branch
  if (version?.documentId !== documentId || version.branchId !== branchId) {
    return errorResponse('Version not found', 404);
  }

  return jsonResponse(version);
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions
 */
async function handleCreateDocumentVersion(
  request: Request,
  documentId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<CreateVersionBody>(request);

  // Validate snapshot is present and is an object
  if (body.snapshot === undefined) {
    return errorResponse('snapshot is required', 400);
  }

  // Validate snapshot is a non-null, non-array object
  if (typeof body.snapshot !== 'object' || body.snapshot === null || Array.isArray(body.snapshot)) {
    return errorResponse('snapshot must be a JSON object', 400);
  }

  const version = await createDocumentVersion({
    documentId,
    branchId,
    snapshot: body.snapshot,
    source: 'edit',
    createdById: principal.id,
    createdByType: principal.type as 'user' | 'agent',
  });

  return jsonResponse(version, 201);
}

/**
 * Handle document version routes within branch scope
 */
async function handleDocumentVersionRoutes(
  request: Request,
  documentId: string,
  branchId: string,
  context: DocumentRouteContext,
  isMainBranch: boolean,
): Promise<Response> {
  const method = request.method;

  // Check if document exists on branch (local versions)
  const exists = await documentExistsOnBranch(documentId, branchId);
  if (!exists) {
    // For non-main branches, check if document is inherited from main (COW)
    if (!isMainBranch) {
      const mainBranch = await getMainBranch(context.siteId);
      if (mainBranch !== null) {
        const fallback = await getLatestDocumentVersionWithFallback(
          documentId, branchId, mainBranch.id,
        );
        if (fallback === null) {
          return errorResponse('Document not found on this branch', 404);
        }
        // Document is inherited from main — allow version routes to proceed
      } else {
        return errorResponse('Document not found on this branch', 404);
      }
    } else {
      return errorResponse('Document not found on this branch', 404);
    }
  }

  // Authorization for version routes
  if (method === 'GET') {
    await assertPermission(context.principal, context.siteId, branchId, 'canView');
  } else if (method === 'POST') {
    await assertPermission(context.principal, context.siteId, branchId, 'canEditDocuments');
  }

  // GET /versions/latest
  if (context.versionAction === 'latest') {
    if (method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }
    return await handleGetLatestDocumentVersion(documentId, branchId, context.siteId, isMainBranch);
  }

  // GET /versions/{versionId}
  if (context.versionAction === 'by-id' && context.versionId !== undefined) {
    if (method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }
    return await handleGetDocumentVersionById(documentId, branchId, context.versionId);
  }

  // GET /versions - list versions
  // POST /versions - create version
  switch (method) {
    case 'GET':
      return await handleListDocumentVersions(documentId, branchId);
    case 'POST':
      return await handleCreateDocumentVersion(request, documentId, branchId, context.principal);
    default:
      return errorResponse('Method not allowed', 405);
  }
}

/**
 * Handle branch-scoped document routes
 */
async function handleBranchScopedDocumentRoutes(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const method = request.method;
  const branchId = context.branchId;

  if (branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }

  // Validate branch exists and belongs to the correct site
  const branch = await getBranch(branchId);
  if (branch?.siteId !== context.siteId) {
    return errorResponse('Branch not found', 404);
  }

  // Handle document version routes (authorization is handled inside handleDocumentVersionRoutes)
  if (context.versionsPath === true && context.documentId !== undefined) {
    return await handleDocumentVersionRoutes(request, context.documentId, branchId, context, branch.isMain);
  }

  // Authorization for branch-scoped document routes
  if (method === 'GET') {
    await assertPermission(context.principal, context.siteId, branchId, 'canView');
  } else if (method === 'POST' || method === 'DELETE') {
    await assertPermission(context.principal, context.siteId, branchId, 'canEditDocuments');
  }

  // Routes with documentId
  if (context.documentId !== undefined) {
    switch (method) {
      case 'GET':
        return await handleGetDocumentOnBranch(context.documentId, branchId, context.siteId, branch.isMain);
      case 'DELETE':
        return await handleDeleteDocumentOnBranch(context.documentId, branchId, context.principal);
      default:
        return errorResponse('Method not allowed', 405);
    }
  }

  // Collection routes
  switch (method) {
    case 'GET':
      return await handleListDocumentsOnBranch(request, context.siteId, branchId);
    case 'POST':
      return await handleCreateDocumentOnBranch(request, context.siteId, branchId, context.principal);
    default:
      return errorResponse('Method not allowed', 405);
  }
}

/**
 * Main route handler for document operations
 */
export async function handleDocumentRoutes(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Handle branch-scoped routes first (authorization handled inside)
    if (context.branchId !== undefined) {
      return await handleBranchScopedDocumentRoutes(request, context);
    }

    // Site-scoped routes: look up main branch for authorization
    const mainBranch = await getMainBranch(context.siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }

    // Authorization for site-scoped document routes
    if (method === 'GET') {
      await assertPermission(context.principal, context.siteId, mainBranch.id, 'canView');
    } else {
      await assertPermission(context.principal, context.siteId, mainBranch.id, 'canEditDocuments');
    }

    // Handle restore action
    if (context.action === 'restore') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleRestoreDocument(context);
    }

    // Handle by-path lookup
    if (context.documentPath !== undefined) {
      if (method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleGetDocumentByPath(context);
    }

    // Routes with documentId (single document operations)
    if (context.documentId !== undefined) {
      switch (method) {
        case 'GET':
          return await handleGetDocument(context);
        case 'PATCH':
          return await handleUpdateDocument(request, context);
        case 'DELETE':
          return await handleDeleteDocument(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes without documentId (collection operations)
    switch (method) {
      case 'GET':
        return await handleListDocuments(request, context);
      case 'POST':
        return await handleCreateDocument(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    if (error instanceof SiteNotFoundError) {
      return errorResponse('Site not found', 404);
    }
    if (error instanceof DuplicateDocumentPathError) {
      return errorResponse('Document already exists at this path', 409);
    }
    if (error instanceof InvalidDocumentPathError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof DocumentNotFoundError) {
      return errorResponse('Document not found or not archived', 404);
    }
    if (error instanceof DocumentPathConflictError) {
      return errorResponse('Path is now occupied by another document', 409);
    }
    if (error instanceof InvalidDocumentVersionParamsError) {
      return errorResponse(error.message, 400);
    }

    // Log and return generic error for unknown errors
    console.error('Document API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
