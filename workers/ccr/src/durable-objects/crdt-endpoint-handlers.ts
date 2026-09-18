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
import type { ActivityDetector } from '../services/activity-detection-service';
import { MAX_OPERATIONS_PER_REQUEST } from '../constants/security-limits';
import type {
  EditSession,
  SessionOwner,
  SessionInfo,
  ApplyRequest,
  SnapshotResponse,
  ApplyResponse,
  SyncResponse,
  DocumentSessionEnv,
} from './document-session-types';
import { VALID_OPERATION_TYPES } from './document-session-types';
import { initializeFromSnapshot } from './crdt-operations';
import { validateActorId, validateOperation } from './session-validators';
import { errorResponse } from './websocket-utils';
import { stoppedTurnResponse, type StoppedTurns } from './stopped-turns';
import type { ActorIdentity, PostgresSyncManager } from './postgres-sync-manager';
import { isVersionAttribution } from '../services/version-attribution';
import {
  applyOperations,
  ApplyOperationsError,
  type ApplyOperationsResult,
  type SessionConflict,
} from './apply-operations';
import { internalApiConfig } from './internal-api-config';
import { getAllConnections } from './session-id-parser';

/** Attribution for a flush with no pending sync: the platform, not a person. */
const FLUSH_FALLBACK_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

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
  editSessions: Map<string, EditSession>;
  stoppedTurns: StoppedTurns;
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
  const actor: SessionOwner = {
    id: body.actorId,
    type: actorTypeHeader === 'agent' ? 'agent' : 'user',
  };

  const stopped = stoppedTurnResponse(deps.stoppedTurns, request);
  if (stopped !== null) return stopped;

  const ownSession = Array.from(deps.editSessions.values()).find(
    (session) => session.ownerId === actor.id && session.ownerType === actor.type,
  );

  // An agent always edits inside a session. A person does so whenever they hold
  // one, so the regions they reserved and the checkpoint they took cover the
  // edits they make. A person holding no session edits directly, which is how
  // the editor works.
  const editSessionId = (body as { editSessionId?: string }).editSessionId;
  if (
    (actor.type === 'agent' || ownSession !== undefined)
    && (editSessionId === undefined || editSessionId === '')
  ) {
    // Name the open session, so a caller that lost track of it can either apply
    // within it or end it rather than only learning that something is missing.
    return errorResponse(
      400,
      ownSession !== undefined
        ? `editSessionId is required; this actor holds edit session ${ownSession.id}`
        : 'editSessionId is required',
    );
  }

  if (editSessionId !== undefined && editSessionId !== '') {
    const session = deps.editSessions.get(editSessionId);
    if (!session) {
      return errorResponse(403, 'Invalid or expired edit session');
    }
    if (session.ownerId !== actor.id || session.ownerType !== actor.type) {
      return errorResponse(403, 'Edit session belongs to a different actor');
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
      snapshot: root.toJSON(),
      operationsApplied: 0,
    };
    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Validate operation types and required fields
  for (const op of body.operations) {
    if (!VALID_OPERATION_TYPES.includes(op.type)) {
      return errorResponse(400, `Invalid operation type: ${op.type}`);
    }

    // Validate operation has required fields
    const opError = validateOperation(op);
    if (opError !== null) {
      return errorResponse(400, opError);
    }
  }

  if (body.attribution !== undefined && !isVersionAttribution(body.attribution)) {
    return errorResponse(400, 'attribution must name an agent, who it acted for, and a description');
  }

  let result: ApplyOperationsResult;
  try {
    result = await applyOperations(deps, {
      actor,
      operations: body.operations,
      ...syncIdentityFromHeaders(request, body.actorId),
      ...(body.attribution !== undefined ? { attribution: body.attribution } : {}),
    });
  } catch (error) {
    if (error instanceof ApplyOperationsError) {
      return errorResponse(error.status, error.message);
    }
    throw error;
  }

  const response: ApplyResponse & { sessionConflicts?: SessionConflict[] } = {
    success: true,
    snapshot: result.snapshot,
    operationsApplied: body.operations.length,
    ...(result.sessionConflicts.length > 0 ? { sessionConflicts: result.sessionConflicts } : {}),
  };
  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * The identity the version is written under. Attribution uses the resolved
 * dbUserId (app.users.id) when present; the body actorId (the OAuth subject,
 * cross-checked against the verified id) is the fallback for agents and
 * unresolved principals.
 */
function syncIdentityFromHeaders(
  request: Request,
  actorId: string,
): { syncActorId: string; identity: ActorIdentity } {
  const verifiedEmail = request.headers.get('X-Verified-Email') ?? undefined;
  const verifiedName = request.headers.get('X-Verified-Name') ?? undefined;
  const verifiedDbUserId = request.headers.get('X-Verified-Db-User-Id') ?? undefined;
  return {
    syncActorId: verifiedDbUserId ?? actorId,
    identity: {
      ...(verifiedEmail !== undefined ? { actorEmail: verifiedEmail } : {}),
      ...(verifiedName !== undefined ? { actorName: verifiedName } : {}),
    },
  };
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
    snapshot: root.toJSON(),
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

  // Without sync config the CRDT state still belongs in DO storage.
  if (internalApiConfig(deps.env) === undefined) {
    await deps.flushPendingPersist();
    return new Response(
      JSON.stringify({ flushed: false, reason: 'no_sync_config' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const versionId = await deps.syncManager.flushAndSync(deps.flushPendingPersist, {
      actorId: FLUSH_FALLBACK_ACTOR_ID,
      actorType: 'user',
    });
    return new Response(
      JSON.stringify({ flushed: true, ...(versionId !== undefined ? { versionId } : {}) }),
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
  try {
    await deps.syncManager.initializeFromPostgres();
    // A reload is the recovery path for a session that failed to load, so a
    // successful one restores its ability to write.
    deps.syncManager.contentLoadFailed = false;
  } catch (error) {
    // The live Y.Doc has already been replaced with the empty one above, so a
    // failed load leaves state that must never reach Postgres.
    deps.syncManager.contentLoadFailed = true;
    throw error;
  }
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
