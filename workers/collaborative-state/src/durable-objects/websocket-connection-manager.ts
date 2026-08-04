/**
 * WebSocket connection lifecycle handlers.
 * Extracted from document-session.ts for maintainability.
 *
 * Contains the WebSocket establishment, message routing, disconnect cleanup,
 * rate limiting, and CRDT compaction logic. Each handler is a standalone
 * exported function that receives a WebSocketConnectionDeps object.
 */

import * as Y from 'yjs';
import type { ConnectionMeta, ActorPresence } from '../types';
import type {
  WsPresenceErrorMessage,
} from '../types/websocket-messages';
import { isWsPublishRequest, isWsActionMetadata } from '../types/websocket-messages';
import { incrementCounter, setGauge } from '../services/metrics-service';
import type { PresenceManager } from '../services/presence-service';
import type {
  ActivityDetector,
} from '../services/activity-detection-service';
import {
  MAX_WEBSOCKET_CONNECTIONS,
  MAX_WEBSOCKET_MESSAGE_SIZE,
  MAX_MESSAGES_PER_SECOND,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_CLOSE_THRESHOLD,
  MAX_PENDING_PUCK_ACTIONS,
  MAX_PENDING_PUCK_ACTIONS_BYTES,
} from '../constants/security-limits';
import type {
  EditSession,
  SessionInfo,
  DocumentSessionEnv,
} from './document-session-types';
import { validateActorId } from './session-validators';
import {
  getConnectionMeta,
} from './session-id-parser';
import {
  errorResponse as errorResponseFn,
} from './websocket-utils';
import type { PostgresSyncManager } from './postgres-sync-manager';

// =============================================================================
// Dependencies interface
// =============================================================================

/** Rate-limit tracking entry for a single actor */
export interface RateLimitEntry {
  timestamps: number[];
  consecutiveRateLimits: number;
  rateLimitedInCurrentWindow: boolean;
}

export interface WebSocketConnectionDeps {
  env: DocumentSessionEnv;
  sessionInfo: SessionInfo;
  state: DurableObjectState;
  ydoc: Y.Doc;
  /** Setter for ydoc — needed by compactCrdtState to replace the Y.Doc */
  setYdoc: (doc: Y.Doc) => void;
  initialized: boolean;
  presenceManager: PresenceManager;
  activityDetector: ActivityDetector;
  editSessions: Map<string, EditSession>;
  messageRates: Map<string, RateLimitEntry>;

  // Helper functions from the class
  initializeCrdtIfNeeded: () => Promise<void>;
  restoreSessionInfoFromStorage: () => Promise<void>;
  markPersistPending: () => Promise<void>;
  flushPendingPersist: () => Promise<void>;
  enqueueBroadcast: (sender: WebSocket, update: Uint8Array) => void;
  flushPendingBroadcasts: () => void;
  persist: () => Promise<void>;
  persistPresence: () => Promise<void>;
  persistEditSessions: () => Promise<void>;
  scheduleCleanupAlarm: () => Promise<void>;
  broadcastPresenceUpdate: () => void;
  pushPresenceUpdate: (
    type: 'join' | 'leave' | 'focus' | 'state',
    actorId: string,
    extra?: { actor?: ActorPresence; focusRegions?: string[]; state?: string },
  ) => void;
  handlePresenceMessage: (ws: WebSocket, meta: ConnectionMeta, data: string) => void;
  tryParseJson: (data: string) => unknown;
  handleWsPublishRequest: (
    ws: WebSocket,
    meta: ConnectionMeta,
    message: import('../types/websocket-messages').WsPublishRequestMessage,
  ) => Promise<void>;
  syncManager: PostgresSyncManager;
  runCleanup: () => Promise<{ sessionsRolledBack: number; sessionsCleared: number }>;
  getConnectionCount: () => number;

  /** Storage key for persist pending flag */
  PERSIST_PENDING_KEY: string;
  /** Setter for persistPending flag */
  setPersistPending: (value: boolean) => void;
}

// =============================================================================
// Rate limiting
// =============================================================================

/**
 * Check rate limit for an actor's WebSocket messages.
 * Returns 'ok' if under limit, 'rate_limited' if over limit,
 * or 'close_connection' if persistent abuse detected.
 */
export function checkRateLimit(
  messageRates: Map<string, RateLimitEntry>,
  actorId: string,
): 'ok' | 'rate_limited' | 'close_connection' {
  const now = Date.now();
  let entry = messageRates.get(actorId);
  if (entry === undefined) {
    entry = { timestamps: [], consecutiveRateLimits: 0, rateLimitedInCurrentWindow: false };
    messageRates.set(actorId, entry);
  }

  // Remove timestamps outside the rate limit window
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const prevLength = entry.timestamps.length;
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  // If old timestamps were pruned, we've transitioned to a new window
  if (entry.timestamps.length < prevLength) {
    // If previous window was clean (not rate limited), reset consecutive counter
    if (!entry.rateLimitedInCurrentWindow) {
      entry.consecutiveRateLimits = 0;
    }
    entry.rateLimitedInCurrentWindow = false;
  }

  // Add current timestamp
  entry.timestamps.push(now);

  if (entry.timestamps.length >= MAX_MESSAGES_PER_SECOND) {
    // Only increment consecutive counter once per window
    if (!entry.rateLimitedInCurrentWindow) {
      entry.rateLimitedInCurrentWindow = true;
      entry.consecutiveRateLimits++;
    }
    if (entry.consecutiveRateLimits >= RATE_LIMIT_CLOSE_THRESHOLD) {
      return 'close_connection';
    }
    return 'rate_limited';
  }

  return 'ok';
}

// =============================================================================
// WebSocket connection establishment
// =============================================================================

/**
 * Handle /connect endpoint for WebSocket connections.
 *
 * Establishes a new WebSocket connection, attaches actor metadata,
 * sends initial CRDT state (with optional delta encoding), registers
 * presence, and returns the client-side WebSocket in a 101 response.
 */
export function handleWebSocket(
  deps: WebSocketConnectionDeps,
  request: Request,
): Response {
  const url = new URL(request.url);

  // Auth Phase 4 / PCC-3457 (B1 hardening): WebSocket upgrades forward the
  // ORIGINAL client headers, so X-Verified-* headers on this path are
  // client-forgeable. The worker injects verified identity exclusively via
  // _verified* query params (after stripping any client-supplied ones), so
  // params are the ONLY trusted channel here. Identity now feeds JIT user
  // provisioning — a forged X-Verified-Email would be a row-claiming
  // credential, not just a display name.
  const verifiedActorId = url.searchParams.get('_verifiedActorId');
  const verifiedActorType = url.searchParams.get('_verifiedActorType');
  const verifiedAuthProvider = url.searchParams.get('_verifiedAuthProvider');
  const verifiedEmail = url.searchParams.get('_verifiedEmail');
  const verifiedName = url.searchParams.get('_verifiedName');
  const verifiedAvatarUrl = url.searchParams.get('_verifiedAvatarUrl');
  const verifiedDbUserId = url.searchParams.get('_verifiedDbUserId');

  let actorId: string | null;
  let actorType: string | null;
  let isVerified: boolean;
  let authProvider: string | undefined;
  let email: string | undefined;
  let actorName: string | undefined;
  let actorAvatar: string | undefined;
  let dbUserId: string | undefined;

  if (verifiedActorId !== null && verifiedActorId !== '') {
    // Use verified identity from worker
    actorId = verifiedActorId;
    actorType = verifiedActorType;
    isVerified = true;
    authProvider = verifiedAuthProvider ?? undefined;
    email = verifiedEmail ?? undefined;
    actorName = verifiedName ?? undefined;
    actorAvatar = verifiedAvatarUrl ?? undefined;
    dbUserId = verifiedDbUserId ?? undefined;
  } else {
    // Legacy/test path: use client-supplied headers
    actorId = request.headers.get('X-Actor-Id') ?? url.searchParams.get('actorId');
    actorType = request.headers.get('X-Actor-Type') ?? url.searchParams.get('actorType');
    isVerified = false;
  }

  if (actorId === null || actorId === '') {
    return errorResponseFn(400, 'actorId is required (via X-Actor-Id header or actorId query param)');
  }

  if (actorType === null || actorType === '') {
    return errorResponseFn(400, 'actorType is required (via X-Actor-Type header or actorType query param)');
  }

  if (actorType !== 'user' && actorType !== 'agent') {
    return errorResponseFn(400, 'actorType must be "user" or "agent"');
  }

  // Security: Validate actorId format
  const actorIdError = validateActorId(actorId);
  if (actorIdError !== null) {
    return errorResponseFn(400, actorIdError);
  }

  // Security: Limit concurrent connections
  if (deps.getConnectionCount() >= MAX_WEBSOCKET_CONNECTIONS) {
    return errorResponseFn(503, 'Too many connections. Try again later.');
  }

  // Check if WebSocketPair is available (may not be in test environment)
  if (typeof WebSocketPair === 'undefined') {
    return new Response(
      JSON.stringify({ error: 'WebSocket not supported in this environment' }),
      { status: 501, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Create WebSocket pair
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];

  // Accept the WebSocket connection via Hibernatable API
  // (must happen before serializeAttachment so the runtime tracks the socket)
  deps.state.acceptWebSocket(server);

  // Store connection metadata as attachment (Hibernatable WebSocket API)
  const meta: ConnectionMeta = {
    actorId,
    actorType,
    dbUserId,
    verified: isVerified,
    authProvider: authProvider as ConnectionMeta['authProvider'],
    email,
    name: actorName,
    avatar: actorAvatar,
  };
  server.serializeAttachment(meta);

  // Record WebSocket connection metrics
  incrementCounter('css_ws_connections_total', { action: 'open' });
  setGauge('css_ws_connections_active', deps.getConnectionCount());

  // Schedule cleanup alarm if not already scheduled
  void deps.scheduleCleanupAlarm();

  // Phase 1.3: Delta encoding — check for client-provided state vector
  const stateVectorParam = url.searchParams.get('stateVector');
  let stateUpdate: Uint8Array;
  if (stateVectorParam !== null && stateVectorParam !== '') {
    try {
      // Decode base64 state vector from client
      const svBinary = atob(stateVectorParam);
      const clientStateVector = new Uint8Array(svBinary.length);
      for (let i = 0; i < svBinary.length; i++) {
        clientStateVector[i] = svBinary.charCodeAt(i);
      }
      // Send only the delta since the client's state vector
      stateUpdate = Y.encodeStateAsUpdate(deps.ydoc, clientStateVector);
    } catch {
      // If state vector is invalid, fall back to full state
      stateUpdate = Y.encodeStateAsUpdate(deps.ydoc);
    }
  } else {
    // No state vector — send full compacted state
    stateUpdate = Y.encodeStateAsUpdate(deps.ydoc);
  }

  server.send(stateUpdate);

  // Broadcast presence update to all clients (new connection joined)
  deps.broadcastPresenceUpdate();

  // Phase 3.2: Push presence join to PresenceManager DO.
  // For agents with an active edit session the actor is already in presenceManager;
  // for browser users it is not, so we build one from the verified connection meta.
  // Without this, the PresenceManager DO never learns about human editors and
  // branch/site presence always shows 0 human actors.
  const joinedPresence = deps.presenceManager.getByActorId(actorId);
  const now = new Date().toISOString();
  const actorForDo: ActorPresence = joinedPresence ?? {
    id: `ws-${actorId}`,
    actorId,
    actorType,
    role: actorType === 'agent' ? 'agent' : 'human',
    name: meta.name ?? meta.email ?? actorId,
    avatar: meta.avatar,
    state: 'active',
    lastActivityAt: now,
    joinedAt: now,
  };
  deps.pushPresenceUpdate('join', actorId, { actor: actorForDo });

  // Return the client side of the WebSocket
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

// =============================================================================
// WebSocket message handling
// =============================================================================

/**
 * Handle incoming WebSocket messages (Hibernatable WebSocket API callback).
 *
 * Routes text messages to presence/publish handlers and binary messages
 * to the Yjs CRDT update pipeline.
 */
export async function handleWebSocketMessage(
  deps: WebSocketConnectionDeps,
  ws: WebSocket,
  message: string | ArrayBuffer,
): Promise<void> {
  // Restore session info from storage if state.id.name is unavailable (Miniflare).
  // webSocketMessage is called directly by the runtime — not through fetch() —
  // so updateSessionInfoFromRequest never runs on DO restart.
  await deps.restoreSessionInfoFromStorage();
  await deps.initializeCrdtIfNeeded();

  const meta = getConnectionMeta(ws);
  if (meta === null) {
    console.warn('webSocketMessage: no metadata for WebSocket');
    return;
  }

  // Phase 4.1: Rate limit check
  const rateCheck = checkRateLimit(deps.messageRates, meta.actorId);
  if (rateCheck === 'close_connection') {
    const errorMsg: WsPresenceErrorMessage = {
      type: 'presence_error',
      code: 'RATE_LIMITED',
      message: 'Connection closed due to persistent rate limiting',
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(errorMsg));
    ws.close(1008, 'Rate limit exceeded');
    return;
  }
  if (rateCheck === 'rate_limited') {
    const errorMsg: WsPresenceErrorMessage = {
      type: 'presence_error',
      code: 'RATE_LIMITED',
      message: 'Message rate limit exceeded. Please slow down.',
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(errorMsg));
    return;
  }

  try {
    // Distinguish text (presence JSON) from binary (Yjs CRDT) messages
    if (typeof message === 'string') {
      // Check for publish_request first — it's async (involves flush + HTTP)
      // and must be handled before the sync handlePresenceMessage
      const parsed = deps.tryParseJson(message);
      if (parsed !== null && isWsPublishRequest(parsed)) {
        await deps.handleWsPublishRequest(ws, meta, parsed);
        return;
      }
      // Capture action metadata from Puck client — store on syncManager
      // so the next scheduleSync includes it in the sync payload
      if (parsed !== null && isWsActionMetadata(parsed)) {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy actionType/actionMetadata fallback
        const legacyType = parsed.actionType;
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        const legacyMeta = parsed.actionMetadata;
        const puckActions: { type: string; [key: string]: unknown }[] =
          Array.isArray(parsed.puckActions) ? parsed.puckActions
            : (typeof legacyType === 'string' ? [{ type: legacyType, ...legacyMeta }] : []);
        const validated = puckActions.filter(
          (a: unknown) => typeof a === 'object' && a !== null && typeof (a as Record<string, unknown>).type === 'string',
        );
        if (deps.syncManager.pendingPuckActions.length < MAX_PENDING_PUCK_ACTIONS) {
          const remaining = MAX_PENDING_PUCK_ACTIONS - deps.syncManager.pendingPuckActions.length;
          const toAdd = validated.slice(0, remaining);
          const currentSize = JSON.stringify(deps.syncManager.pendingPuckActions).length;
          const addSize = JSON.stringify(toAdd).length;
          if (currentSize + addSize <= MAX_PENDING_PUCK_ACTIONS_BYTES) {
            deps.syncManager.pendingPuckActions.push(...toAdd);
          }
        }
        if (typeof legacyType === 'string') {
          deps.syncManager.pendingActionMetadata = {
            actionType: legacyType,
            actionMetadata: legacyMeta,
          };
        }
        return;
      }
      deps.handlePresenceMessage(ws, meta, message);
      return;
    }

    // Binary frame: Yjs CRDT update
    const data = message;

    // Security: Limit message size
    if (data.byteLength > MAX_WEBSOCKET_MESSAGE_SIZE) {
      console.warn(`WebSocket message too large: ${String(data.byteLength)} bytes`);
      return;
    }

    const update = new Uint8Array(data);

    // Apply update to local doc
    Y.applyUpdate(deps.ydoc, update);

    // Phase 1.2: Batch broadcast — accumulate update and schedule flush
    deps.enqueueBroadcast(ws, update);

    // Phase 1.1: Debounced persistence — mark pending instead of persisting directly
    await deps.markPersistPending();

    // Schedule sync to PostgreSQL after idle timeout. Attribution uses the
    // resolved dbUserId (app.users.id) when present; actorId (the OAuth
    // subject) is the fallback for agents and unresolved principals, which
    // the persistence-layer resolver still handles. actorEmail/actorName let
    // that fallback JIT-provision.
    await deps.syncManager.scheduleSync(meta.dbUserId ?? meta.actorId, meta.actorType, {
      actorEmail: meta.email,
      actorName: meta.name,
    });
  } catch (error) {
    console.error('Error handling WebSocket message:', error);
  }
}

// =============================================================================
// WebSocket close / error
// =============================================================================

/**
 * Handle WebSocket close (Hibernatable WebSocket API callback).
 */
export async function handleWebSocketClose(
  deps: WebSocketConnectionDeps,
  ws: WebSocket,
): Promise<void> {
  await deps.initializeCrdtIfNeeded();

  const meta = getConnectionMeta(ws);
  const actorId = meta?.actorId ?? 'unknown';
  await handleWebSocketDisconnect(deps, ws, actorId);
}

/**
 * Handle WebSocket error (Hibernatable WebSocket API callback).
 */
export async function handleWebSocketError(
  deps: WebSocketConnectionDeps,
  ws: WebSocket,
): Promise<void> {
  await deps.initializeCrdtIfNeeded();

  const meta = getConnectionMeta(ws);
  const actorId = meta?.actorId ?? 'unknown';
  await handleWebSocketDisconnect(deps, ws, actorId);
}

// =============================================================================
// Disconnect cleanup
// =============================================================================

/**
 * Handle WebSocket disconnect (close or error).
 * Cleans up actor's presence, focus regions, and triggers sync if needed.
 *
 * Must be awaited so that persist/sync operations complete before the DO
 * is eligible for hibernation (fire-and-forget promises would be cancelled).
 *
 * @param deps - Dependencies
 * @param server - The WebSocket connection
 * @param actorId - The actor ID associated with this connection
 */
export async function handleWebSocketDisconnect(
  deps: WebSocketConnectionDeps,
  server: WebSocket,
  actorId: string,
): Promise<void> {
  // Runtime manages WebSocket removal for Hibernatable API
  incrementCounter('css_ws_connections_total', { action: 'close' });
  setGauge('css_ws_connections_active', deps.getConnectionCount());

  // Check if actor has other active connections before cleaning up
  // Filter out the closing socket for accurate count
  const remainingWebSockets = deps.state.getWebSockets().filter((ws: WebSocket) => ws !== server);
  let actorHasOtherConnections = false;
  for (const ws of remainingWebSockets) {
    const meta = getConnectionMeta(ws);
    if (meta !== null && meta.actorId === actorId) {
      actorHasOtherConnections = true;
      break;
    }
  }

  // Only clean up actor data if they have no other connections
  if (!actorHasOtherConnections) {
    // Clear actor's focus regions from activity detector
    deps.activityDetector.clearActorFocus(actorId);

    // Unregister actor from presence manager
    deps.presenceManager.unregisterByActorId(actorId);

    // Phase 3.2: Push presence leave to PresenceManager DO
    deps.pushPresenceUpdate('leave', actorId);

    // Phase 4.1: Clean up rate tracking
    deps.messageRates.delete(actorId);
  }

  // Broadcast presence update to remaining clients (connection left)
  deps.broadcastPresenceUpdate();

  // Phase 1.2: Flush any pending broadcasts before checking disconnect
  deps.flushPendingBroadcasts();

  // If this was the last connection, clean up and sync
  if (remainingWebSockets.length === 0) {
    // Run one final cleanup before syncing
    // (Cleanup alarm will self-stop if no data to track)
    const cleanupStats = await deps.runCleanup();

    // Persist edit sessions if any were cleared during cleanup
    if (cleanupStats.sessionsCleared > 0) {
      await deps.persistEditSessions();
    }

    // Compact CRDT state to free memory from deleted content
    compactCrdtState(deps);

    // Phase 1.1: Flush pending persist and persist compacted state
    deps.setPersistPending(false);
    await deps.state.storage.delete(deps.PERSIST_PENDING_KEY);
    await deps.persist();

    // Phase 3.1: Persist presence state immediately on last disconnect
    await deps.persistPresence();

    // Trigger sync to PostgreSQL (awaited so it completes before hibernation)
    await deps.syncManager.syncToPostgres();
  }
}

// =============================================================================
// CRDT compaction
// =============================================================================

/**
 * Compact the Y.Doc CRDT state to free memory from deleted content.
 * This replaces the current Y.Doc with a fresh one containing only current state.
 * Should only be called when there are no active connections.
 */
export function compactCrdtState(deps: WebSocketConnectionDeps): void {
  // Safety check: don't compact if there are active connections
  if (deps.getConnectionCount() > 0) {
    console.warn('compactCrdtState called with active connections - skipping');
    return;
  }

  try {
    // Encode current state (this creates a compacted representation)
    const compactedState = Y.encodeStateAsUpdate(deps.ydoc);

    // Create a fresh Y.Doc and apply the compacted state
    const newDoc = new Y.Doc();
    Y.applyUpdate(newDoc, compactedState);

    // Replace the old doc with the new one
    deps.setYdoc(newDoc);

    console.log('CRDT state compacted successfully');
  } catch (error) {
    console.error('Failed to compact CRDT state:', error);
  }
}
