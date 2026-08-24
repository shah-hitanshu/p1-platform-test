/**
 * Phase 3.2: useRealtime Hook
 *
 * React hook for real-time collaborative editing with Puck.
 * Manages WebSocket connection and Yjs CRDT synchronization.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { RealtimeClient } from '@pantheon-systems/css-client';
import type { PuckData, ActorPresence, ActorState, PublishResult } from '@pantheon-systems/css-client';
import {
  createPuckYjsBinding,
  type PuckData as BindingPuckData,
} from './utils/puckYjsBinding.js';

/**
 * Parameters for the useRealtime hook.
 */
export interface UseRealtimeParams {
  /** WebSocket base URL (ws:// or wss://) */
  baseUrl: string;

  /** API key for authentication */
  apiKey?: string;

  /** Site ID */
  siteId: string;

  /** Branch ID */
  branchId: string;

  /** Document path (null means no document loaded yet) */
  documentPath: string | null;

  /** Actor ID (user or agent ID) */
  actorId: string;

  /** Actor type */
  actorType: 'user' | 'agent';

  /**
   * Session ID for agent authorization.
   * Obtained from startEdit() response.
   * When provided, enables server-side enforcement of Agent Politeness Protocol.
   */
  sessionId?: string;

  /**
   * Initial data to seed the Y.Doc with before connecting.
   * When provided, the Y.Doc will be populated with this data before
   * the WebSocket connects, allowing the server to send only a delta
   * instead of the full CRDT state. This eliminates the redundant
   * full-doc re-render on page load.
   *
   * Tracked via ref (not in effect deps) to avoid triggering reconnection
   * when data changes during editing.
   */
  initialData?: PuckData | null;

  /** Whether real-time is enabled */
  enabled?: boolean;

  /** Callback when remote changes arrive */
  onRemoteUpdate?: (data: PuckData) => void;

  /**
   * Callback when presence update is received from server via WebSocket.
   * Called with the full list of actors in the document.
   */
  onPresenceUpdate?: (actors: ActorPresence[]) => void;

  /**
   * Callback when another actor updates their focus regions.
   * Called with the actor ID and their new focus regions.
   */
  onFocusRegionBroadcast?: (actorId: string, focusRegions: string[]) => void;

  /**
   * Optional token refresher for WebSocket reconnection.
   * Called when the WebSocket connection closes unexpectedly.
   * Should return a fresh token or null if the session cannot be refreshed.
   */
  tokenRefresher?: () => Promise<string | null>;

  /**
   * Callback when the server sends close code 4001 (server-initiated reload).
   * Called after the local Y.Doc is cleared, before automatic reconnection.
   */
  onServerReload?: () => void;

  /**
   * Callback when the server closes with code 4002 (client lineage diverged).
   * Reconnection is halted; caller should reseed from REST and reconnect.
   */
  onBaselineReset?: () => void;

  /**
   * External reset key: incrementing this tears down the current client and
   * builds a fresh one with a new Y.Doc. Owned by the caller so that the REST
   * refetch can complete and update `initialData` BEFORE the new client seeds
   * its Y.Doc — preventing the new client from reseeding stale in-memory data.
   */
  resetKey?: number;
}

/**
 * Return value from the useRealtime hook.
 */
export interface UseRealtimeReturn {
  /** Whether currently connected to the real-time session */
  connected: boolean;

  /** Apply a local change (will be synced to other clients) */
  applyLocalChange: (data: PuckData, puckActions?: { type: string; [key: string]: unknown }[]) => void;

  /** Get the current snapshot from the Yjs document. Returns null if not connected. */
  getSnapshot: () => PuckData | null;

  /** Any error that occurred */
  error: Error | null;

  /**
   * Send focus regions update to the server.
   * @param regions - JSON paths the actor is focused on
   * @returns true if message was sent, false if not connected
   */
  sendFocusRegions: (regions: string[]) => boolean;

  /**
   * Send a presence heartbeat to keep the connection alive.
   * @param state - Optional state update (active, idle, editing)
   */
  sendHeartbeat: (state?: ActorState) => void;

  /**
   * Whether presence updates are available via WebSocket.
   * Returns true when connected and able to send/receive presence messages.
   */
  presenceViaWebSocket: boolean;

  /**
   * The document path that the realtime connection is currently bound to.
   * Captured at the moment of connection establishment. Returns null when
   * disconnected or during connection transitions. Used by callers to verify
   * that data being sent matches the active connection's document.
   */
  connectedDocumentPath: string | null;

  /**
   * Wait for the server to acknowledge that all preceding WebSocket messages
   * have been processed. Used before publish to ensure the DO has the latest edits.
   * @returns Promise that resolves when the server confirms delivery
   * @throws Error if not connected or if timeout expires
   */
  waitForDelivery: () => Promise<void>;

  /**
   * Request the server to publish the current document via WebSocket.
   * The Durable Object handles flush + publish internally, eliminating
   * client-side orchestration and race conditions.
   * @returns Promise that resolves with the publish result
   * @throws Error if not connected or if timeout expires
   */
  requestPublish: () => Promise<PublishResult>;
}

/**
 * Hook for real-time collaborative editing with Puck.
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const realtime = useRealtime({
 *     baseUrl: 'wss://api.example.com',
 *     siteId: 'site-123',
 *     branchId: 'branch-456',
 *     documentPath: 'pages/home',
 *     actorId: 'user-789',
 *     actorType: 'user',
 *     enabled: true,
 *     onRemoteUpdate: (data) => setPuckData(data),
 *   });
 *
 *   return (
 *     <Puck
 *       data={puckData}
 *       onChange={(data) => {
 *         setPuckData(data);
 *         realtime.applyLocalChange(data);
 *       }}
 *     />
 *   );
 * }
 * ```
 */
export function useRealtime(params: UseRealtimeParams): UseRealtimeReturn {
  const {
    baseUrl,
    apiKey,
    tokenRefresher,
    siteId,
    branchId,
    documentPath,
    actorId,
    actorType,
    sessionId,
    enabled = true,
    onRemoteUpdate,
    onPresenceUpdate,
    onFocusRegionBroadcast,
    onServerReload,
    onBaselineReset,
    resetKey = 0,
  } = params;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [presenceViaWebSocket, setPresenceViaWebSocket] = useState(false);

  // Track the document path that the active connection is bound to.
  // Captured at connection time, cleared on disconnect. Used to prevent
  // cross-document state bleed: callers can compare this against their
  // current document path before sending data through the binding.
  const connectedDocumentPathRef = useRef<string | null>(null);

  // Refs to avoid recreating callbacks
  const clientRef = useRef<RealtimeClient | null>(null);
  const bindingRef = useRef<ReturnType<typeof createPuckYjsBinding> | null>(null);
  const onRemoteUpdateRef = useRef(onRemoteUpdate);
  const onPresenceUpdateRef = useRef(onPresenceUpdate);
  const onFocusRegionBroadcastRef = useRef(onFocusRegionBroadcast);
  const onServerReloadRef = useRef(onServerReload);
  const onBaselineResetRef = useRef(onBaselineReset);
  // Keep tokenRefresher in a ref so the RealtimeClient always calls the
  // latest version without needing to be recreated on reference changes.
  const tokenRefresherRef = useRef(tokenRefresher);
  tokenRefresherRef.current = tokenRefresher;

  const initialDataRef = useRef(params.initialData);
  // Keep ref in sync but do NOT add to effect deps — changing data
  // during editing must not trigger a WebSocket reconnection.
  initialDataRef.current = params.initialData;

  // Keep callback refs up to date
  useEffect(() => {
    onRemoteUpdateRef.current = onRemoteUpdate;
  }, [onRemoteUpdate]);

  useEffect(() => {
    onPresenceUpdateRef.current = onPresenceUpdate;
  }, [onPresenceUpdate]);

  useEffect(() => {
    onFocusRegionBroadcastRef.current = onFocusRegionBroadcast;
  }, [onFocusRegionBroadcast]);

  useEffect(() => {
    onServerReloadRef.current = onServerReload;
  }, [onServerReload]);

  useEffect(() => {
    onBaselineResetRef.current = onBaselineReset;
  }, [onBaselineReset]);

  // Eagerly clean up binding and client refs when dependencies change.
  // useLayoutEffect cleanup runs BEFORE regular useEffect callbacks (including
  // children's effects like PuckDataSynchronizer). This prevents a race condition
  // where PuckDataSynchronizer dispatches setData during a document switch, Puck
  // fires onChange, and saveData sends data through a stale binding that still
  // points to the previous document's Y.Doc — causing cross-document state bleed.
  useLayoutEffect(() => {
    return () => {
      connectedDocumentPathRef.current = null;
      bindingRef.current?.destroy();
      bindingRef.current = null;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [baseUrl, apiKey, siteId, branchId, documentPath, actorId, actorType, sessionId, enabled, resetKey]);

  // Effect to manage connection lifecycle
  useEffect(() => {
    // Don't connect if disabled, no document path, or missing required params
    if (!enabled || !documentPath || !branchId || !siteId) {
      return;
    }

    // Create new client
    // NOTE: We don't use RealtimeClient.onUpdate because it would cause double callbacks.
    // The Puck-Yjs binding observer already handles remote updates properly by checking
    // transaction origin to distinguish local vs remote changes.
    const client = new RealtimeClient({
      baseUrl,
      apiKey,
      // Use ref-wrapped refresher so the client always calls the latest version
      // without needing to be recreated when the function reference changes.
      tokenRefresher: tokenRefresherRef.current
        ? () => {
            const refresher = tokenRefresherRef.current;
            return refresher ? refresher() : Promise.resolve(null);
          }
        : undefined,
      onConnect: () => {
        // Guard: ignore callbacks from stale clients.
        // When dependencies change, the old client is destroyed and a new one
        // created. The old WebSocket's close event fires asynchronously and may
        // arrive AFTER the new client has already connected. Without this guard,
        // the stale onDisconnect would overwrite the new client's connection
        // state (connectedDocumentPathRef, connected, presenceViaWebSocket),
        // permanently breaking sync in one direction and corrupting presence.
        if (clientRef.current !== client) return;

        // Capture the document path this connection is bound to.
        // documentPath here is from the effect closure — it's the value
        // that was current when this effect ran, which is the document
        // the WebSocket was created for.
        connectedDocumentPathRef.current = documentPath;
        setConnected(true);
        setPresenceViaWebSocket(true);
        setError(null);
      },
      onDisconnect: () => {
        // Guard: ignore callbacks from stale clients (see onConnect comment).
        if (clientRef.current !== client) return;
        connectedDocumentPathRef.current = null;
        setConnected(false);
        setPresenceViaWebSocket(false);
      },
      onError: (err) => {
        setError(err);
      },
      // onUpdate intentionally omitted - binding handles this
      onPresenceUpdate: (actors) => {
        onPresenceUpdateRef.current?.(actors);
      },
      onFocusRegionBroadcast: (actorId, focusRegions) => {
        onFocusRegionBroadcastRef.current?.(actorId, focusRegions);
      },
      onServerReload: () => {
        onServerReloadRef.current?.();
      },
      onBaselineReset: () => {
        // Guard: ignore callbacks from stale clients (see onConnect comment).
        if (clientRef.current !== client) return;
        // The caller owns resetKey — it must refetch from REST and then increment
        // its key so initialData is fresh before the new Y.Doc seeds itself.
        onBaselineResetRef.current?.();
      },
    });

    clientRef.current = client;

    // Create Puck-Yjs binding - this is the ONLY place that calls onRemoteUpdate
    // The binding observes Yjs changes and filters out local changes (origin === 'local')
    const binding = createPuckYjsBinding(
      client.getYDoc(),
      (data: BindingPuckData) => {
        onRemoteUpdateRef.current?.(data as unknown as PuckData);
      },
    );
    bindingRef.current = binding;

    // Seed Y.Doc with initial REST data before connecting.
    // This populates the client's Y.Doc so the server can send a delta
    // instead of the full CRDT state on initial connect.
    // Safe because:
    // - applyLocalChange uses LOCAL_ORIGIN (observer ignores local changes)
    // - this.ws is null at this point (update listener won't try to send)
    if (initialDataRef.current) {
      binding.applyLocalChange(initialDataRef.current as unknown as BindingPuckData);
    }

    // Connect to the document session
    client.connect({
      siteId,
      branchId,
      documentPath,
      actorId,
      actorType,
      sessionId,
    });

    // Cleanup on unmount or when dependencies change
    return () => {
      connectedDocumentPathRef.current = null;
      binding.destroy();
      bindingRef.current = null;
      client.disconnect();
      clientRef.current = null;
      setConnected(false);
      setPresenceViaWebSocket(false);
    };
  }, [baseUrl, apiKey, siteId, branchId, documentPath, actorId, actorType, sessionId, enabled, resetKey]);

  // Apply local change function
  const applyLocalChange = useCallback((data: PuckData, puckActions?: { type: string; [key: string]: unknown }[]) => {
    if (bindingRef.current) {
      if (puckActions && puckActions.length > 0 && clientRef.current) {
        clientRef.current.setActionMetadata(puckActions);
      }
      bindingRef.current.applyLocalChange(data as unknown as BindingPuckData);
    }
  }, [connected]);

  // Get current snapshot from Yjs document
  const getSnapshot = useCallback((): PuckData | null => {
    if (clientRef.current) {
      const snapshot = clientRef.current.getSnapshot();
      if (snapshot && (snapshot.content || snapshot.root)) {
        return snapshot as unknown as PuckData;
      }
    }
    return null;
  }, []);

  // Send focus regions update to server
  const sendFocusRegions = useCallback((regions: string[]): boolean => {
    if (clientRef.current) {
      return clientRef.current.sendFocusRegions(regions);
    }
    return false;
  }, []);

  // Send presence heartbeat to server
  const sendHeartbeat = useCallback((state?: ActorState): void => {
    if (clientRef.current) {
      clientRef.current.sendHeartbeat(state);
    }
  }, []);

  // Wait for delivery acknowledgment from server
  const waitForDelivery = useCallback((): Promise<void> => {
    if (clientRef.current) {
      return clientRef.current.waitForDelivery();
    }
    return Promise.reject(new Error('Not connected'));
  }, []);

  // Request publish via WebSocket (DO handles flush + publish)
  const requestPublish = useCallback((): Promise<PublishResult> => {
    if (clientRef.current) {
      return clientRef.current.requestPublish();
    }
    return Promise.reject(new Error('Not connected'));
  }, []);

  return {
    connected,
    applyLocalChange,
    getSnapshot,
    error,
    sendFocusRegions,
    sendHeartbeat,
    presenceViaWebSocket,
    connectedDocumentPath: connectedDocumentPathRef.current,
    waitForDelivery,
    requestPublish,
  };
}
