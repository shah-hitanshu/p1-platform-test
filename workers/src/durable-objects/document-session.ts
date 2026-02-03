/**
 * Phase 4.1: DocumentSession Durable Object
 *
 * Manages real-time collaborative editing for a single document on a branch.
 * Uses Yjs CRDT for conflict-free concurrent editing.
 *
 * Session Identifier Format: {siteId}:{documentId}:{branchId}
 *
 * Endpoints:
 * - /connect: WebSocket for real-time collaboration
 * - /snapshot: Get current document state + connected actors
 * - /apply: Apply edit operations programmatically (for agents)
 */

import * as Y from 'yjs';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { EditOperation, ConnectionMeta } from '../types';
import { incrementCounter, setGauge } from '../services/metrics-service';

/**
 * Storage key for persisted Yjs document state
 */
const YDOC_STORAGE_KEY = 'ydoc';

/**
 * Valid edit operation types
 */
const VALID_OPERATION_TYPES = ['set', 'delete', 'insert', 'move', 'replace'] as const;

// =============================================================================
// Security Limits
// =============================================================================

/** Maximum number of operations in a single /apply request */
const MAX_OPERATIONS_PER_REQUEST = 1000;

/** Maximum number of concurrent WebSocket connections */
const MAX_WEBSOCKET_CONNECTIONS = 100;

/** Maximum WebSocket message size in bytes (1MB) */
const MAX_WEBSOCKET_MESSAGE_SIZE = 1024 * 1024;

/** Maximum actor ID length */
const MAX_ACTOR_ID_LENGTH = 128;

/** Maximum path depth for nested operations */
const MAX_PATH_DEPTH = 50;

/** Maximum object nesting depth for values */
const MAX_VALUE_DEPTH = 50;

/** Regex for valid actor ID format (alphanumeric, hyphens, underscores) */
const ACTOR_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Session information parsed from the Durable Object ID
 */
interface SessionInfo {
  siteId: string;
  documentId: string;
  branchId: string;
}

/**
 * Request body for the /apply endpoint
 */
interface ApplyRequest {
  operations: EditOperation[];
  actorId: string;
}

/**
 * Response from the /snapshot endpoint
 */
interface SnapshotResponse {
  snapshot: Record<string, unknown>;
  stateVector: number[];
  connectedActors: ConnectionMeta[];
}

/**
 * Response from the /apply endpoint
 */
interface ApplyResponse {
  success: boolean;
  snapshot?: Record<string, unknown>;
  operationsApplied?: number;
  error?: string;
}

/**
 * Response from the /sync endpoint
 */
interface SyncResponse {
  synced: boolean;
  snapshot: Record<string, unknown>;
  stateVector: number[];
}

/**
 * Environment interface for DocumentSession
 */
interface DocumentSessionEnv {
  API_URL?: string;
  ENVIRONMENT?: string;
  /** Internal API URL for syncing to PostgreSQL */
  INTERNAL_API_URL?: string;
  /** Shared secret for internal API authentication */
  INTERNAL_SECRET?: string;
}

/**
 * Idle timeout before syncing to PostgreSQL (in milliseconds)
 * Sync triggers after 5 seconds of no edits
 */
const SYNC_IDLE_TIMEOUT_MS = 5000;

/**
 * DocumentSession Durable Object
 *
 * Each instance manages CRDT state for a single document on a single branch.
 * Multiple users can connect via WebSocket for real-time collaboration.
 */
export class DocumentSession {
  private readonly state: DurableObjectState;
  private readonly env: DocumentSessionEnv;
  private readonly sessionInfo: SessionInfo;
  private ydoc: Y.Doc;
  private connections: Map<WebSocket, ConnectionMeta>;
  private initialized: boolean;

  /** Timer for idle sync (cleared on each edit, fires after SYNC_IDLE_TIMEOUT_MS) */
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  /** Actor ID of the last edit (used for sync attribution) */
  private lastEditActorId = 'system';

  /** Actor type of the last edit */
  private lastEditActorType: 'user' | 'agent' = 'user';

  constructor(state: unknown, env: unknown) {
    this.state = state as DurableObjectState;
    this.env = env as DocumentSessionEnv;
    this.sessionInfo = this.parseSessionId();
    this.ydoc = new Y.Doc();
    this.connections = new Map();
    this.initialized = false;
  }

  /**
   * Parse session identifier from Durable Object ID
   * Format: {siteId}:{documentId}:{branchId}
   */
  private parseSessionId(): SessionInfo {
    const id = this.state.id.toString();
    const parts = id.split(':');

    if (parts.length >= 3) {
      return {
        siteId: parts[0],
        documentId: parts[1],
        branchId: parts[2],
      };
    }

    // Default values for malformed IDs (shouldn't happen in practice)
    return {
      siteId: 'unknown',
      documentId: 'unknown',
      branchId: 'unknown',
    };
  }

  /**
   * Get session information (siteId, documentId, branchId)
   */
  getSessionInfo(): SessionInfo {
    return this.sessionInfo;
  }

  /**
   * Get current connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Main fetch handler - routes requests to appropriate handlers
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Ensure state is initialized before handling requests
      await this.initializeIfNeeded();

      switch (path) {
        case '/snapshot':
          return this.handleSnapshot();

        case '/apply':
          return await this.handleApplyOperations(request);

        case '/connect':
          return this.handleWebSocket(request);

        case '/sync':
          return await this.handleSync(request);

        case '/initialize':
          return await this.handleInitialize(request);

        default:
          return new Response(
            JSON.stringify({ error: 'Not Found', path }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
      }
    } catch (error) {
      console.error('DocumentSession error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  /**
   * Initialize CRDT state from storage if not already done.
   * Falls back to PostgreSQL if DO storage is empty and internal API is configured.
   */
  private async initializeIfNeeded(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const stored = await this.state.storage.get(YDOC_STORAGE_KEY);

    if (stored instanceof Uint8Array && stored.length > 0) {
      // Priority 1: Use DO storage
      try {
        Y.applyUpdate(this.ydoc, stored);
        this.initialized = true;
        return;
      } catch (error) {
        // Invalid stored data - log and try PostgreSQL fallback
        console.warn('Failed to restore CRDT state from storage:', error);
      }
    }

    // Priority 2: Try to load from PostgreSQL if configured
    if (this.env.INTERNAL_API_URL !== undefined && this.env.INTERNAL_SECRET !== undefined) {
      try {
        await this.initializeFromPostgres();
      } catch (error) {
        console.warn('Failed to initialize from PostgreSQL:', error);
        // Continue with empty state
      }
    }

    this.initialized = true;
  }

  /**
   * Load initial state from PostgreSQL via internal API.
   * Called when DO storage is empty but PostgreSQL may have data.
   */
  private async initializeFromPostgres(): Promise<void> {
    if (this.env.INTERNAL_API_URL === undefined || this.env.INTERNAL_SECRET === undefined) {
      return;
    }

    const { siteId, documentId, branchId } = this.sessionInfo;

    // Skip initialization for unknown/invalid session IDs
    if (siteId === 'unknown' || documentId === 'unknown' || branchId === 'unknown') {
      return;
    }

    const url = new URL(`${this.env.INTERNAL_API_URL}/internal/crdt-state`);
    url.searchParams.set('siteId', siteId);
    url.searchParams.set('documentPath', documentId);
    url.searchParams.set('branchId', branchId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Internal-Secret': this.env.INTERNAL_SECRET,
      },
    });

    if (!response.ok) {
      // 404 is expected for new documents - just continue with empty state
      if (response.status === 404) {
        return;
      }
      throw new Error(`Failed to load from PostgreSQL: ${String(response.status)}`);
    }

    const rawData = await response.json();
    const data = rawData as {
      found: boolean;
      snapshot?: Record<string, unknown>;
      crdtState?: string | null;
    };

    if (!data.found) {
      return;
    }

    // Apply CRDT state if available (preferred)
    if (typeof data.crdtState === 'string' && data.crdtState !== '') {
      const bytes = this.base64ToUint8Array(data.crdtState);
      Y.applyUpdate(this.ydoc, bytes);
      console.log(`Initialized document ${documentId} from PostgreSQL CRDT state`);
      // Persist to DO storage for future use
      await this.persist();
      return;
    }

    // Fall back to snapshot if no CRDT state
    if (data.snapshot !== undefined && typeof data.snapshot === 'object') {
      const root = this.ydoc.getMap('root');
      this.applySnapshotToYMap(root, data.snapshot);
      console.log(`Initialized document ${documentId} from PostgreSQL snapshot`);
      // Persist to DO storage for future use
      await this.persist();
    }
  }

  /**
   * Apply a JSON snapshot to a Y.Map (recursive)
   */
  private applySnapshotToYMap(ymap: Y.Map<unknown>, snapshot: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === null || value === undefined) {
        ymap.set(key, value);
      } else if (Array.isArray(value)) {
        const yarray = new Y.Array();
        for (const item of value) {
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const nestedMap = new Y.Map();
            this.applySnapshotToYMap(nestedMap, item as Record<string, unknown>);
            yarray.push([nestedMap]);
          } else {
            yarray.push([item]);
          }
        }
        ymap.set(key, yarray);
      } else if (typeof value === 'object') {
        const nestedMap = new Y.Map();
        this.applySnapshotToYMap(nestedMap, value as Record<string, unknown>);
        ymap.set(key, nestedMap);
      } else {
        ymap.set(key, value);
      }
    }
  }

  /**
   * Handle /snapshot endpoint
   * Returns current document state and connected actors
   */
  private handleSnapshot(): Response {
    const root = this.ydoc.getMap('root');
    const snapshot = root.toJSON() as Record<string, unknown>;
    const stateVector = Array.from(Y.encodeStateVector(this.ydoc));
    const connectedActors = Array.from(this.connections.values());

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
   * Handle /apply endpoint
   * Applies edit operations programmatically (for agents or API clients)
   */
  private async handleApplyOperations(request: Request): Promise<Response> {
    // Parse request body
    let body: ApplyRequest;
    try {
      body = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON in request body');
    }

    // Validate actorId
    if (!body.actorId) {
      return this.errorResponse(400, 'actorId is required');
    }

    // Security: Validate actorId format
    const actorIdError = this.validateActorId(body.actorId);
    if (actorIdError !== null) {
      return this.errorResponse(400, actorIdError);
    }

    // Validate operations array
    if (!Array.isArray(body.operations)) {
      return this.errorResponse(400, 'operations must be an array');
    }

    // Security: Limit operations per request
    if (body.operations.length > MAX_OPERATIONS_PER_REQUEST) {
      return this.errorResponse(400, `Too many operations. Maximum is ${String(MAX_OPERATIONS_PER_REQUEST)}`);
    }

    // Handle empty operations array
    if (body.operations.length === 0) {
      const root = this.ydoc.getMap('root');
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
        return this.errorResponse(400, `Invalid operation type: ${op.type}`);
      }

      // Validate operation has required fields
      const opError = this.validateOperation(op);
      if (opError !== null) {
        return this.errorResponse(400, opError);
      }
    }

    // Apply operations within a transaction
    try {
      this.ydoc.transact(() => {
        for (const op of body.operations) {
          this.applyOperation(op);
        }
      }, body.actorId);
    } catch (error) {
      return this.errorResponse(400, `Failed to apply operations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Persist state
    try {
      await this.persist();
    } catch {
      return this.errorResponse(500, 'Failed to persist state');
    }

    // Broadcast update to connected clients
    const update = Y.encodeStateAsUpdate(this.ydoc);
    this.broadcastUpdate(update);

    // Schedule sync to PostgreSQL after idle timeout
    this.scheduleSync(body.actorId, 'user');

    const root = this.ydoc.getMap('root');
    const response: ApplyResponse = {
      success: true,
      snapshot: root.toJSON() as Record<string, unknown>,
      operationsApplied: body.operations.length,
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Handle /connect endpoint for WebSocket connections
   */
  private handleWebSocket(request: Request): Response {
    // Get actor info from headers OR query params (browsers can't send custom headers with WebSocket)
    const url = new URL(request.url);
    const actorId = request.headers.get('X-Actor-Id') ?? url.searchParams.get('actorId');
    const actorType = request.headers.get('X-Actor-Type') ?? url.searchParams.get('actorType');

    if (actorId === null || actorId === '') {
      return this.errorResponse(400, 'actorId is required (via X-Actor-Id header or actorId query param)');
    }

    if (actorType === null || actorType === '') {
      return this.errorResponse(400, 'actorType is required (via X-Actor-Type header or actorType query param)');
    }

    if (actorType !== 'user' && actorType !== 'agent') {
      return this.errorResponse(400, 'actorType must be "user" or "agent"');
    }

    // Security: Validate actorId format
    const actorIdError = this.validateActorId(actorId);
    if (actorIdError !== null) {
      return this.errorResponse(400, actorIdError);
    }

    // Security: Limit concurrent connections
    if (this.connections.size >= MAX_WEBSOCKET_CONNECTIONS) {
      return this.errorResponse(503, 'Too many connections. Try again later.');
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

    // Accept the WebSocket connection
    server.accept();

    // Store connection metadata
    const meta: ConnectionMeta = {
      actorId,
      actorType: actorType,
    };
    this.connections.set(server, meta);

    // Record WebSocket connection metrics
    incrementCounter('css_ws_connections_total', { action: 'open' });
    setGauge('css_ws_connections_active', this.connections.size);

    // Send current state to new client
    const stateUpdate = Y.encodeStateAsUpdate(this.ydoc);
    server.send(stateUpdate);

    // Handle incoming messages
    server.addEventListener('message', async (event) => {
      try {
        const data = event.data as ArrayBuffer;

        // Security: Limit message size
        if (data.byteLength > MAX_WEBSOCKET_MESSAGE_SIZE) {
          console.warn(`WebSocket message too large: ${String(data.byteLength)} bytes`);
          return;
        }

        const update = new Uint8Array(data);

        // Apply update to local doc
        Y.applyUpdate(this.ydoc, update);

        // Broadcast to other clients
        for (const [conn] of this.connections) {
          if (conn !== server && conn.readyState === WebSocket.OPEN) {
            conn.send(update);
          }
        }

        // Persist state
        await this.persist();

        // Schedule sync to PostgreSQL after idle timeout
        this.scheduleSync(meta.actorId, meta.actorType);
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    });

    // Handle connection close
    server.addEventListener('close', () => {
      this.connections.delete(server);
      incrementCounter('css_ws_connections_total', { action: 'close' });
      setGauge('css_ws_connections_active', this.connections.size);

      // If this was the last connection, trigger immediate sync to PostgreSQL
      if (this.connections.size === 0) {
        void this.syncToPostgres();
      }
    });

    server.addEventListener('error', () => {
      this.connections.delete(server);
      incrementCounter('css_ws_connections_total', { action: 'close' });
      setGauge('css_ws_connections_active', this.connections.size);

      // If this was the last connection, trigger immediate sync to PostgreSQL
      if (this.connections.size === 0) {
        void this.syncToPostgres();
      }
    });

    // Return the client side of the WebSocket
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle /sync endpoint
   * Manually trigger sync to PostgreSQL (via internal API)
   * Returns current state after sync
   */
  private async handleSync(request: Request): Promise<Response> {
    // Only accept POST method
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed. Use POST.');
    }

    // Persist to DO storage first
    try {
      await this.persist();
    } catch (error) {
      return this.errorResponse(500, `Failed to persist state: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Sync to PostgreSQL via internal API
    await this.syncToPostgres();

    const root = this.ydoc.getMap('root');
    const response: SyncResponse = {
      synced: true,
      snapshot: root.toJSON() as Record<string, unknown>,
      stateVector: Array.from(Y.encodeStateVector(this.ydoc)),
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Handle /initialize endpoint
   * Initialize CRDT state from PostgreSQL snapshot or CRDT state
   * Used when DO storage is empty but PostgreSQL has data
   */
  private async handleInitialize(request: Request): Promise<Response> {
    // Only accept POST method
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed. Use POST.');
    }

    // Parse request body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON in request body');
    }

    // Validate body structure
    if (typeof rawBody !== 'object' || rawBody === null) {
      return this.errorResponse(400, 'Request body must be an object');
    }

    const body = rawBody as Record<string, unknown>;

    // Validate snapshot is present
    if (body.snapshot === null || body.snapshot === undefined || typeof body.snapshot !== 'object') {
      return this.errorResponse(400, 'snapshot is required and must be an object');
    }

    const snapshot = body.snapshot as Record<string, unknown>;
    const crdtState = typeof body.crdtState === 'string' ? body.crdtState : null;

    try {
      if (crdtState !== null && crdtState !== '') {
        // Initialize from CRDT state (base64 encoded)
        const crdtBytes = this.base64ToUint8Array(crdtState);
        Y.applyUpdate(this.ydoc, crdtBytes);
      } else {
        // Initialize from JSON snapshot
        this.initializeFromSnapshot(snapshot);
      }

      // Persist the initialized state
      await this.persist();

      const root = this.ydoc.getMap('root');
      return new Response(
        JSON.stringify({
          success: true,
          snapshot: root.toJSON(),
          stateVector: Array.from(Y.encodeStateVector(this.ydoc)),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      return this.errorResponse(500, `Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Initialize Y.Doc from a JSON snapshot
   */
  private initializeFromSnapshot(snapshot: Record<string, unknown>): void {
    const root = this.ydoc.getMap('root');

    // Clear existing data
    for (const key of root.keys()) {
      root.delete(key);
    }

    // Apply snapshot
    this.ydoc.transact(() => {
      for (const [key, value] of Object.entries(snapshot)) {
        root.set(key, this.toYjsValue(value));
      }
    }, 'initialize');
  }

  /**
   * Decode base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Apply a single edit operation to the CRDT
   */
  private applyOperation(op: EditOperation): void {
    const root = this.ydoc.getMap('root');

    switch (op.type) {
      case 'set':
        this.setNestedValue(root, op.path, op.value);
        break;

      case 'delete':
        this.deleteNestedValue(root, op.path);
        break;

      case 'insert':
        if (op.index !== undefined) {
          this.insertIntoArray(root, op.path, op.index, op.value);
        }
        break;

      case 'move':
        if (op.fromIndex !== undefined && op.toIndex !== undefined) {
          this.moveInArray(root, op.path, op.fromIndex, op.toIndex);
        }
        break;

      case 'replace':
        this.setNestedValue(root, op.path, op.content);
        break;
    }
  }

  /**
   * Set a value at a nested path in the Yjs document
   * Path format: "key1.key2.key3"
   */
  private setNestedValue(root: Y.Map<unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Y.Map<unknown> = root;

    // Navigate to parent, creating maps as needed
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      let next = current.get(key);

      if (!(next instanceof Y.Map)) {
        next = new Y.Map();
        current.set(key, next);
      }

      current = next as Y.Map<unknown>;
    }

    // Set the final value
    const finalKey = parts[parts.length - 1];
    current.set(finalKey, this.toYjsValue(value));
  }

  /**
   * Delete a value at a nested path
   */
  private deleteNestedValue(root: Y.Map<unknown>, path: string): void {
    const parts = path.split('.');
    let current: Y.Map<unknown> = root;

    // Navigate to parent
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const next = current.get(key);

      if (!(next instanceof Y.Map)) {
        return; // Path doesn't exist
      }

      current = next as Y.Map<unknown>;
    }

    // Delete the final key
    const finalKey = parts[parts.length - 1];
    current.delete(finalKey);
  }

  /**
   * Insert a value into an array at the given path and index
   */
  private insertIntoArray(root: Y.Map<unknown>, path: string, index: number, value: unknown): void {
    const arr = this.getArrayAtPath(root, path);
    if (arr) {
      arr.insert(index, [this.toYjsValue(value)]);
    }
  }

  /**
   * Move an element within an array
   */
  private moveInArray(root: Y.Map<unknown>, path: string, fromIndex: number, toIndex: number): void {
    const arr = this.getArrayAtPath(root, path);
    if (arr && fromIndex < arr.length) {
      // Get the item to move
      const item = arr.get(fromIndex);

      // Remove from old position
      arr.delete(fromIndex, 1);

      // Adjust toIndex if necessary (after removal)
      const adjustedToIndex = toIndex > fromIndex ? toIndex : toIndex;

      // Insert at new position
      arr.insert(adjustedToIndex, [item]);
    }
  }

  /**
   * Get or create a Y.Array at the given path
   */
  private getArrayAtPath(root: Y.Map<unknown>, path: string): Y.Array<unknown> | null {
    const parts = path.split('.');
    let current: Y.Map<unknown> = root;

    // Navigate to parent
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      let next = current.get(key);

      if (!(next instanceof Y.Map)) {
        next = new Y.Map();
        current.set(key, next);
      }

      current = next as Y.Map<unknown>;
    }

    const finalKey = parts[parts.length - 1];
    let arr = current.get(finalKey);

    if (!(arr instanceof Y.Array)) {
      // If it's a regular array, convert it
      if (Array.isArray(arr)) {
        const yArray = new Y.Array();
        yArray.push(arr.map((item) => this.toYjsValue(item)));
        current.set(finalKey, yArray);
        arr = yArray;
      } else {
        return null;
      }
    }

    return arr as Y.Array<unknown>;
  }

  /**
   * Convert a JavaScript value to a Yjs-compatible value
   * @param value The value to convert
   * @param depth Current recursion depth (for limiting)
   */
  private toYjsValue(value: unknown, depth = 0): unknown {
    // Security: Limit recursion depth
    if (depth > MAX_VALUE_DEPTH) {
      console.warn(`Value exceeds maximum depth of ${String(MAX_VALUE_DEPTH)}`);
      return null;
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        const arr = new Y.Array();
        arr.push(value.map((item) => this.toYjsValue(item, depth + 1)));
        return arr;
      } else {
        const map = new Y.Map();
        for (const [k, v] of Object.entries(value)) {
          map.set(k, this.toYjsValue(v, depth + 1));
        }
        return map;
      }
    }

    return value;
  }

  /**
   * Persist CRDT state to durable storage
   */
  private async persist(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.ydoc);
    await this.state.storage.put(YDOC_STORAGE_KEY, update);
  }

  // =============================================================================
  // PostgreSQL Sync Methods
  // =============================================================================

  /**
   * Schedule a sync to PostgreSQL after idle timeout.
   * Resets the timer on each call (debouncing).
   *
   * @param actorId - ID of the actor making the edit
   * @param actorType - Type of actor ('user' or 'agent')
   */
  private scheduleSync(actorId: string, actorType: 'user' | 'agent'): void {
    // Store actor info for sync attribution
    this.lastEditActorId = actorId;
    this.lastEditActorType = actorType;

    // Clear existing timer (debounce)
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
    }

    // Only schedule if we have internal API configured
    if (this.env.INTERNAL_API_URL === undefined || this.env.INTERNAL_SECRET === undefined) {
      return;
    }

    // Schedule sync after idle timeout
    this.syncTimer = setTimeout(() => {
      void this.syncToPostgres();
    }, SYNC_IDLE_TIMEOUT_MS);
  }

  /**
   * Sync current CRDT state to PostgreSQL via the internal API.
   * Called after idle timeout or on last client disconnect.
   */
  private async syncToPostgres(): Promise<void> {
    // Clear timer since we're syncing now
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    // Check if internal API is configured
    if (this.env.INTERNAL_API_URL === undefined || this.env.INTERNAL_SECRET === undefined) {
      console.log('Sync skipped: INTERNAL_API_URL or INTERNAL_SECRET not configured');
      return;
    }

    try {
      const root = this.ydoc.getMap('root');
      const snapshot = root.toJSON() as Record<string, unknown>;
      const crdtState = this.uint8ArrayToBase64(Y.encodeStateAsUpdate(this.ydoc));

      const syncUrl = `${this.env.INTERNAL_API_URL}/internal/crdt-sync`;

      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': this.env.INTERNAL_SECRET,
        },
        body: JSON.stringify({
          siteId: this.sessionInfo.siteId,
          documentId: this.sessionInfo.documentId,
          branchId: this.sessionInfo.branchId,
          snapshot,
          crdtState,
          actorId: this.lastEditActorId,
          actorType: this.lastEditActorType,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Sync to PostgreSQL failed: ${String(response.status)} ${errorText}`);
      } else {
        console.log(`Synced document ${this.sessionInfo.documentId} to PostgreSQL`);
      }
    } catch (error) {
      console.error('Error syncing to PostgreSQL:', error);
    }
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  /**
   * Broadcast an update to all connected clients
   */
  private broadcastUpdate(update: Uint8Array): void {
    for (const [conn] of this.connections) {
      if (conn.readyState === WebSocket.OPEN) {
        conn.send(update);
      }
    }
  }

  /**
   * Create an error response
   */
  private errorResponse(status: number, message: string): Response {
    const response: ApplyResponse = {
      success: false,
      error: message,
    };
    return new Response(
      JSON.stringify(response),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // =============================================================================
  // Security Validation Helpers
  // =============================================================================

  /**
   * Validate actor ID format
   * Returns error message if invalid, null if valid
   */
  private validateActorId(actorId: string): string | null {
    if (actorId.length > MAX_ACTOR_ID_LENGTH) {
      return `actorId exceeds maximum length of ${String(MAX_ACTOR_ID_LENGTH)}`;
    }

    if (!ACTOR_ID_PATTERN.test(actorId)) {
      return 'actorId contains invalid characters. Only alphanumeric, hyphens, and underscores allowed.';
    }

    return null;
  }

  /**
   * Validate an edit operation has required fields
   * Returns error message if invalid, null if valid
   */
  private validateOperation(op: EditOperation): string | null {
    // All operations require a path
    if (typeof op.path !== 'string' || op.path === '') {
      return `Operation ${op.type} requires a non-empty path`;
    }

    // Validate path format
    const pathError = this.validatePath(op.path);
    if (pathError !== null) {
      return pathError;
    }

    // Type-specific validation
    switch (op.type) {
      case 'set':
        if (op.value === undefined) {
          return 'set operation requires a value';
        }
        break;

      case 'insert':
        if (typeof op.index !== 'number') {
          return 'insert operation requires an index';
        }
        if (op.value === undefined) {
          return 'insert operation requires a value';
        }
        break;

      case 'move':
        if (typeof op.fromIndex !== 'number') {
          return 'move operation requires fromIndex';
        }
        if (typeof op.toIndex !== 'number') {
          return 'move operation requires toIndex';
        }
        break;

      case 'replace':
        if (op.content === undefined) {
          return 'replace operation requires content';
        }
        break;

      case 'delete':
        // delete only requires path, which we already checked
        break;
    }

    return null;
  }

  /**
   * Validate path format
   * Returns error message if invalid, null if valid
   */
  private validatePath(path: string): string | null {
    const parts = path.split('.');

    // Check for empty segments
    for (const part of parts) {
      if (part === '') {
        return 'Path contains empty segments';
      }
    }

    // Check depth limit
    if (parts.length > MAX_PATH_DEPTH) {
      return `Path exceeds maximum depth of ${String(MAX_PATH_DEPTH)}`;
    }

    return null;
  }
}
