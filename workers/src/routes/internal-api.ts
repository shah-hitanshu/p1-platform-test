/**
 * Phase 1.2: Internal API Routes
 *
 * Internal API endpoints for Durable Object to PostgreSQL synchronization.
 * These endpoints are not exposed to external clients - they are called
 * by Durable Objects to persist state to the database.
 *
 * Authentication is via X-Internal-Secret header instead of user/agent tokens.
 */

import {
  syncCrdtToPostgres,
  loadLatestCrdtState,
  DocumentNotFoundError,
  SyncError,
} from '../services/crdt-sync-service';

// =============================================================================
// Types
// =============================================================================

/**
 * Context for internal API routes
 */
export interface InternalRouteContext {
  /** The shared secret for internal authentication */
  internalSecret: string;
}

/**
 * Request body for CRDT sync endpoint
 */
interface CrdtSyncBody {
  siteId: string;
  documentPath: string;
  branchId: string;
  snapshot: Record<string, unknown>;
  crdtState: string;
  actorId: string;
  actorType: 'user' | 'agent';
}

// =============================================================================
// Helpers
// =============================================================================

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
 * Validate the request body for CRDT sync
 */
function validateCrdtSyncBody(body: unknown): { valid: false; error: string } | { valid: true; data: CrdtSyncBody } {
  if (body === null || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const data = body as Record<string, unknown>;

  // Validate siteId
  if (typeof data.siteId !== 'string' || data.siteId.trim() === '') {
    return { valid: false, error: 'siteId is required and must be a non-empty string' };
  }

  // Validate documentPath
  if (typeof data.documentPath !== 'string' || data.documentPath.trim() === '') {
    return { valid: false, error: 'documentPath is required and must be a non-empty string' };
  }

  // Validate branchId
  if (typeof data.branchId !== 'string' || data.branchId.trim() === '') {
    return { valid: false, error: 'branchId is required and must be a non-empty string' };
  }

  // Validate snapshot (must be object)
  if (data.snapshot === null || typeof data.snapshot !== 'object' || Array.isArray(data.snapshot)) {
    return { valid: false, error: 'snapshot is required and must be an object' };
  }

  // Validate crdtState
  if (typeof data.crdtState !== 'string' || data.crdtState.trim() === '') {
    return { valid: false, error: 'crdtState is required and must be a non-empty string' };
  }

  // Validate actorId
  if (typeof data.actorId !== 'string' || data.actorId.trim() === '') {
    return { valid: false, error: 'actorId is required and must be a non-empty string' };
  }

  // Validate actorType
  if (data.actorType !== 'user' && data.actorType !== 'agent') {
    return { valid: false, error: 'actorType must be "user" or "agent"' };
  }

  return {
    valid: true,
    data: {
      siteId: data.siteId,
      documentPath: data.documentPath,
      branchId: data.branchId,
      snapshot: data.snapshot as Record<string, unknown>,
      crdtState: data.crdtState,
      actorId: data.actorId,
      actorType: data.actorType,
    },
  };
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * Handle POST /internal/crdt-sync
 * Syncs CRDT state from a Durable Object to PostgreSQL
 */
async function handleCrdtSync(request: Request): Promise<Response> {
  // Parse request body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse('Invalid JSON in request body', 400);
  }

  // Validate body
  const validation = validateCrdtSyncBody(rawBody);
  if (!validation.valid) {
    return errorResponse(validation.error, 400);
  }

  const { data } = validation;

  try {
    const version = await syncCrdtToPostgres({
      siteId: data.siteId,
      documentPath: data.documentPath,
      branchId: data.branchId,
      snapshot: data.snapshot,
      crdtState: data.crdtState,
      actorId: data.actorId,
      actorType: data.actorType,
    });

    return jsonResponse({ version });
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      return errorResponse(`Document not found: ${error.documentPath}`, 404);
    }
    if (error instanceof SyncError) {
      return errorResponse(`Sync failed: ${error.message}`, 500);
    }
    throw error;
  }
}

/**
 * Handle GET /internal/crdt-state
 * Loads the latest CRDT state from PostgreSQL for a document on a branch.
 * Used by Durable Objects to initialize from PostgreSQL when storage is empty.
 *
 * Query params: siteId, documentPath, branchId
 */
async function handleLoadCrdtState(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Get query parameters
  const siteId = url.searchParams.get('siteId');
  const documentPath = url.searchParams.get('documentPath');
  const branchId = url.searchParams.get('branchId');

  // Validate required params
  if (siteId === null || siteId === '') {
    return errorResponse('siteId query parameter is required', 400);
  }
  if (documentPath === null || documentPath === '') {
    return errorResponse('documentPath query parameter is required', 400);
  }
  if (branchId === null || branchId === '') {
    return errorResponse('branchId query parameter is required', 400);
  }

  try {
    const result = await loadLatestCrdtState(siteId, documentPath, branchId);

    if (result === null) {
      // Document not found or no versions - return 404
      return jsonResponse({ found: false }, 404);
    }

    // Return snapshot and CRDT state
    return jsonResponse({
      found: true,
      snapshot: result.snapshot,
      crdtState: result.crdtState ?? null,
    });
  } catch (error) {
    console.error('Error loading CRDT state:', error);
    return errorResponse('Failed to load CRDT state', 500);
  }
}

// =============================================================================
// Main Route Handler
// =============================================================================

/**
 * Main route handler for internal API operations
 */
export async function handleInternalRoutes(
  request: Request,
  context: InternalRouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Authenticate using X-Internal-Secret header
  const providedSecret = request.headers.get('X-Internal-Secret');

  if (providedSecret === null || providedSecret === '') {
    return errorResponse('X-Internal-Secret header is required', 401);
  }

  if (providedSecret !== context.internalSecret) {
    return errorResponse('Invalid X-Internal-Secret', 403);
  }

  // Route to appropriate handler
  if (path === '/internal/crdt-sync') {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    return handleCrdtSync(request);
  }

  if (path === '/internal/crdt-state') {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }
    return handleLoadCrdtState(request);
  }

  return errorResponse('Not found', 404);
}
