/**
 * Phase 3.2: useRealtime Hook
 *
 * React hook for real-time collaborative editing with Puck.
 * Manages WebSocket connection and Yjs CRDT synchronization.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { RealtimeClient } from '@pantheon/css-client';
import type { PuckData, ActorPresence, ActorState } from '@pantheon/css-client';
import {
  createPuckYjsBinding,
  type PuckData as BindingPuckData,
} from '../utils/puckYjsBinding.js';

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
}

/**
 * Return value from the useRealtime hook.
 */
export interface UseRealtimeReturn {
  /** Whether currently connected to the real-time session */
  connected: boolean;

  /** Apply a local change (will be synced to other clients) */
  applyLocalChange: (data: PuckData) => void;

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
  } = params;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [presenceViaWebSocket, setPresenceViaWebSocket] = useState(false);

  // Refs to avoid recreating callbacks
  const clientRef = useRef<RealtimeClient | null>(null);
  const bindingRef = useRef<ReturnType<typeof createPuckYjsBinding> | null>(null);
  const onRemoteUpdateRef = useRef(onRemoteUpdate);
  const onPresenceUpdateRef = useRef(onPresenceUpdate);
  const onFocusRegionBroadcastRef = useRef(onFocusRegionBroadcast);

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
      onConnect: () => {
        setConnected(true);
        setPresenceViaWebSocket(true);
        setError(null);
      },
      onDisconnect: () => {
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
      binding.destroy();
      bindingRef.current = null;
      client.disconnect();
      clientRef.current = null;
      setConnected(false);
      setPresenceViaWebSocket(false);
    };
  }, [baseUrl, apiKey, siteId, branchId, documentPath, actorId, actorType, sessionId, enabled]);

  // Apply local change function
  const applyLocalChange = useCallback((data: PuckData) => {
    if (bindingRef.current) {
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

  return {
    connected,
    applyLocalChange,
    getSnapshot,
    error,
    sendFocusRegions,
    sendHeartbeat,
    presenceViaWebSocket,
  };
}
