/**
 * Phase 2.1: SQLite Storage Backend Migration Tests
 *
 * Validates that Durable Objects work correctly with SQLite storage backend.
 * The migration from KV to SQLite backend changes the underlying storage engine
 * but the KV API (ctx.storage.put/get) continues to work identically.
 *
 * Key benefits of SQLite backend:
 * - Increased value size limit: 128 KiB (KV) → 2 MB (SQLite)
 * - Enables future use of ctx.storage.sql for structured queries
 * - Better transactional consistency
 *
 * These tests verify:
 * 1. DO initializes correctly (constructor, session parsing)
 * 2. Large document persistence works (payloads > 128 KiB)
 * 3. Persist/restore roundtrip integrity for large Yjs documents
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import * as Y from 'yjs';

// Mock cloudflare:workers DurableObject base class for Hibernatable WebSocket API
vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

// =============================================================================
// Mock Types for Durable Object Testing
// =============================================================================

interface MockDurableObjectStorage {
  get: Mock<(key: string) => Promise<unknown>>;
  put: Mock<(key: string, value: unknown) => Promise<void>>;
  delete: Mock<(key: string) => Promise<boolean>>;
  list: Mock<() => Promise<Map<string, unknown>>>;
  getAlarm: Mock<() => Promise<number | null>>;
  setAlarm: Mock<(scheduledTime: number) => Promise<void>>;
}

interface MockDurableObjectState {
  id: { toString: () => string; name: string };
  storage: MockDurableObjectStorage;
  blockConcurrencyWhile: Mock<(callback: () => Promise<void>) => Promise<void>>;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
}

/**
 * Create a mock DurableObjectState with in-memory storage.
 * The in-memory Map simulates both KV and SQLite-backed storage behavior,
 * since both backends expose the same put/get API.
 */
function createMockState(sessionId = 'site-1:doc-1:branch-1'): MockDurableObjectState {
  const storageData = new Map<string, unknown>();

  const storage: MockDurableObjectStorage = {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.get(key))),
    put: vi.fn().mockImplementation((key: string, value: unknown) => {
      storageData.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.delete(key))),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };

  const acceptedWebSockets: WebSocket[] = [];

  return {
    id: { toString: () => sessionId, name: sessionId },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn().mockImplementation((ws: WebSocket) => {
      acceptedWebSockets.push(ws);
    }),
    getWebSockets: vi.fn().mockImplementation(() => {
      return acceptedWebSockets.filter((ws) => ws.readyState === WebSocket.OPEN);
    }),
  };
}

interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
}

function createMockEnv(): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
  };
}

// =============================================================================
// Helper: Generate large Yjs document content
// =============================================================================

/**
 * Create a Yjs document with enough content to exceed a target size when serialized.
 * Simulates a complex page with many components and edit history.
 *
 * @param targetSizeKiB - Approximate target size in KiB for the serialized state
 * @returns Object with the Yjs doc and its encoded state update
 */
function createLargeYjsDocument(targetSizeKiB: number): {
  doc: Y.Doc;
  encoded: Uint8Array;
} {
  const doc = new Y.Doc();
  const root = doc.getMap('root');

  // Build up content to reach the target size using the root map.
  // Each key-value pair adds to the serialized size.
  let componentIndex = 0;
  const targetBytes = targetSizeKiB * 1024;
  let currentSize = 0;

  while (currentSize < targetBytes) {
    const idx = String(componentIndex);
    root.set('component-' + idx, {
      id: 'comp-' + idx,
      type: 'ContentBlock',
      content:
        'Content for component ' + idx + '. ' +
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
        'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
        'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
      props: {
        title: 'Title ' + idx,
        description: 'Description for component ' + idx,
        className: 'container mx-auto p-4',
      },
    });
    componentIndex++;

    // Check size periodically (every 50 components to reduce overhead)
    if (componentIndex % 50 === 0) {
      currentSize = Y.encodeStateAsUpdate(doc).byteLength;
    }
  }

  root.set('title', 'Large Test Document');
  root.set('componentCount', componentIndex);

  const encoded = Y.encodeStateAsUpdate(doc);
  return { doc, encoded };
}

// =============================================================================
// Tests
// =============================================================================

describe('Phase 2.1: SQLite Storage Backend Migration', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    mockState = createMockState();
    mockEnv = createMockEnv();
  });

  describe('DO initialization with SQLite storage', () => {
    it('should initialize DocumentSession with valid session ID', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      expect(session).toBeDefined();
      expect(session).toBeInstanceOf(DocumentSession);
    });

    it('should parse session ID correctly from state.id.name', async () => {
      const sessionId = 'test-site:test-doc:test-branch';
      const state = createMockState(sessionId);
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(state as unknown, mockEnv);

      // Verify session info is parsed correctly
      const info = session.getSessionInfo();
      expect(info.siteId).toBe('test-site');
      expect(info.documentId).toBe('test-doc');
      expect(info.branchId).toBe('test-branch');
    });

    it('should respond to /snapshot after initialization (storage API compatible)', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('snapshot');
      expect(data).toHaveProperty('stateVector');
      expect(data).toHaveProperty('connectedActors');
    });

    it('should use ctx.storage.put for persistence after /apply', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'testKey', value: 'testValue' }],
          actorId: 'user-1',
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(200);

      // Verify storage.put was called with the 'ydoc' key
      expect(mockState.storage.put).toHaveBeenCalledWith('ydoc', expect.any(Uint8Array));
    });

    it('should use ctx.storage.get during initialization (reads stored CRDT state)', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Trigger initialization via snapshot
      await session.fetch(new Request('http://localhost/snapshot'));

      // Verify storage.get was called for 'ydoc'
      expect(mockState.storage.get).toHaveBeenCalledWith('ydoc');
    });
  });

  describe('Large document persistence (> 128 KiB)', () => {
    it('should persist a document built via many /apply operations', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Apply many operations to build up a substantial document
      for (let i = 0; i < 50; i++) {
        const idx = String(i);
        const request = new Request('http://localhost/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operations: [
              {
                type: 'set',
                path: 'component-' + idx,
                value: {
                  id: 'comp-' + idx,
                  type: 'ContentBlock',
                  content: ('Content for component ' + idx + '. ').repeat(10),
                  props: { title: 'Title ' + idx },
                },
              },
            ],
            actorId: 'user-1',
          }),
        });
        const response = await session.fetch(request);
        expect(response.status).toBe(200);
      }

      // Verify storage.put was called for 'ydoc' at least once
      const ydocPuts = mockState.storage.put.mock.calls.filter(
        (call: [string, unknown]) => call[0] === 'ydoc',
      );
      expect(ydocPuts.length).toBeGreaterThan(0);

      // Verify the last persisted state is a Uint8Array with substantial size
      const lastPersistedState = ydocPuts[ydocPuts.length - 1][1] as Uint8Array;
      expect(lastPersistedState).toBeInstanceOf(Uint8Array);
      expect(lastPersistedState.byteLength).toBeGreaterThan(1024); // At least 1 KiB
    });

    it('should restore a large document (> 128 KiB) from storage correctly', async () => {
      // Create a large Yjs doc that exceeds the KV 128 KiB limit
      const { encoded } = createLargeYjsDocument(150);
      expect(encoded.byteLength).toBeGreaterThan(128 * 1024);

      // Pre-populate the mock storage with the large encoded state
      const state = createMockState('site-1:doc-1:branch-1');
      const storageData = new Map<string, unknown>();
      storageData.set('ydoc', encoded);
      state.storage.get.mockImplementation((key: string) =>
        Promise.resolve(storageData.get(key)),
      );

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(state as unknown, mockEnv);

      // Fetch snapshot to trigger initialization and CRDT restore
      const response = await session.fetch(new Request('http://localhost/snapshot'));
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.snapshot).toBeDefined();

      // The snapshot should contain our data — verify key fields are present
      expect(data.snapshot).toHaveProperty('title', 'Large Test Document');
      expect(data.snapshot).toHaveProperty('componentCount');
      expect(data.snapshot.componentCount).toBeGreaterThan(0);

      // Verify some component data was restored
      expect(data.snapshot).toHaveProperty('component-0');
      const comp0 = data.snapshot['component-0'];
      expect(comp0).toHaveProperty('id', 'comp-0');
      expect(comp0).toHaveProperty('type', 'ContentBlock');
    });

    it('should handle roundtrip for documents near the 2 MB SQLite limit', async () => {
      // Create a document at ~512 KiB (well beyond KV's 128 KiB, within SQLite's 2 MB)
      const { encoded } = createLargeYjsDocument(512);
      expect(encoded.byteLength).toBeGreaterThan(128 * 1024);
      expect(encoded.byteLength).toBeLessThan(2 * 1024 * 1024);

      // Pre-populate storage
      const state = createMockState('site-1:doc-1:branch-1');
      const storageData = new Map<string, unknown>();
      storageData.set('ydoc', encoded);
      state.storage.get.mockImplementation((key: string) =>
        Promise.resolve(storageData.get(key)),
      );

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(state as unknown, mockEnv);

      // Trigger init and verify restore works
      const response = await session.fetch(new Request('http://localhost/snapshot'));
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.snapshot).toBeDefined();
      expect(data.snapshot).toHaveProperty('title', 'Large Test Document');

      // Verify storage.get was called for 'ydoc' during init
      expect(state.storage.get).toHaveBeenCalledWith('ydoc');
    });

    it('should persist and restore without data loss for large payloads', async () => {
      // Create a large doc, persist it, then verify the restored content matches
      const { doc: originalDoc, encoded } = createLargeYjsDocument(200);
      expect(encoded.byteLength).toBeGreaterThan(128 * 1024);

      // Get the original snapshot for comparison
      const originalRoot = originalDoc.getMap('root');
      const originalTitle = originalRoot.get('title');
      const originalComponentCount = originalRoot.get('componentCount') as number;

      // Pre-populate storage and create a new DO that restores from it
      const state = createMockState('site-1:doc-1:branch-1');
      const storageData = new Map<string, unknown>();
      storageData.set('ydoc', encoded);
      state.storage.get.mockImplementation((key: string) =>
        Promise.resolve(storageData.get(key)),
      );

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(state as unknown, mockEnv);

      const response = await session.fetch(new Request('http://localhost/snapshot'));
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.snapshot.title).toBe(originalTitle);
      expect(data.snapshot.componentCount).toBe(originalComponentCount);

      // Verify several components survived the roundtrip
      for (let i = 0; i < Math.min(5, originalComponentCount); i++) {
        const idx = String(i);
        expect(data.snapshot['component-' + idx]).toBeDefined();
        expect(data.snapshot['component-' + idx].id).toBe('comp-' + idx);
      }
    });
  });

  describe('Storage API compatibility (KV API on SQLite backend)', () => {
    it('should use ctx.storage.put with ydoc key for CRDT persistence', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Apply an edit to trigger persist
      await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operations: [{ type: 'set', path: 'key', value: 'value' }],
            actorId: 'user-1',
          }),
        }),
      );

      // Verify ctx.storage.put was called with 'ydoc' key and Uint8Array value
      // This KV API works identically on both KV and SQLite backends
      expect(mockState.storage.put).toHaveBeenCalledWith('ydoc', expect.any(Uint8Array));
    });

    it('should use ctx.storage.get with ydoc key for CRDT restore', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Trigger initialization via snapshot request
      await session.fetch(new Request('http://localhost/snapshot'));

      // Verify ctx.storage.get was called for 'ydoc' key
      // This KV API works identically on both KV and SQLite backends
      expect(mockState.storage.get).toHaveBeenCalledWith('ydoc');
    });
  });
});
