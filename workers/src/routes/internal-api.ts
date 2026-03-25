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
import {
  createCheckpoint,
  revertToCheckpoint,
  publishDocument,
  BranchNotFoundError,
  CheckpointNotFoundError,
} from '../services/checkpoint-service';
import type { CheckpointTrigger } from '../types';

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
  documentId: string;
  branchId: string;
  snapshot: Record<string, unknown>;
  crdtState: string;
  actorId: string;
  actorType: 'user' | 'agent';
}

/**
 * Request body for internal publish endpoint
 */
interface InternalPublishBody {
  siteId: string;
  branchId: string;
  documentId: string;
  createdById: string;
  createdByType: 'user' | 'agent';
}

/**
 * Request body for agent checkpoint start endpoint
 */
interface AgentCheckpointStartBody {
  branchId: string;
  agentId: string;
  intent: string;
  trigger: CheckpointTrigger;
  targetRegions?: string[];
  forceFullSnapshot?: boolean;
}

/**
 * Request body for agent checkpoint complete endpoint
 */
interface AgentCheckpointCompleteBody {
  branchId: string;
  agentId: string;
  intent: string;
  preEditCheckpointId: string;
  trigger?: CheckpointTrigger;
  affectedRegions?: string[];
}

/**
 * Request body for agent checkpoint rollback endpoint
 */
interface AgentCheckpointRollbackBody {
  checkpointId: string;
  agentId: string;
  reason?: string;
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

  // Validate documentId
  if (typeof data.documentId !== 'string' || data.documentId.trim() === '') {
    return { valid: false, error: 'documentId is required and must be a non-empty string' };
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
      documentId: data.documentId,
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
      documentId: data.documentId,
      branchId: data.branchId,
      snapshot: data.snapshot,
      crdtState: data.crdtState,
      actorId: data.actorId,
      actorType: data.actorType,
    });

    return jsonResponse({ version });
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      return errorResponse(`Document not found: ${error.documentId}`, 404);
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
 * Query params: siteId, documentId, branchId
 */
async function handleLoadCrdtState(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Get query parameters
  const siteId = url.searchParams.get('siteId');
  const documentId = url.searchParams.get('documentId');
  const branchId = url.searchParams.get('branchId');

  // Validate required params
  if (siteId === null || siteId === '') {
    return errorResponse('siteId query parameter is required', 400);
  }
  if (documentId === null || documentId === '') {
    return errorResponse('documentId query parameter is required', 400);
  }
  if (branchId === null || branchId === '') {
    return errorResponse('branchId query parameter is required', 400);
  }

  try {
    const result = await loadLatestCrdtState(siteId, documentId, branchId);

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
// Internal Publish Handler
// =============================================================================

/** Validation result type for internal publish */
type InternalPublishValidation =
  | { valid: false; error: string }
  | { valid: true; data: InternalPublishBody };

/**
 * Validate internal publish request body
 */
function validateInternalPublishBody(body: unknown): InternalPublishValidation {
  if (body === null || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const data = body as Record<string, unknown>;

  if (typeof data.siteId !== 'string' || data.siteId.trim() === '') {
    return { valid: false, error: 'siteId is required and must be a non-empty string' };
  }

  if (typeof data.branchId !== 'string' || data.branchId.trim() === '') {
    return { valid: false, error: 'branchId is required and must be a non-empty string' };
  }

  if (typeof data.documentId !== 'string' || data.documentId.trim() === '') {
    return { valid: false, error: 'documentId is required and must be a non-empty string' };
  }

  if (typeof data.createdById !== 'string' || data.createdById.trim() === '') {
    return { valid: false, error: 'createdById is required and must be a non-empty string' };
  }

  if (data.createdByType !== 'user' && data.createdByType !== 'agent') {
    return { valid: false, error: 'createdByType must be "user" or "agent"' };
  }

  return {
    valid: true,
    data: {
      siteId: data.siteId,
      branchId: data.branchId,
      documentId: data.documentId,
      createdById: data.createdById,
      createdByType: data.createdByType,
    },
  };
}

/**
 * Handle POST /internal/publish
 * Publishes a document by creating a checkpoint with the latest version.
 * Called by the DocumentSession DO after flushing CRDT state to Postgres.
 */
async function handleInternalPublish(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse('Invalid JSON in request body', 400);
  }

  const validation = validateInternalPublishBody(rawBody);
  if (!validation.valid) {
    return errorResponse(validation.error, 400);
  }

  const { data } = validation;

  try {
    const result = await publishDocument({
      siteId: data.siteId,
      branchId: data.branchId,
      documentId: data.documentId,
      createdById: data.createdById,
      createdByType: data.createdByType,
    });

    return jsonResponse(result);
  } catch (error) {
    console.error('Internal publish failed:', error);
    return errorResponse(
      `Publish failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
    );
  }
}

// =============================================================================
// Agent Checkpoint Handlers (Agent Politeness Protocol)
// =============================================================================

/** Validation result type for agent checkpoint start */
type AgentCheckpointStartValidation =
  | { valid: false; error: string }
  | { valid: true; data: AgentCheckpointStartBody };

/**
 * Validate agent checkpoint start request body
 */
function validateAgentCheckpointStartBody(body: unknown): AgentCheckpointStartValidation {
  if (body === null || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const data = body as Record<string, unknown>;

  if (typeof data.branchId !== 'string' || data.branchId.trim() === '') {
    return { valid: false, error: 'branchId is required and must be a non-empty string' };
  }

  if (typeof data.agentId !== 'string' || data.agentId.trim() === '') {
    return { valid: false, error: 'agentId is required and must be a non-empty string' };
  }

  if (typeof data.intent !== 'string' || data.intent.trim() === '') {
    return { valid: false, error: 'intent is required and must be a non-empty string' };
  }

  if (data.trigger !== 'human_requested' && data.trigger !== 'autonomous' && data.trigger !== 'manual') {
    return { valid: false, error: 'trigger must be "human_requested", "autonomous", or "manual"' };
  }

  return {
    valid: true,
    data: {
      branchId: data.branchId,
      agentId: data.agentId,
      intent: data.intent,
      trigger: data.trigger as CheckpointTrigger,
      targetRegions: Array.isArray(data.targetRegions) ? data.targetRegions as string[] : undefined,
      forceFullSnapshot: data.forceFullSnapshot === true,
    },
  };
}

/** Validation result type for agent checkpoint complete */
type AgentCheckpointCompleteValidation =
  | { valid: false; error: string }
  | { valid: true; data: AgentCheckpointCompleteBody };

/**
 * Validate agent checkpoint complete request body
 */
function validateAgentCheckpointCompleteBody(body: unknown): AgentCheckpointCompleteValidation {
  if (body === null || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const data = body as Record<string, unknown>;

  if (typeof data.branchId !== 'string' || data.branchId.trim() === '') {
    return { valid: false, error: 'branchId is required and must be a non-empty string' };
  }

  if (typeof data.agentId !== 'string' || data.agentId.trim() === '') {
    return { valid: false, error: 'agentId is required and must be a non-empty string' };
  }

  if (typeof data.intent !== 'string' || data.intent.trim() === '') {
    return { valid: false, error: 'intent is required and must be a non-empty string' };
  }

  if (typeof data.preEditCheckpointId !== 'string' || data.preEditCheckpointId.trim() === '') {
    return { valid: false, error: 'preEditCheckpointId is required and must be a non-empty string' };
  }

  return {
    valid: true,
    data: {
      branchId: data.branchId,
      agentId: data.agentId,
      intent: data.intent,
      preEditCheckpointId: data.preEditCheckpointId,
      trigger: typeof data.trigger === 'string' ? data.trigger as CheckpointTrigger : undefined,
      affectedRegions: Array.isArray(data.affectedRegions) ? data.affectedRegions as string[] : undefined,
    },
  };
}

/** Validation result type for agent checkpoint rollback */
type AgentCheckpointRollbackValidation =
  | { valid: false; error: string }
  | { valid: true; data: AgentCheckpointRollbackBody };

/**
 * Validate agent checkpoint rollback request body
 */
function validateAgentCheckpointRollbackBody(body: unknown): AgentCheckpointRollbackValidation {
  if (body === null || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const data = body as Record<string, unknown>;

  if (typeof data.checkpointId !== 'string' || data.checkpointId.trim() === '') {
    return { valid: false, error: 'checkpointId is required and must be a non-empty string' };
  }

  if (typeof data.agentId !== 'string' || data.agentId.trim() === '') {
    return { valid: false, error: 'agentId is required and must be a non-empty string' };
  }

  return {
    valid: true,
    data: {
      checkpointId: data.checkpointId,
      agentId: data.agentId,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
    },
  };
}

/**
 * Handle POST /internal/agent-checkpoint-start
 * Creates a checkpoint before an agent starts editing.
 * This checkpoint can be used for rollback if the agent edit is aborted.
 */
async function handleAgentCheckpointStart(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse('Invalid JSON in request body', 400);
  }

  const validation = validateAgentCheckpointStartBody(rawBody);
  if (!validation.valid) {
    return errorResponse(validation.error, 400);
  }

  const { data } = validation;

  try {
    const result = await createCheckpoint({
      branchId: data.branchId,
      checkpointType: 'agent_pre_edit',
      createdById: data.agentId,
      createdByType: 'agent',
      description: `Pre-edit checkpoint: ${data.intent}`,
      trigger: data.trigger,
      affectedRegions: data.targetRegions,
      forceFullSnapshot: data.forceFullSnapshot === true,
    });

    return jsonResponse({
      checkpointId: result.checkpoint.id,
      documentCount: result.documentCount,
    });
  } catch (error) {
    if (error instanceof BranchNotFoundError) {
      return errorResponse(`Branch not found: ${error.branchId}`, 404);
    }
    console.error('Error creating agent pre-edit checkpoint:', error);
    return errorResponse('Failed to create checkpoint', 500);
  }
}

/**
 * Handle POST /internal/agent-checkpoint-complete
 * Creates a checkpoint after an agent completes editing.
 * This checkpoint documents the changes made by the agent.
 */
async function handleAgentCheckpointComplete(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse('Invalid JSON in request body', 400);
  }

  const validation = validateAgentCheckpointCompleteBody(rawBody);
  if (!validation.valid) {
    return errorResponse(validation.error, 400);
  }

  const { data } = validation;

  try {
    const result = await createCheckpoint({
      branchId: data.branchId,
      checkpointType: 'agent_post_edit',
      createdById: data.agentId,
      createdByType: 'agent',
      description: `Post-edit checkpoint: ${data.intent}`,
      trigger: data.trigger ?? 'autonomous',
      affectedRegions: data.affectedRegions,
    });

    return jsonResponse({
      checkpointId: result.checkpoint.id,
      preEditCheckpointId: data.preEditCheckpointId,
      documentCount: result.documentCount,
    });
  } catch (error) {
    if (error instanceof BranchNotFoundError) {
      return errorResponse(`Branch not found: ${error.branchId}`, 404);
    }
    console.error('Error creating agent post-edit checkpoint:', error);
    return errorResponse('Failed to create checkpoint', 500);
  }
}

/**
 * Handle POST /internal/agent-checkpoint-rollback
 * Reverts to a pre-edit checkpoint when an agent edit is aborted.
 */
async function handleAgentCheckpointRollback(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse('Invalid JSON in request body', 400);
  }

  const validation = validateAgentCheckpointRollbackBody(rawBody);
  if (!validation.valid) {
    return errorResponse(validation.error, 400);
  }

  const { data } = validation;

  try {
    const result = await revertToCheckpoint({
      checkpointId: data.checkpointId,
      createdById: data.agentId,
      createdByType: 'agent',
      message: data.reason,
    });

    return jsonResponse({
      rolledBack: true,
      checkpointId: result.checkpoint.id,
      documentsReverted: result.documentsReverted,
    });
  } catch (error) {
    if (error instanceof CheckpointNotFoundError) {
      return errorResponse(`Checkpoint not found: ${error.checkpointId}`, 404);
    }
    console.error('Error rolling back to checkpoint:', error);
    return errorResponse('Failed to rollback to checkpoint', 500);
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

  // Publish endpoint (called by DO after flush)
  if (path === '/internal/publish') {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    return handleInternalPublish(request);
  }

  // Agent checkpoint endpoints (Agent Politeness Protocol)
  if (path === '/internal/agent-checkpoint-start') {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    return handleAgentCheckpointStart(request);
  }

  if (path === '/internal/agent-checkpoint-complete') {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    return handleAgentCheckpointComplete(request);
  }

  if (path === '/internal/agent-checkpoint-rollback') {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    return handleAgentCheckpointRollback(request);
  }

  return errorResponse('Not found', 404);
}
