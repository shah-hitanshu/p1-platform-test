/**
 * WebSocket presence protocol handlers and HTTP presence endpoints.
 * Extracted from document-session.ts for maintainability.
 *
 * Each handler is a standalone exported function that receives a
 * PresenceProtocolDeps object with all required dependencies, avoiding
 * circular imports back to document-session.ts.
 */

import type { ConnectionMeta, ActorPresence } from '../types';
import type { PresenceManager } from '../services/presence-service';
import type {
  ActivityDetector,
  ActivityDetectorState,
} from '../services/activity-detection-service';
import {
  MAX_FOCUS_REGIONS_PER_REQUEST,
} from '../constants/security-limits';
import type {
  EditSession,
  SessionInfo,
  DocumentSessionEnv,
} from './document-session-types';
import { SYNC_SCHEDULE_KEY } from './postgres-sync-manager';
import type {
  WsFocusRegionUpdateMessage,
  WsPresenceHeartbeatMessage,
  WsPublishRequestMessage,
  WsPresenceUpdateMessage,
  WsFocusRegionBroadcastMessage,
  WsFocusRegionAckMessage,
} from '../types/websocket-messages';
import {
  isWsFocusRegionUpdate,
  isWsPresenceHeartbeat,
  isWsDeliveryAckRequest,
} from '../types/websocket-messages';
import {
  sendWsMessage,
  broadcastToOthers,
  sendPresenceError,
  jsonResponse,
} from './websocket-utils';

// =============================================================================
// Dependencies interface
// =============================================================================

export interface PresenceProtocolDeps {
  env: DocumentSessionEnv;
  sessionInfo: SessionInfo;
  presenceManager: PresenceManager;
  activityDetector: ActivityDetector;
  editSessions: Map<string, EditSession>;
  getWebSockets: () => WebSocket[];
  getAllConnections: () => [WebSocket, ConnectionMeta][];
  syncManager: {
    performDirectSync: (
      internalApiUrl: string,
      internalSecret: string,
      actorId: string,
      actorType: 'user' | 'agent',
    ) => Promise<void>;
  };
  storage: DurableObjectStorage;
  flushPendingPersist: () => Promise<void>;
  markPresencePersistPending: () => Promise<void>;
  pushPresenceUpdate: (
    type: 'join' | 'leave' | 'focus' | 'state',
    actorId: string,
    extra?: { actor?: ActorPresence; focusRegions?: string[]; state?: string },
  ) => void;
  scheduleCleanupAlarm: () => Promise<void>;
}

// =============================================================================
// WebSocket presence message handlers
// =============================================================================

/**
 * Handle a text (JSON) presence message from a WebSocket client.
 *
 * @param deps - Dependencies
 * @param sender - The WebSocket that sent the message
 * @param meta - Connection metadata (actorId, actorType)
 * @param data - The raw JSON string
 */
export function handlePresenceMessage(
  deps: PresenceProtocolDeps,
  sender: WebSocket,
  meta: ConnectionMeta,
  data: string,
): void {
  // Parse JSON message
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    sendPresenceError(sender, 'PARSE_ERROR', 'Invalid JSON format');
    return;
  }

  // Route based on message type
  if (isWsFocusRegionUpdate(message)) {
    handleWsFocusRegionUpdate(deps, sender, meta, message);
  } else if (isWsPresenceHeartbeat(message)) {
    handleWsPresenceHeartbeat(deps, sender, meta, message);
  } else if (isWsDeliveryAckRequest(message)) {
    // Acknowledge that all preceding WebSocket messages have been processed.
    // Since WebSocket messages are TCP-ordered, by the time we process this
    // text message, all preceding binary (Yjs) updates have already been
    // applied to the Y.Doc.
    sendWsMessage(sender, {
      type: 'delivery_ack',
      requestId: message.requestId,
      timestamp: Date.now(),
    });
  } else {
    sendPresenceError(sender, 'UNKNOWN_TYPE', 'Unknown message type');
  }
}

/**
 * Try to parse a JSON string, returning null on failure.
 */
export function tryParseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Handle a publish_request message from a WebSocket client.
 *
 * TCP ordering guarantees all preceding binary CRDT updates have been
 * applied to the Y.Doc by the time this message is processed. The handler:
 * 1. Flushes the Y.Doc to Postgres (synchronous direct sync)
 * 2. Calls POST /internal/publish to create the checkpoint
 * 3. Sends the result back via WebSocket
 */
export async function handleWsPublishRequest(
  deps: PresenceProtocolDeps,
  sender: WebSocket,
  meta: ConnectionMeta,
  message: WsPublishRequestMessage,
): Promise<void> {
  const { requestId } = message;
  const { siteId, documentId, branchId } = deps.sessionInfo;

  // Validate session info is available
  if (siteId === 'unknown' || documentId === 'unknown' || branchId === 'unknown') {
    sendWsMessage(sender, {
      type: 'publish_result',
      requestId,
      success: false,
      error: 'Cannot publish: session info not available',
      timestamp: Date.now(),
    });
    return;
  }

  const internalApiUrl = deps.env.INTERNAL_API_URL;
  const internalSecret = deps.env.INTERNAL_SECRET;

  if (internalApiUrl === undefined || internalSecret === undefined) {
    sendWsMessage(sender, {
      type: 'publish_result',
      requestId,
      success: false,
      error: 'Cannot publish: sync infrastructure not configured',
      timestamp: Date.now(),
    });
    return;
  }

  try {
    // Step 1: Flush CRDT state to Postgres. Attribution uses the resolved
    // dbUserId (app.users.id) when present, falling back to actorId (the OAuth
    // subject) for agents and unresolved principals.
    let actorId = meta.dbUserId ?? meta.actorId;
    let actorType: 'user' | 'agent' = meta.actorType;
    const schedule = await deps.storage.get<{ dueAt: number; actorId: string; actorType: 'user' | 'agent' }>(SYNC_SCHEDULE_KEY);
    if (schedule !== undefined) {
      actorId = schedule.actorId;
      actorType = schedule.actorType;
    }

    await deps.flushPendingPersist();
    await deps.syncManager.performDirectSync(internalApiUrl, internalSecret, actorId, actorType);

    // Step 2: Call internal publish endpoint
    const publishUrl = `${internalApiUrl}/internal/publish`;
    const publishResponse = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify({
        siteId,
        branchId,
        documentId,
        createdById: meta.dbUserId ?? meta.actorId,
        createdByType: meta.actorType,
      }),
    });

    if (!publishResponse.ok) {
      const errorBody = await publishResponse.text();
      sendWsMessage(sender, {
        type: 'publish_result',
        requestId,
        success: false,
        error: `Publish failed: ${errorBody}`,
        timestamp: Date.now(),
      });
      return;
    }

    const result: {
      checkpoint: import('../types').Checkpoint;
      publishedVersionId: string;
      sourceBranchName?: string;
    } = await publishResponse.json();

    // Step 3: Reload the main branch DO if we published cross-branch.
    // Publishing from a non-main branch copies the version to main in Postgres,
    // but the main branch DO still has stale CRDT state. Calling /reload makes
    // it re-initialize from Postgres and broadcast the diff to connected clients.
    if (
      result.checkpoint.branchId !== branchId &&
      deps.env.DOCUMENT_STATE !== undefined
    ) {
      const mainSessionId = `${siteId}:${documentId}:${result.checkpoint.branchId}`;
      try {
        const mainDoId = deps.env.DOCUMENT_STATE.idFromName(mainSessionId);
        const mainStub = deps.env.DOCUMENT_STATE.get(mainDoId);
        await mainStub.fetch(new Request('http://internal/reload', {
          method: 'POST',
        }));
      } catch (reloadError) {
        console.warn('Failed to reload main branch DO after publish:', reloadError);
      }
    }

    // Step 4: Send success result back to client
    sendWsMessage(sender, {
      type: 'publish_result',
      requestId,
      success: true,
      publishedVersionId: result.publishedVersionId,
      checkpoint: result.checkpoint,
      timestamp: Date.now(),
    });
  } catch (error) {
    sendWsMessage(sender, {
      type: 'publish_result',
      requestId,
      success: false,
      error: `Publish failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      timestamp: Date.now(),
    });
  }
}

/**
 * Handle a focus_region_update message from a WebSocket client.
 *
 * @param deps - Dependencies
 * @param sender - The WebSocket that sent the message
 * @param meta - Connection metadata
 * @param message - The parsed focus_region_update message
 */
export function handleWsFocusRegionUpdate(
  deps: PresenceProtocolDeps,
  sender: WebSocket,
  meta: ConnectionMeta,
  message: WsFocusRegionUpdateMessage,
): void {
  console.log('[DocumentSession] handleWsFocusRegionUpdate called from actor:', meta.actorId, 'focusRegions:', message.focusRegions);
  const { focusRegions } = message;

  // Validate focus regions
  if (!Array.isArray(focusRegions)) {
    sendPresenceError(sender, 'INVALID_REGIONS', 'focusRegions must be an array');
    return;
  }

  // Check region count limit
  if (focusRegions.length > MAX_FOCUS_REGIONS_PER_REQUEST) {
    sendPresenceError(
      sender,
      'TOO_MANY_REGIONS',
      `Maximum ${String(MAX_FOCUS_REGIONS_PER_REQUEST)} focus regions allowed`,
    );
    return;
  }

  // Validate each region is a string
  const validRegions: string[] = [];
  for (const region of focusRegions) {
    if (typeof region === 'string') {
      validRegions.push(region);
    }
  }

  // Update activity detector with focus regions (for agent politeness)
  deps.activityDetector.recordFocusActivity(meta.actorId, validRegions);

  // Update presence manager with focus regions
  const existing = deps.presenceManager.getByActorId(meta.actorId);
  if (existing) {
    deps.presenceManager.updateFocusRegions(existing.id, validRegions);
  } else {
    // Register new presence entry for this actor
    deps.presenceManager.register({
      actorId: meta.actorId,
      actorType: meta.actorType,
      name: meta.name ?? meta.email ?? meta.actorId,
      avatar: meta.avatar,
      state: 'active',
      focusRegions: validRegions,
    });
  }

  // Send acknowledgment to sender
  const ack: WsFocusRegionAckMessage = {
    type: 'focus_region_ack',
    success: true,
    focusRegions: validRegions,
    timestamp: Date.now(),
  };
  sendWsMessage(sender, ack);

  // Broadcast focus region change to other clients
  const broadcast: WsFocusRegionBroadcastMessage = {
    type: 'focus_region_broadcast',
    actorId: meta.actorId,
    focusRegions: validRegions,
    timestamp: Date.now(),
  };
  broadcastToOthers(sender, deps.getWebSockets, broadcast);

  // Phase 3.1: Schedule debounced presence persistence on focus update
  void deps.markPresencePersistPending();

  // Phase 3.2: Push focus change to PresenceManager DO
  deps.pushPresenceUpdate('focus', meta.actorId, { focusRegions: validRegions });
}

/**
 * Handle a presence_heartbeat message from a WebSocket client.
 *
 * @param deps - Dependencies
 * @param _sender - The WebSocket that sent the message (unused)
 * @param meta - Connection metadata
 * @param message - The parsed presence_heartbeat message
 */
export function handleWsPresenceHeartbeat(
  deps: PresenceProtocolDeps,
  _sender: WebSocket,
  meta: ConnectionMeta,
  message: WsPresenceHeartbeatMessage,
): void {
  // Update activity detector (keeps actor from going stale)
  const existing = deps.presenceManager.getByActorId(meta.actorId);
  const currentFocusRegions = existing?.focusRegions ?? [];
  deps.activityDetector.recordFocusActivity(meta.actorId, currentFocusRegions);

  // Update presence state if provided
  if (message.state && existing) {
    deps.presenceManager.updateState(existing.id, message.state);
  }
}

/**
 * Broadcast a presence_update message to all connected clients.
 * Called when actors connect or disconnect.
 */
export function broadcastPresenceUpdate(deps: PresenceProtocolDeps): void {
  const actors = getPresenceList(deps);
  const message: WsPresenceUpdateMessage = {
    type: 'presence_update',
    actors,
    timestamp: Date.now(),
  };

  const json = JSON.stringify(message);
  for (const conn of deps.getWebSockets()) {
    if (conn.readyState === WebSocket.OPEN) {
      conn.send(json);
    }
  }
}

/**
 * Get the current presence list (merges presenceManager with WebSocket connections).
 */
export function getPresenceList(deps: PresenceProtocolDeps): ActorPresence[] {
  // Get presences from presenceManager (agents in edit sessions)
  const managerPresences: ActorPresence[] = deps.presenceManager.getAll();

  // Create a set of actorIds already in presenceManager to avoid duplicates
  const existingActorIds = new Set(managerPresences.map((p) => p.actorId));

  // Convert WebSocket connections to presence entries (if not already tracked)
  const now = new Date().toISOString();
  const connectionPresences: ActorPresence[] = [];

  for (const [, meta] of deps.getAllConnections()) {
    // Skip if already tracked in presenceManager
    if (existingActorIds.has(meta.actorId)) {
      continue;
    }

    // Create presence entry from connection metadata
    connectionPresences.push({
      id: `ws-${meta.actorId}`,
      actorId: meta.actorId,
      actorType: meta.actorType,
      role: meta.actorType === 'agent' ? 'agent' : 'human',
      name: meta.name ?? meta.email ?? meta.actorId,
      avatar: meta.avatar,
      state: 'active',
      lastActivityAt: now,
      joinedAt: now,
    });

    // Track to avoid duplicates from multiple connections by same actor
    existingActorIds.add(meta.actorId);
  }

  // Merge both sources
  return [...managerPresences, ...connectionPresences];
}

// =============================================================================
// HTTP presence endpoint handlers
// =============================================================================

/**
 * Handle GET /presences - Return all presences in the document
 *
 * Merges presence data from two sources:
 * 1. presenceManager - agents in active edit sessions with focus regions
 * 2. connections - users/agents connected via WebSocket
 *
 * This ensures both WebSocket-connected users and agents are visible
 * in the presence system.
 */
export function handleGetPresences(deps: PresenceProtocolDeps): Response {
  const presences = getPresenceList(deps);
  return jsonResponse(200, { presences });
}

/**
 * Handle POST /update-focus-regions - Record human component selection
 *
 * This allows humans to proactively report their focus before making edits,
 * preventing race conditions where agents might edit the same region.
 */
export async function handleUpdateFocusRegions(
  deps: PresenceProtocolDeps,
  request: Request,
): Promise<Response> {
  // Require POST method
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed. Use POST.' });
  }

  // Require user actor type (agents should use /agent-edit-start)
  const actorType = request.headers.get('X-Actor-Type');
  if (actorType !== 'user') {
    return jsonResponse(403, {
      error: 'Only users can update focus regions. Agents should use /agent-edit-start.',
    });
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  if (typeof body !== 'object' || body === null) {
    return jsonResponse(400, { error: 'Request body must be an object' });
  }

  const bodyObj = body as Record<string, unknown>;

  // Validate actorId
  if (typeof bodyObj.actorId !== 'string' || bodyObj.actorId === '') {
    return jsonResponse(400, { error: 'Missing or invalid required field: actorId' });
  }

  // Validate focusRegions
  if (!Array.isArray(bodyObj.focusRegions)) {
    return jsonResponse(400, { error: 'Missing or invalid required field: focusRegions' });
  }

  const actorId = bodyObj.actorId;
  const focusRegions = bodyObj.focusRegions as unknown[];

  // Validate each region is a string
  for (const region of focusRegions) {
    if (typeof region !== 'string') {
      return jsonResponse(400, { error: 'Each focusRegion must be a string' });
    }
  }

  const validRegions = focusRegions as string[];

  // Enforce maximum limit (uses centralized constant)
  if (validRegions.length > MAX_FOCUS_REGIONS_PER_REQUEST) {
    return jsonResponse(400, {
      error: `focusRegions cannot exceed ${String(MAX_FOCUS_REGIONS_PER_REQUEST)} entries`,
    });
  }

  // Schedule cleanup alarm for HTTP-only clients (idempotent if already scheduled)
  void deps.scheduleCleanupAlarm();

  // Record focus activity in ActivityDetector
  if (validRegions.length === 0) {
    // Empty array means clear focus
    deps.activityDetector.clearActorFocus(actorId);
  } else {
    // Record the focus regions
    deps.activityDetector.recordFocusActivity(actorId, validRegions);
  }

  // Also update presence if user is registered
  const presence = deps.presenceManager.getByActorId(actorId);
  if (presence) {
    deps.presenceManager.updateFocusRegions(presence.id, validRegions);
  } else {
    // Register presence with focus regions
    deps.presenceManager.register({
      actorId,
      actorType: 'user',
      name: actorId, // Use actorId as name
      focusRegions: validRegions,
    });
  }

  // Phase 3.1: Schedule debounced presence persistence on focus update
  await deps.markPresencePersistPending();

  // Return the current focus regions for this actor
  const focusInfo = deps.activityDetector.getFocusInfo(actorId);
  const currentRegions = focusInfo?.regions ?? [];

  return jsonResponse(200, {
    success: true,
    focusRegions: currentRegions,
  });
}

/**
 * Handle GET /activity-state - Return activity detection state
 */
export function handleGetActivityState(deps: PresenceProtocolDeps): Response {
  const state: ActivityDetectorState = deps.activityDetector.toJSON();

  return jsonResponse(200, {
    isIdle: state.isIdle,
    lastActivityAt: state.lastHumanActivityAt,
    activeRegions: state.activeRegions,
    humanFocusRegions: state.humanFocusRegions,
    idleTimeoutMs: deps.activityDetector.getIdleTimeoutMs(),
  });
}
