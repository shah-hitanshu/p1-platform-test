/**
 * Phase 2.1: RealtimeClient
 *
 * WebSocket-based real-time collaboration client using Yjs CRDT.
 * Provides bidirectional sync between client and DocumentSession Durable Object.
 * Uses ReconnectingWebSocket from partysocket for automatic reconnection with exponential backoff.
 */

import * as Y from 'yjs';
import { WebSocket as ReconnectingWebSocket } from 'partysocket';
import type {
  ActorPresence,
  ActorState,
  PublishResult,
  WsFocusRegionUpdateMessage,
  WsPresenceHeartbeatMessage,
  WsServerMessage,
} from './types';

/**
 * Configuration for reconnection behavior
 */
export interface ReconnectionConfig {
  /**
   * Maximum number of reconnection attempts.
   * Set to Infinity for unlimited retries.
   * @default Infinity
   */
  maxRetries?: number;

  /**
   * Minimum delay between reconnection attempts in milliseconds.
   * @default 1000
   */
  minReconnectionDelay?: number;

  /**
   * Maximum delay between reconnection attempts in milliseconds.
   * @default 30000
   */
  maxReconnectionDelay?: number;

  /**
   * Factor by which to multiply the delay for each retry (exponential backoff).
   * @default 1.5
   */
  reconnectionDelayGrowFactor?: number;
}

/**
 * Configuration for the RealtimeClient
 */
export interface RealtimeClientConfig {
  /**
   * Base URL for WebSocket connections.
   * Can be ws:// or wss:// protocol.
   * Example: "wss://api.example.com" or "ws://localhost:8787"
   */
  baseUrl: string;

  /**
   * API key for authentication.
   * Will be passed as a query parameter since browsers can't send
   * custom headers with WebSocket upgrade requests.
   */
  apiKey?: string;

  /**
   * Callback when document state is updated (from remote changes)
   */
  onUpdate?: (snapshot: Record<string, unknown>) => void;

  /**
   * Callback when WebSocket connection is established
   */
  onConnect?: () => void;

  /**
   * Callback when WebSocket connection is closed
   */
  onDisconnect?: () => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: Error) => void;

  /**
   * Callback when attempting to reconnect after a connection loss.
   * Called with the current retry attempt number.
   */
  onReconnecting?: (attempt: number) => void;

  /**
   * Callback when authorization fails (WebSocket close code 4401 or 4403).
   * This indicates the session is invalid or the agent lacks permission.
   * When this is called, the client will NOT attempt to reconnect.
   */
  onAuthorizationError?: (error: Error) => void;

  /**
   * Callback when presence update is received from server.
   * Called with the full list of actors in the document.
   */
  onPresenceUpdate?: (actors: ActorPresence[]) => void;

  /**
   * Callback when another actor updates their focus regions.
   * Called with the actor ID and their new focus regions.
   */
  onFocusRegionBroadcast?: (actorId: string, focusRegions: string[]) => void;

  /**
   * Configuration for automatic reconnection behavior.
   */
  reconnection?: ReconnectionConfig;

  /**
   * Callback when the server sends a RATE_LIMITED error.
   * The client remains connected; this is informational.
   */
  onRateLimited?: () => void;

  /**
   * Callback when the server sends close code 4001 (server-initiated reload).
   * Called after the local Y.Doc is cleared, before automatic reconnection.
   * Use this to notify users that the document is being refreshed.
   */
  onServerReload?: () => void;

  /**
   * Optional token refresher for dynamic WebSocket authentication.
   * Called when the WebSocket connection closes unexpectedly (non-intentionally).
   * Should return a fresh token string, or null if the session cannot be refreshed.
   * The fresh token is used in subsequent reconnection URLs.
   */
  tokenRefresher?: () => Promise<string | null>;
}

/**
 * Parameters for connecting to a document session
 */
export interface ConnectionParams {
  /** Site ID */
  siteId: string;

  /** Branch ID */
  branchId: string;

  /** Document path (e.g., "pages/home") */
  documentPath: string;

  /** Actor ID (user or agent ID) */
  actorId: string;

  /** Actor type */
  actorType: 'user' | 'agent';

  /**
   * Session ID for agent authorization.
   * Required for agents, obtained from startEdit() response.
   * Enables server-side enforcement of the Agent Politeness Protocol.
   */
  sessionId?: string;
}

/**
 * Real-time collaboration client using Yjs CRDT over WebSocket.
 * Uses PartySocket for automatic reconnection with exponential backoff.
 *
 * @example
 * ```typescript
 * const client = new RealtimeClient({
 *   baseUrl: 'wss://api.example.com',
 *   onUpdate: (snapshot) => {
 *     console.log('Document updated:', snapshot);
 *   },
 *   onReconnecting: (attempt) => {
 *     console.log(`Reconnecting... attempt ${attempt}`);
 *   },
 *   reconnection: {
 *     maxRetries: 10,
 *     minReconnectionDelay: 1000,
 *     maxReconnectionDelay: 30000,
 *   },
 * });
 *
 * client.connect({
 *   siteId: 'site-123',
 *   branchId: 'branch-456',
 *   documentPath: 'pages/home',
 *   actorId: 'user-789',
 *   actorType: 'user',
 * });
 *
 * // When done
 * client.disconnect();
 * ```
 */
export class RealtimeClient {
  private readonly config: RealtimeClientConfig;
  private readonly ydoc: Y.Doc;
  private ws: ReconnectingWebSocket | null = null;
  private connected = false;
  private intentionalDisconnect = false;
  private currentApiKey: string | undefined;
  private tokenRefreshInFlight = false;
  private hasConnectedOnce = false;
  private lastReportedRetryCount = 0;
  private reconnectCheckInterval: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;

  // Rate limiting state
  private sendTimestamps: number[] = [];
  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly RATE_THRESHOLD = 40; // Start buffering at this rate
  private static readonly RATE_WINDOW_MS = 1000; // 1-second sliding window

  // Echo suppression: track the last JSON snapshot sent to the DO.
  // If a Y.Doc update produces the same JSON snapshot as we last sent,
  // it's a no-op echo (typically from Puck's onChange after receiving
  // a remote sync) and should NOT be sent to avoid overwriting newer data.
  private lastSentSnapshot: string | null = null;

  // Delivery acknowledgment state
  private pendingDeliveryAcks: Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private static readonly DELIVERY_ACK_TIMEOUT_MS = 5000;

  // Publish request state
  private pendingPublishRequests: Map<string, {
    resolve: (result: PublishResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private static readonly PUBLISH_TIMEOUT_MS = 30000;

  // Action metadata state — best-effort metadata sent alongside CRDT updates
  private pendingActionMetadata: Array<{ type: string; [key: string]: unknown }> | null = null;

  constructor(config: RealtimeClientConfig) {
    this.config = config;
    this.ydoc = new Y.Doc();

    // Listen for local changes to broadcast
    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      // Only broadcast if this update didn't come from remote
      if (origin !== 'remote' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const root = this.ydoc.getMap('root');
        const currentSnapshot = JSON.stringify(root.toJSON());

        // Echo suppression: if the Y.Doc's JSON snapshot hasn't changed since
        // the last time we sent (or since the last remote update), this is a
        // no-op full-rebuild echo. Don't send it — it would overwrite newer
        // data on the DO if another client has edited since.
        if (currentSnapshot === this.lastSentSnapshot) {
          this.sendPendingActionMetadata();
          return;
        }

        this.lastSentSnapshot = currentSnapshot;
        this.rateLimitedSend(update);
        // Send any pending action metadata after the CRDT update
        this.sendPendingActionMetadata();
      } else if (origin === 'remote') {
        // Track the remote snapshot so we can detect echoes
        const root = this.ydoc.getMap('root');
        this.lastSentSnapshot = JSON.stringify(root.toJSON());
      }
    });
  }

  /**
   * Connect to a document session via WebSocket.
   * Uses PartySocket for automatic reconnection on connection loss.
   *
   * @param params - Connection parameters including site, branch, document, and actor info
   */
  connect(params: ConnectionParams): void {
    if (this.ws) {
      this.disconnect();
    }

    this.currentApiKey = this.config.apiKey;
    this.intentionalDisconnect = false;
    this.hasConnectedOnce = false;
    this.lastReportedRetryCount = 0;

    // Build WebSocket URL
    const baseUrl = this.config.baseUrl.replace(/^http/, 'ws');
    const encodedPath = encodeURIComponent(params.documentPath);
    const url = new URL(
      `/api/sites/${params.siteId}/branches/${params.branchId}/documents/${encodedPath}/connect`,
      baseUrl,
    );

    // Add actor info as query params (WebSocket can't send headers)
    url.searchParams.set('actorId', params.actorId);
    url.searchParams.set('actorType', params.actorType);

    // Note: apiKey is NOT added to the base URL here — it is injected inside
    // urlProvider so that a refreshed token is picked up on each reconnect.

    // Add session ID for agent authorization (obtained from startEdit())
    if (params.sessionId) {
      url.searchParams.set('sessionId', params.sessionId);
    }

    // Get reconnection config with defaults
    const reconnection = this.config.reconnection ?? {};
    const maxRetries = reconnection.maxRetries ?? Infinity;
    const minReconnectionDelay = reconnection.minReconnectionDelay ?? 1000;
    const maxReconnectionDelay = reconnection.maxReconnectionDelay ?? 30000;
    const reconnectionDelayGrowFactor = reconnection.reconnectionDelayGrowFactor ?? 1.5;

    // Build the base WebSocket URL (without state vector)
    const baseWsUrl = url.toString();

    // Create a URL provider function for PartySocket.
    // On the initial connect the state vector is omitted so the server sends
    // the full CRDT history.  On every subsequent (re)connect the current Yjs
    // state vector is included so the server can respond with only the delta.
    // Also injects the current API key on every call so that a refreshed token
    // (set by tokenRefresher after an unexpected close) is used for each
    // reconnect attempt.
    const urlProvider = (): string => {
      const connectUrl = new URL(baseWsUrl);

      // Inject current token — may have been refreshed after an unexpected disconnect
      if (this.currentApiKey) {
        connectUrl.searchParams.set('apiKey', this.currentApiKey);
      }

      // Include the state vector on every call after the first successful
      // connection so the server can send a delta rather than full history.
      if (this.hasConnectedOnce) {
        const sv = Y.encodeStateVector(this.ydoc);
        const svBase64 = btoa(String.fromCharCode(...sv));
        connectUrl.searchParams.set('stateVector', svBase64);
      }

      return connectUrl.toString();
    };

    // Create ReconnectingWebSocket with URL provider and reconnection options
    this.ws = new ReconnectingWebSocket(urlProvider, [], {
      maxRetries,
      minReconnectionDelay,
      maxReconnectionDelay,
      reconnectionDelayGrowFactor,
    });

    this.ws.binaryType = 'arraybuffer';

    // Start monitoring for reconnection attempts
    this.startReconnectMonitoring();

    // Start visibility change monitoring to handle tab backgrounding
    this.startVisibilityMonitoring();

    this.ws.addEventListener('open', () => {
      this.connected = true;

      // Send local state when doc has content (seeded or from prior session).
      // On initial connect with seeded data, this ensures bidirectional sync.
      // On reconnect, this sends any edits made while disconnected.
      if (this.ws) {
        const root = this.ydoc.getMap('root');
        if (root.size > 0) {
          const localState = Y.encodeStateAsUpdate(this.ydoc);
          this.ws.send(localState);
        }
      }

      this.hasConnectedOnce = true;
      this.lastReportedRetryCount = 0;
      this.config.onConnect?.();
    });

    this.ws.addEventListener('message', (event) => {
      try {
        // Distinguish text (presence JSON) from binary (Yjs CRDT) messages
        if (typeof event.data === 'string') {
          // Text frame: JSON presence message
          this.handleTextMessage(event.data);
          return;
        }

        // Binary frame: Yjs CRDT update
        const data = event.data as ArrayBuffer;
        const update = new Uint8Array(data);

        // Apply remote update to local Y.Doc
        Y.applyUpdate(this.ydoc, update, 'remote');

        // Notify listeners of new snapshot
        const root = this.ydoc.getMap('root');
        const snapshot = root.toJSON() as Record<string, unknown>;
        this.config.onUpdate?.(snapshot);
      } catch (error) {
        console.error('[Realtime] Error processing message:', error);
        this.config.onError?.(
          error instanceof Error ? error : new Error('Failed to process message'),
        );
      }
    });

    this.ws.addEventListener('close', (event) => {
      this.connected = false;

      const closeEvent = event as CloseEvent;

      // Server-initiated reload (e.g. after migration) — clear the local
      // Y.Doc so the reconnect receives fresh state from the server instead
      // of sending stale data back and overwriting the migration.
      if (closeEvent.code === 4001) {
        const root = this.ydoc.getMap('root');
        this.ydoc.transact(() => {
          root.clear();
        });
        this.lastSentSnapshot = null;
        this.config.onServerReload?.();
        // PartySocket will reconnect automatically; the open handler
        // skips sending state when root.size === 0
      }

      // Check for authorization failure close codes (4401 Unauthorized, 4403 Forbidden)
      if (closeEvent.code === 4401 || closeEvent.code === 4403) {
        // Authorization failure - do not attempt to reconnect
        this.intentionalDisconnect = true;
        this.stopReconnectMonitoring();
        this.ws?.close();
        this.ws = null;

        // Call authorization error callback
        const reason = closeEvent.reason || 'Authorization failed';
        this.config.onAuthorizationError?.(new Error(reason));
        this.config.onDisconnect?.();
        return;
      }

      // Only call onDisconnect for intentional disconnects or when max retries exceeded
      if (this.intentionalDisconnect) {
        this.stopReconnectMonitoring();
        this.ws = null;
        this.config.onDisconnect?.();
      }
      // PartySocket will automatically attempt to reconnect otherwise

      // Fire-and-forget token refresh on unexpected close so the next
      // urlProvider call uses a fresh token for the reconnect URL.
      // Guard prevents concurrent refreshes when the socket flaps rapidly.
      if (!this.intentionalDisconnect && this.config.tokenRefresher && !this.tokenRefreshInFlight) {
        this.tokenRefreshInFlight = true;
        this.config.tokenRefresher().then((freshToken) => {
          if (freshToken) {
            this.currentApiKey = freshToken;
          }
        }).catch(() => {
          // Ignore errors — the reconnect will proceed with the stale token
        }).finally(() => {
          this.tokenRefreshInFlight = false;
        });
      }
    });

    this.ws.addEventListener('error', () => {
      this.config.onError?.(new Error('WebSocket error'));
    });
  }

  /**
   * Start monitoring for reconnection attempts by polling retryCount.
   * This is needed because PartySocket doesn't expose a reconnection callback.
   */
  private startReconnectMonitoring(): void {
    this.stopReconnectMonitoring();

    // Poll every 100ms to detect retry count changes
    this.reconnectCheckInterval = setInterval(() => {
      if (!this.ws || this.intentionalDisconnect) {
        return;
      }

      const currentRetryCount = this.ws.retryCount;

      // If retry count increased and we've connected before, we're reconnecting
      if (
        currentRetryCount > this.lastReportedRetryCount &&
        this.hasConnectedOnce
      ) {
        this.lastReportedRetryCount = currentRetryCount;
        this.config.onReconnecting?.(currentRetryCount);
      }
    }, 100);
  }

  /**
   * Stop the reconnection monitoring interval.
   */
  private stopReconnectMonitoring(): void {
    if (this.reconnectCheckInterval) {
      clearInterval(this.reconnectCheckInterval);
      this.reconnectCheckInterval = null;
    }
  }

  /**
   * Start monitoring for page visibility changes.
   * When the page becomes visible after being hidden, check connection health
   * and force a reconnection sync if needed.
   */
  private startVisibilityMonitoring(): void {
    this.stopVisibilityMonitoring();

    // Only set up if document is available (browser environment)
    if (typeof document === 'undefined') {
      return;
    }

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && !this.intentionalDisconnect && this.ws) {
        // Force a reconnection by calling reconnect() on PartySocket.
        // This ensures we get a fresh connection even if the old one appears open
        // but is actually stale (server closed it while tab was backgrounded).
        // PartySocket's reconnect() will close the current connection and open a new one.
        // The 'open' event handler will then send local state for bidirectional sync.
        this.ws.reconnect();
      }
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * Stop visibility change monitoring.
   */
  private stopVisibilityMonitoring(): void {
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /**
   * Disconnect from the current session.
   * This permanently closes the connection and stops any reconnection attempts.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.stopReconnectMonitoring();
    this.stopVisibilityMonitoring();

    // Clean up rate limiting state
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingUpdates = [];
    this.sendTimestamps = [];

    // Reject all pending delivery ack promises
    for (const [requestId, pending] of this.pendingDeliveryAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
      this.pendingDeliveryAcks.delete(requestId);
    }

    // Reject all pending publish request promises
    for (const [requestId, pending] of this.pendingPublishRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
      this.pendingPublishRequests.delete(requestId);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Apply a local Yjs update.
   * This is typically called from Puck-Yjs binding when local edits occur.
   * Uses rate-aware sending to avoid exceeding the server's rate limit.
   *
   * @param update - Raw Yjs update bytes
   */
  applyLocalUpdate(update: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.rateLimitedSend(update);
    }
  }

  /**
   * Set pending action metadata to be sent after the next CRDT update.
   * The metadata is best-effort — if the WebSocket is not open or the
   * send fails, the CRDT update still goes through without metadata.
   *
   * @param meta - Action type and metadata from Puck's onAction callback
   */
  setActionMetadata(actions: Array<{ type: string; [key: string]: unknown }> | null): void {
    this.pendingActionMetadata = actions;
  }

  /**
   * Send any pending action metadata as a text message and clear it.
   * Called after a CRDT update is sent to associate the metadata with
   * the most recent edit.
   */
  sendPendingActionMetadata(): void {
    if (this.pendingActionMetadata && this.pendingActionMetadata.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const msg = JSON.stringify({
          type: 'action_metadata',
          puckActions: this.pendingActionMetadata,
        });
        this.ws.send(msg);
      } catch (err) {
        console.error('[RealtimeClient] Failed to send action_metadata:', err);
      }
      this.pendingActionMetadata = null;
    }
  }

  /**
   * Send a Yjs update with rate awareness.
   * Sends immediately when under the threshold (40 msgs/sec).
   * Buffers and coalesces updates when approaching the server's 50 msg/sec limit.
   */
  private rateLimitedSend(update: Uint8Array): void {
    if (!this.ws) return;

    const now = Date.now();

    // Prune timestamps outside the sliding window
    this.sendTimestamps = this.sendTimestamps.filter(
      (ts) => now - ts < RealtimeClient.RATE_WINDOW_MS,
    );

    if (this.sendTimestamps.length < RealtimeClient.RATE_THRESHOLD) {
      // Under threshold — send immediately
      this.sendTimestamps.push(now);
      this.ws.send(update);
    } else {
      // At or above threshold — buffer for coalesced flush
      this.pendingUpdates.push(update);
      this.scheduleFlush();
    }
  }

  /**
   * Schedule a flush of buffered updates after the rate window resets.
   */
  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPendingUpdates();
    }, RealtimeClient.RATE_WINDOW_MS);
  }

  /**
   * Flush all buffered updates as a single coalesced message.
   */
  private flushPendingUpdates(): void {
    if (this.pendingUpdates.length === 0) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingUpdates = [];
      return;
    }

    // Merge all pending updates into a single Yjs update
    const merged = Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];

    // Reset window and send
    this.sendTimestamps = [Date.now()];
    this.ws.send(merged);
  }

  /**
   * Get the current document snapshot as JSON.
   */
  getSnapshot(): Record<string, unknown> {
    const root = this.ydoc.getMap('root');
    return root.toJSON() as Record<string, unknown>;
  }

  /**
   * Get the underlying Y.Doc for direct manipulation.
   * Use with caution - prefer using the Puck-Yjs binding utilities.
   */
  getYDoc(): Y.Doc {
    return this.ydoc;
  }

  /**
   * Check if currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check if presence updates are available via WebSocket.
   * Returns true when connected and able to send/receive presence messages.
   */
  get presenceViaWebSocket(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send focus regions update to the server.
   * @param focusRegions - JSON paths the actor is focused on
   * @returns true if message was sent, false if not connected
   */
  sendFocusRegions(focusRegions: string[]): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const message: WsFocusRegionUpdateMessage = {
      type: 'focus_region_update',
      focusRegions,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Send a presence heartbeat to keep the connection alive.
   * @param state - Optional state update (active, idle, editing)
   */
  sendHeartbeat(state?: ActorState): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: WsPresenceHeartbeatMessage = {
      type: 'presence_heartbeat',
      timestamp: Date.now(),
      ...(state && { state }),
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Wait for the server to acknowledge that all preceding WebSocket messages
   * have been processed. This uses TCP ordering guarantees: a text frame sent
   * after binary CRDT updates is guaranteed to arrive after those updates.
   * The server echoes back a delivery_ack with the matching requestId.
   *
   * Used before publish to ensure the Durable Object has received and applied
   * the latest edits before the HTTP publish request arrives.
   *
   * @returns Promise that resolves when the server confirms delivery
   * @throws Error if not connected or if timeout expires (5 seconds)
   */
  waitForDelivery(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Not connected'));
    }

    const ws = this.ws;
    const requestId = crypto.randomUUID();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDeliveryAcks.delete(requestId);
        reject(new Error('Delivery acknowledgment timed out'));
      }, RealtimeClient.DELIVERY_ACK_TIMEOUT_MS);

      this.pendingDeliveryAcks.set(requestId, { resolve, reject, timer });

      ws.send(JSON.stringify({
        type: 'delivery_ack_request',
        requestId,
        timestamp: Date.now(),
      }));
    });
  }

  /**
   * Request the server to publish the current document via WebSocket.
   * TCP ordering guarantees all preceding binary CRDT updates have been
   * processed before this message is handled, eliminating stale-version races.
   *
   * The Durable Object handles the entire flow: flush to Postgres, then
   * call /internal/publish to create the checkpoint.
   *
   * @returns Promise that resolves with the publish result
   * @throws Error if not connected or if timeout expires (30 seconds)
   */
  requestPublish(): Promise<PublishResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Not connected'));
    }

    const ws = this.ws;
    const requestId = crypto.randomUUID();

    return new Promise<PublishResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPublishRequests.delete(requestId);
        reject(new Error('Publish request timed out'));
      }, RealtimeClient.PUBLISH_TIMEOUT_MS);

      this.pendingPublishRequests.set(requestId, { resolve, reject, timer });

      ws.send(JSON.stringify({
        type: 'publish_request',
        requestId,
        timestamp: Date.now(),
      }));
    });
  }

  /**
   * Handle incoming text (JSON) messages for presence protocol.
   * @param data - Raw JSON string from WebSocket
   */
  private handleTextMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WsServerMessage;

      switch (message.type) {
        case 'presence_update':
          this.config.onPresenceUpdate?.(message.actors);
          break;

        case 'focus_region_broadcast':
          this.config.onFocusRegionBroadcast?.(message.actorId, message.focusRegions);
          break;

        case 'focus_region_ack':
          // Acknowledgment received
          break;

        case 'delivery_ack': {
          const pending = this.pendingDeliveryAcks.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingDeliveryAcks.delete(message.requestId);
            pending.resolve();
          }
          break;
        }

        case 'publish_result': {
          const pendingPublish = this.pendingPublishRequests.get(message.requestId);
          if (pendingPublish) {
            clearTimeout(pendingPublish.timer);
            this.pendingPublishRequests.delete(message.requestId);
            pendingPublish.resolve({
              success: message.success,
              publishedVersionId: message.publishedVersionId,
              checkpoint: message.checkpoint,
              error: message.error,
            });
          }
          break;
        }

        case 'presence_error':
          if (message.code === 'RATE_LIMITED') {
            this.config.onRateLimited?.();
          } else {
            console.error('[Realtime] Presence error:', message.code, message.message);
          }
          break;

        default:
          console.warn('[Realtime] Unknown message type:', (message as { type: string }).type);
      }
    } catch (error) {
      console.error('[Realtime] Error parsing text message:', error);
    }
  }
}
