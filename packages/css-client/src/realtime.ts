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
  private hasConnectedOnce = false;
  private lastReportedRetryCount = 0;
  private reconnectCheckInterval: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor(config: RealtimeClientConfig) {
    this.config = config;
    this.ydoc = new Y.Doc();

    // Listen for local changes to broadcast
    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      // Only broadcast if this update didn't come from remote
      if (origin !== 'remote' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        /* TODO: Remove console.log */
        console.log('[Realtime] Sending local update, size:', update.length, 'origin:', origin);
        this.ws.send(update);
      } else if (origin !== 'remote') {
        console.log('[Realtime] NOT sending update - ws:', !!this.ws, 'readyState:', this.ws?.readyState);
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

    // Add API key as query param (WebSocket can't send custom headers)
    if (this.config.apiKey) {
      url.searchParams.set('apiKey', this.config.apiKey);
    }

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

    // Build the full WebSocket URL
    const wsUrl = url.toString();

    // Create ReconnectingWebSocket with reconnection options
    this.ws = new ReconnectingWebSocket(wsUrl, [], {
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
      /* TODO: Remove console.log */
      console.log('[Realtime] WebSocket connected');
      this.connected = true;

      // On reconnect, send local state to ensure bidirectional sync.
      // This ensures any edits made while disconnected are sent to the server,
      // where Yjs will merge them with the server's state and broadcast to other clients.
      if (this.hasConnectedOnce && this.ws) {
        const localState = Y.encodeStateAsUpdate(this.ydoc);
        console.log('[Realtime] Reconnect detected, sending local state, size:', localState.length);
        this.ws.send(localState);
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
        /* TODO: Remove console.log */
        console.log('[Realtime] Received message, update size:', update.length);

        // Apply remote update to local Y.Doc
        Y.applyUpdate(this.ydoc, update, 'remote');

        // Notify listeners of new snapshot
        const root = this.ydoc.getMap('root');
        const snapshot = root.toJSON() as Record<string, unknown>;
        console.log('[Realtime] Applied update, snapshot:', JSON.stringify(snapshot).slice(0, 200));
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

      // Check for authorization failure close codes (4401 Unauthorized, 4403 Forbidden)
      const closeEvent = event as CloseEvent;
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
        console.log('[Realtime] Page became visible, forcing reconnection to ensure fresh connection');

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
    if (this.ws) {
      this.intentionalDisconnect = true;
      this.stopReconnectMonitoring();
      this.stopVisibilityMonitoring();
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Apply a local Yjs update.
   * This is typically called from Puck-Yjs binding when local edits occur.
   *
   * @param update - Raw Yjs update bytes
   */
  applyLocalUpdate(update: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(update);
    }
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
    console.log('[Realtime] sendFocusRegions called:', focusRegions, 'ws:', !!this.ws, 'readyState:', this.ws?.readyState);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('[Realtime] Cannot send focus regions - WebSocket not ready');
      return false;
    }

    const message: WsFocusRegionUpdateMessage = {
      type: 'focus_region_update',
      focusRegions,
      timestamp: Date.now(),
    };

    console.log('[Realtime] Sending focus_region_update:', JSON.stringify(message));
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
          // Acknowledgment received - could add callback if needed
          console.log('[Realtime] Focus region ack:', message.success);
          break;

        case 'presence_error':
          console.error('[Realtime] Presence error:', message.code, message.message);
          break;

        default:
          console.warn('[Realtime] Unknown message type:', (message as { type: string }).type);
      }
    } catch (error) {
      console.error('[Realtime] Error parsing text message:', error);
    }
  }
}
