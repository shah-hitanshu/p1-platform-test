/**
 * Phase 2.1: RealtimeClient
 *
 * WebSocket-based real-time collaboration client using Yjs CRDT.
 * Provides bidirectional sync between client and DocumentSession Durable Object.
 */

import * as Y from 'yjs';

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
}

/**
 * Real-time collaboration client using Yjs CRDT over WebSocket.
 *
 * @example
 * ```typescript
 * const client = new RealtimeClient({
 *   baseUrl: 'wss://api.example.com',
 *   onUpdate: (snapshot) => {
 *     console.log('Document updated:', snapshot);
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
  private ws: WebSocket | null = null;
  private connected = false;

  constructor(config: RealtimeClientConfig) {
    this.config = config;
    this.ydoc = new Y.Doc();

    // Listen for local changes to broadcast
    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      // Only broadcast if this update didn't come from remote
      if (origin !== 'remote' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(update);
      }
    });
  }

  /**
   * Connect to a document session via WebSocket.
   *
   * @param params - Connection parameters including site, branch, document, and actor info
   */
  connect(params: ConnectionParams): void {
    if (this.ws) {
      this.disconnect();
    }

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

    this.ws = new WebSocket(url.toString());
    this.ws.binaryType = 'arraybuffer';

    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.config.onConnect?.();
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const data = event.data as ArrayBuffer;
        const update = new Uint8Array(data);

        // Apply remote update to local Y.Doc
        Y.applyUpdate(this.ydoc, update, 'remote');

        // Notify listeners of new snapshot
        const root = this.ydoc.getMap('root');
        const snapshot = root.toJSON() as Record<string, unknown>;
        this.config.onUpdate?.(snapshot);
      } catch (error) {
        this.config.onError?.(
          error instanceof Error ? error : new Error('Failed to process message'),
        );
      }
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.ws = null;
      this.config.onDisconnect?.();
    });

    this.ws.addEventListener('error', () => {
      this.config.onError?.(new Error('WebSocket error'));
    });
  }

  /**
   * Disconnect from the current session.
   */
  disconnect(): void {
    if (this.ws) {
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
}
