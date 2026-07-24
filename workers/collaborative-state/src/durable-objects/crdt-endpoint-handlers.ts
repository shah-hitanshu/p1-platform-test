/**
 * CRDT endpoint handlers.
 * Extracted from document-session.ts for maintainability.
 *
 * Contains handlers for: /snapshot, /apply, /sync, /flush, /initialize,
 * /reload, and pull-based branch invalidation. Each handler is a standalone
 * exported function that receives a CrdtEndpointDeps object.
 *
 * IMPORTANT: Y.Doc is accessed via getYdoc() getter because reloadFromPostgres()
 * replaces the Y.Doc instance. Capturing a direct reference would go stale.
 */

import * as Y from 'yjs';
import { regionsOverlap } from '../services/presence-service';
import type { ActivityDetector } from '../services/activity-detection-service';
import {
  MAX_OPERATIONS_PER_REQUEST,
  MAX_CONFLICT_REGIONS_TO_REPORT,
  MAX_CONFLICT_REASON_LENGTH,
} from '../constants/security-limits';
import type {
  AgentEditSession,
  SessionInfo,
  ApplyRequest,
  SnapshotResponse,
  ApplyResponse,
  SyncResponse,
  DocumentSessionEnv,
} from './document-session-types';
import { VALID_OPERATION_TYPES } from './document-session-types';
import { applyOperation, initializeFromSnapshot } from './crdt-operations';
import { validateActorId, validateOperation } from './session-validators';
import { errorResponse } from './websocket-utils';
import { SYNC_SCHEDULE_KEY } from './postgres-sync-manager';
import type { PostgresSyncManager, SyncSchedule } from './postgres-sync-manager';
import { getAllConnections } from './session-id-parser';

// =============================================================================
// Dependencies interface
// =============================================================================

export interface CrdtEndpointDeps {
  /** Getter for Y.Doc — MUST be a getter, not a captured ref (doc gets replaced on reload) */
  getYdoc: () => Y.Doc;
  /** Replace the Y.Doc instance (used by reloadFromPostgres) */
  setYdoc: (doc: Y.Doc) => void;
  /** Whether CRDT state has been loaded */
  getInitialized: () => boolean;
  /** Set the initialized flag */
  setInitialized: (value: boolean) => void;
  env: DocumentSessionEnv;
  storage: DurableObjectStorage;
  sessionInfo: SessionInfo;
  editSessions: Map<string, AgentEditSession>;
  activityDetector: ActivityDetector;
  syncManager: PostgresSyncManager;
  getWebSockets: () => WebSocket[];
  persist: () => Promise<void>;
  flushPendingPersist: () => Promise<void>;
  broadcastUpdate: (update: Uint8Array, sender?: WebSocket) => void;
  scheduleCleanupAlarm: () => Promise<void>;
  /** Pull-based invalidation: last-seen branch version timestamp */
  getLastSeenBranchVersion: () => number;
  setLastSeenBranchVersion: (value: number) => void;
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Handle /snapshot endpoint.
 * Returns current document state and connected actors.
 */
export function handleSnapshot(deps: CrdtEndpointDeps): Response {
  const ydoc = deps.getYdoc();
  const root = ydoc.getMap('root');
  const snapshot = root.toJSON() as Record<string, unknown>;
  const stateVector = Array.from(Y.encodeStateVector(ydoc));
  const connectedActors = getAllConnections(deps.getWebSockets).map(([, m]) => m);

  const response: SnapshotResponse = {
    snapshot,
    stateVector,
    connectedActors,
  };

  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Handle /apply endpoint.
 * Applies edit operations programmatically (for agents or API clients).
 */
export async function handleApplyOperations(
  deps: CrdtEndpointDeps,
  request: Request,
): Promise<Response> {
  // Parse request body
  let body: ApplyRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body');
  }

  // Validate actorId
  if (!body.actorId) {
    return errorResponse(400, 'actorId is required');
  }

  // Auth Phase 4: Cross-check body actorId against verified header
  const verifiedActorId = request.headers.get('X-Verified-Actor-Id');
  if (verifiedActorId !== null && verifiedActorId !== '' && body.actorId !== verifiedActorId) {
    return errorResponse(403, 'Actor ID in request body does not match verified identity');
  }

  // Security: Validate actorId format
  const actorIdError = validateActorId(body.actorId);
  if (actorIdError !== null) {
    return errorResponse(400, actorIdError);
  }

  // Determine actorType from verified header or client header (default to 'user')
  const actorTypeHeader = request.headers.get('X-Verified-Actor-Type')
    ?? request.headers.get('X-Actor-Type');
  const isAgent = actorTypeHeader === 'agent';

  // Agents must provide a valid editSessionId
  if (isAgent) {
    const editSessionId = (body as { editSessionId?: string }).editSessionId;
    if (editSessionId === undefined || editSessionId === '') {
      return errorResponse(400, 'editSessionId is required for agents');
    }

    // Validate the session exists and belongs to this agent
    const session = deps.editSessions.get(editSessionId);
    if (!session) {
      return errorResponse(403, 'Invalid or expired edit session');
    }

    if (session.agentId !== body.actorId) {
      return errorResponse(403, 'Edit session belongs to a different agent');
    }
  }

  // Validate operations array
  if (!Array.isArray(body.operations)) {
    return errorResponse(400, 'operations must be an array');
  }

  // Security: Limit operations per request
  if (body.operations.length > MAX_OPERATIONS_PER_REQUEST) {
    return errorResponse(400, `Too many operations. Maximum is ${String(MAX_OPERATIONS_PER_REQUEST)}`);
  }

  // Handle empty operations array
  const ydoc = deps.getYdoc();
  if (body.operations.length === 0) {
    const root = ydoc.getMap('root');
    const response: ApplyResponse = {
      success: true,
      snapshot: root.toJSON() as Record<string, unknown>,
      operationsApplied: 0,
    };
    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Validate operation types and required fields
  for (const op of body.operations) {
    if (!VALID_OPERATION_TYPES.includes(op.type as typeof VALID_OPERATION_TYPES[number])) {
      return errorResponse(400, `Invalid operation type: ${op.type}`);
    }

    // Validate operation has required fields
    const opError = validateOperation(op);
    if (opError !== null) {
      return errorResponse(400, opError);
    }
  }

  // Apply operations within a transaction
  try {
    const root = ydoc.getMap('root');
    ydoc.transact(() => {
      for (const op of body.operations) {
        applyOperation(root, op);
      }
    }, body.actorId);
  } catch (error) {
    return errorResponse(400, `Failed to apply operations: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Persist state
  try {
    await deps.persist();
  } catch {
    return errorResponse(500, 'Failed to persist state');
  }

  // Broadcast update to connected clients
  const update = Y.encodeStateAsUpdate(ydoc);
  deps.broadcastUpdate(update);

  // Use actorType from earlier header check
  const actorType = actorTypeHeader ?? 'user';

  // Extract regions (paths) from operations
  const regions = body.operations
    .map((op) => op.path)
    .filter((path): path is string => typeof path === 'string');

  // Track agent conflicts for response
  const agentConflicts: { agentId: string; regions: string[]; sessionId: string }[] = [];

  // Record human activity for the activity detector (if actor is a user)
  if (actorType === 'user') {
    // Schedule cleanup alarm for HTTP-only clients (idempotent if already scheduled)
    void deps.scheduleCleanupAlarm();
    deps.activityDetector.recordHumanActivity(body.actorId, regions);

    // Check for conflicts with active agent edit sessions
    // Optimized: early termination once conflict found, limited region collection
    for (const session of deps.editSessions.values()) {
      const overlappingRegions: string[] = [];
      let conflictFound = false;

      // Use labeled loops for early termination
      regionCheck:
      for (const humanRegion of regions) {
        for (const agentRegion of session.targetRegions) {
          if (regionsOverlap(humanRegion, agentRegion)) {
            overlappingRegions.push(agentRegion);
            conflictFound = true;
            // Limit collected regions to prevent memory issues
            if (overlappingRegions.length >= MAX_CONFLICT_REGIONS_TO_REPORT) {
              break regionCheck;
            }
          }
        }
      }

      if (conflictFound) {
        // Mark session as conflicted
        session.conflicted = true;
        // Build reason with truncation for security
        let reason = `Human activity in overlapping regions: ${overlappingRegions.join(', ')}`;
        if (reason.length > MAX_CONFLICT_REASON_LENGTH) {
          reason = reason.substring(0, MAX_CONFLICT_REASON_LENGTH - 3) + '...';
        }
        session.conflictReason = reason;
        agentConflicts.push({
          agentId: session.agentId,
          regions: overlappingRegions,
          sessionId: session.id,
        });
      }
    }
  }

  // Schedule sync to PostgreSQL after idle timeout. PCC-3457: carry the
  // verified identity (worker-set headers — inbound forgeries are stripped at
  // the route boundary) so unprovisioned OAuth principals editing over HTTP
  // JIT-provision at sync time like websocket editors do.
  const verifiedEmail = request.headers.get('X-Verified-Email') ?? undefined;
  const verifiedName = request.headers.get('X-Verified-Name') ?? undefined;
  // Attribution uses the resolved dbUserId (app.users.id) when present; body
  // actorId (the OAuth subject, cross-checked against the verified id above)
  // is the fallback for agents and unresolved principals.
  const verifiedDbUserId = request.headers.get('X-Verified-Db-User-Id') ?? undefined;
  await deps.syncManager.scheduleSync(verifiedDbUserId ?? body.actorId, actorType as 'user' | 'agent', {
    ...(verifiedEmail !== undefined ? { actorEmail: verifiedEmail } : {}),
    ...(verifiedName !== undefined ? { actorName: verifiedName } : {}),
  });

  const root = ydoc.getMap('root');
  const response: ApplyResponse & { agentConflicts?: typeof agentConflicts } = {
    success: true,
    snapshot: root.toJSON() as Record<string, unknown>,
    operationsApplied: body.operations.length,
  };

  // Include agent conflicts in response if any were detected
  if (agentConflicts.length > 0) {
    response.agentConflicts = agentConflicts;
  }

  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Handle /sync endpoint.
 * Manually trigger sync to PostgreSQL (via internal API).
 */
export async function handleSync(
  deps: CrdtEndpointDeps,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method not allowed. Use POST.');
  }

  // Persist to DO storage first
  try {
    await deps.persist();
  } catch (error) {
    return errorResponse(500, `Failed to persist state: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Sync to PostgreSQL via internal API
  await deps.syncManager.syncToPostgres();

  const ydoc = deps.getYdoc();
  const root = ydoc.getMap('root');
  const response: SyncResponse = {
    synced: true,
    snapshot: root.toJSON() as Record<string, unknown>,
    stateVector: Array.from(Y.encodeStateVector(ydoc)),
  };

  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Handle /flush endpoint.
 * Synchronously flush CRDT state to PostgreSQL, bypassing the async queue.
 * Used before publish operations to ensure the latest version is in Postgres.
 */
export async function handleFlush(
  deps: CrdtEndpointDeps,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method not allowed. Use POST.');
  }

  // Persist to DO storage first
  await deps.flushPendingPersist();

  // Check if sync infrastructure is configured
  const internalApiUrl = deps.env.INTERNAL_API_URL;
  const internalSecret = deps.env.INTERNAL_SECRET;
  if (internalApiUrl === undefined || internalSecret === undefined) {
    return new Response(
      JSON.stringify({ flushed: false, reason: 'no_sync_config' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Get actor info from sync schedule (or default)
  let actorId = '00000000-0000-0000-0000-000000000001';
  let actorType: 'user' | 'agent' = 'user';
  let actorEmail: string | undefined;
  let actorName: string | undefined;
  const schedule = await deps.storage.get<SyncSchedule>(SYNC_SCHEDULE_KEY);
  if (schedule !== undefined) {
    actorId = schedule.actorId;
    actorType = schedule.actorType;
    actorEmail = schedule.actorEmail;
    actorName = schedule.actorName;
  }

  // Perform synchronous direct sync (bypasses queue)
  try {
    await deps.syncManager.performDirectSync(internalApiUrl, internalSecret, actorId, actorType, {
      actorEmail,
      actorName,
    });
    return new Response(
      JSON.stringify({ flushed: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Flush failed:', error);
    return errorResponse(500, `Flush failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handle /initialize endpoint.
 * Initialize CRDT state from PostgreSQL snapshot or CRDT state.
 */
export async function handleInitialize(
  deps: CrdtEndpointDeps,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method not allowed. Use POST.');
  }

  // Parse request body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body');
  }

  // Validate body structure
  if (typeof rawBody !== 'object' || rawBody === null) {
    return errorResponse(400, 'Request body must be an object');
  }

  const body = rawBody as Record<string, unknown>;

  // Validate snapshot is present
  if (body.snapshot === null || body.snapshot === undefined || typeof body.snapshot !== 'object') {
    return errorResponse(400, 'snapshot is required and must be an object');
  }

  const snapshot = body.snapshot as Record<string, unknown>;

  try {
    const ydoc = deps.getYdoc();
    // Initialize from JSON snapshot
    initializeFromSnapshot(ydoc, snapshot);

    // Persist the initialized state
    await deps.persist();

    const root = ydoc.getMap('root');
    return new Response(
      JSON.stringify({
        success: true,
        snapshot: root.toJSON(),
        stateVector: Array.from(Y.encodeStateVector(ydoc)),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return errorResponse(500, `Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Reload Y.Doc from PostgreSQL and broadcast diff to WebSocket clients.
 *
 * IMPORTANT: This replaces the Y.Doc instance via setYdoc(). All code that
 * accesses the Y.Doc after this call must use getYdoc(), not a captured ref.
 *
 * @returns The reloaded snapshot as a plain object
 */
/**
 * Reload Y.Doc from PostgreSQL and notify WebSocket clients.
 *
 * IMPORTANT: This replaces the Y.Doc instance via setYdoc(). All code that
 * accesses the Y.Doc after this call must use getYdoc(), not a captured ref.
 *
 * @param forceDisconnect - When true, close all WebSocket connections so
 *   clients must reconnect with fresh state. Used for migration reloads
 *   where the Puck data model changed structurally. When false (default),
 *   broadcast the CRDT diff — sufficient for routine merge invalidation
 *   where the client can apply the update incrementally.
 * @returns The reloaded snapshot as a plain object
 */
export async function reloadFromPostgres(
  deps: CrdtEndpointDeps,
  forceDisconnect = false,
): Promise<Record<string, unknown>> {
  // Capture the old state vector before reload
  const oldStateVector = Y.encodeStateVector(deps.getYdoc());

  // Create a fresh Y.Doc and reload from PostgreSQL
  const newDoc = new Y.Doc();
  deps.setYdoc(newDoc);
  deps.setInitialized(false);
  await deps.syncManager.initializeFromPostgres();
  deps.setInitialized(true);

  // Compute the diff from old state to new state
  // Use getYdoc() — it's the same as newDoc but keeps the pattern consistent
  const currentDoc = deps.getYdoc();
  const diff = Y.encodeStateAsUpdate(currentDoc, oldStateVector);

  // Persist the reloaded state before touching WebSocket clients
  await deps.persist();
  deps.syncManager.lastSyncedStateVectorHash = deps.syncManager.computeStateVectorHash();

  // Cancel any pending sync schedule — the reloaded state matches Postgres,
  // so a stale scheduled sync would overwrite the migration with old data.
  await deps.storage.delete('syncSchedule');
  deps.syncManager.pendingPuckActions = [];

  if (forceDisconnect) {
    // Disconnect all WebSocket clients so they reconnect with fresh state.
    // Used for migration reloads where the Puck data model changed
    // structurally — broadcasting a diff doesn't work reliably because the
    // client's Puck data state is stale and its onChange fires with old data
    // before the diff is applied, overwriting the migration.
    const sockets = deps.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.close(4001, 'Document state reloaded — please reconnect');
      } catch {
        // Socket may already be closed
      }
    }
  } else {
    // Broadcast the CRDT diff to connected clients. Sufficient for routine
    // merge invalidation where the document structure hasn't changed.
    deps.broadcastUpdate(diff);
  }

  const root = currentDoc.getMap('root');
  return root.toJSON();
}

/**
 * Handle /reload endpoint.
 * Reloads Y.Doc from PostgreSQL and broadcasts diff.
 */
export async function handleReload(
  deps: CrdtEndpointDeps,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method not allowed. Use POST.');
  }

  try {
    // /reload is called by migration DO reloader — force-disconnect so
    // clients reconnect with the structurally updated document.
    const snapshot = await reloadFromPostgres(deps, true);
    return new Response(
      JSON.stringify({
        success: true,
        snapshot,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return errorResponse(500, `Failed to reload: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Pull-based invalidation check.
 *
 * Reads the branch version timestamp from CONFIG_KV and compares
 * it to the last-seen value. If the KV value is newer, the DO
 * reloads its Y.Doc from PostgreSQL and broadcasts the diff.
 *
 * Errors are swallowed — KV unavailability should never break
 * normal DO operation.
 */
export async function checkBranchInvalidation(deps: CrdtEndpointDeps): Promise<void> {
  const kv = deps.env.CONFIG_KV;
  if (kv === undefined) {
    return;
  }

  try {
    const branchId = deps.sessionInfo.branchId;
    if (branchId === '') {
      return;
    }

    const value = await kv.get(`branch-version:${branchId}`);
    if (value === null) {
      return;
    }

    const kvTimestamp = Number(value);
    const lastSeen = deps.getLastSeenBranchVersion();
    if (Number.isNaN(kvTimestamp) || kvTimestamp <= lastSeen) {
      console.log(
        `Branch invalidation: KV timestamp ${String(kvTimestamp)} <= lastSeen ${String(lastSeen)}, skipping reload`,
      );
      return;
    }

    // KV has a newer timestamp — reload from PostgreSQL
    console.log(
      `Branch invalidation: KV timestamp ${String(kvTimestamp)}` +
        ` > lastSeen ${String(lastSeen)}, reloading from Postgres`,
    );
    deps.setLastSeenBranchVersion(kvTimestamp);

    if (deps.getInitialized()) {
      await reloadFromPostgres(deps);
    }
  } catch (error) {
    console.warn('Branch invalidation check failed:', error);
  }
}
