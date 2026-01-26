/**
 * Phase 3.2: useRealtime Hook
 *
 * React hook for real-time collaborative editing with Puck.
 * Manages WebSocket connection and Yjs CRDT synchronization.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { RealtimeClient } from '@pantheon/css-client';
import type { PuckData } from '@pantheon/css-client';
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

  /** Whether real-time is enabled */
  enabled?: boolean;

  /** Callback when remote changes arrive */
  onRemoteUpdate?: (data: PuckData) => void;
}

/**
 * Return value from the useRealtime hook.
 */
export interface UseRealtimeReturn {
  /** Whether currently connected to the real-time session */
  connected: boolean;

  /** Apply a local change (will be synced to other clients) */
  applyLocalChange: (data: PuckData) => void;

  /** Any error that occurred */
  error: Error | null;
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
    enabled = true,
    onRemoteUpdate,
  } = params;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs to avoid recreating callbacks
  const clientRef = useRef<RealtimeClient | null>(null);
  const bindingRef = useRef<ReturnType<typeof createPuckYjsBinding> | null>(null);
  const onRemoteUpdateRef = useRef(onRemoteUpdate);

  // Keep onRemoteUpdate ref up to date
  useEffect(() => {
    onRemoteUpdateRef.current = onRemoteUpdate;
  }, [onRemoteUpdate]);

  // Effect to manage connection lifecycle
  useEffect(() => {
    // Don't connect if disabled, no document path, or missing required params
    if (!enabled || !documentPath || !branchId || !siteId) {
      return;
    }

    // Create new client
    const client = new RealtimeClient({
      baseUrl,
      apiKey,
      onConnect: () => {
        setConnected(true);
        setError(null);
      },
      onDisconnect: () => {
        setConnected(false);
      },
      onError: (err) => {
        setError(err);
      },
      onUpdate: (snapshot) => {
        // This is called when the client receives a Yjs update from the server
        // We need to convert it to PuckData and notify the parent
        onRemoteUpdateRef.current?.(snapshot as unknown as PuckData);
      },
    });

    clientRef.current = client;

    // Create Puck-Yjs binding
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
    });

    // Cleanup on unmount or when dependencies change
    return () => {
      binding.destroy();
      bindingRef.current = null;
      client.disconnect();
      clientRef.current = null;
      setConnected(false);
    };
  }, [baseUrl, apiKey, siteId, branchId, documentPath, actorId, actorType, enabled]);

  // Apply local change function
  const applyLocalChange = useCallback((data: PuckData) => {
    if (bindingRef.current) {
      bindingRef.current.applyLocalChange(data as unknown as BindingPuckData);
    }
  }, [connected]);

  return {
    connected,
    applyLocalChange,
    error,
  };
}
