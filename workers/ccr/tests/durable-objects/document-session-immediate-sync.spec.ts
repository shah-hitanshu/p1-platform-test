/**
 * Immediate Sync Tests
 *
 * Tests that document lifecycle operations (create, delete) bypass the
 * alarm-based debounce and queue batching by triggering performDirectSync
 * instead of scheduling an alarm. Normal editing operations continue to
 * use the batched sync path.
 *
 * Key behaviors:
 * - action_metadata with immediate action types triggers performDirectSync
 * - No alarm is scheduled for immediate sync operations
 * - No queue message is sent for immediate sync operations
 * - Non-immediate action types still use alarm-based scheduling
 * - If performDirectSync fails, falls back to alarm-based scheduling
 * - pendingActionMetadata is cleared after successful immediate sync
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as Y from 'yjs';

// Mock cloudflare:workers DurableObject base class
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
// Mock Infrastructure
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
      return acceptedWebSockets.filter(ws => ws.readyState === WebSocket.OPEN);
    }),
  };
}

interface MockQueue {
  send: Mock;
}

interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
  SYNC_QUEUE?: MockQueue;
}

function createMockEnv(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    ...overrides,
  };
}

function createMockQueue(): MockQueue {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWebSocket(actorId = 'user-1'): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true),
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    binaryType: 'arraybuffer' as BinaryType,
    bufferedAmount: 0,
    extensions: '',
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    protocol: '',
    url: '',
    serializeAttachment: vi.fn(),
    deserializeAttachment: vi.fn().mockReturnValue({
      actorId,
      actorType: 'user',
      verified: false,
    }),
  } as unknown as WebSocket;
}

/**
 * Find a storage.put call by key.
 */
function findPutCall(
  mockState: MockDurableObjectState,
  key: string,
): unknown[] | undefined {
  return mockState.storage.put.mock.calls.find(
    (call: unknown[]) => call[0] === key,
  );
}

// =============================================================================
// Tests
// =============================================================================

describe('Immediate Sync for Document Lifecycle Operations', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;
  let mockQueue: MockQueue;

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mockState = createMockState();
    mockQueue = createMockQueue();
    mockEnv = createMockEnv({ SYNC_QUEUE: mockQueue });

    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes('/internal/crdt-state')) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (urlStr.includes('/internal/crdt-sync')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  describe('immediate sync triggers', () => {
    it('should perform immediate sync for document_create action type', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      // Initialize
      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata for document_create
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'document_create',
        actionMetadata: { documentPath: '/new-page' },
      }));

      // Clear any alarms set during initialization
      mockState.storage.setAlarm.mockClear();

      // Send binary CRDT update (triggers scheduleSync)
      const doc = new Y.Doc();
      doc.getMap('root').set('title', 'New Document');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // Verify HTTP sync was called immediately (performDirectSync uses fetch fallback
      // when HYPERDRIVE is not available)
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const syncCall = fetchCalls.find(
        (call) => String(call[0]).includes('/internal/crdt-sync'),
      );
      expect(syncCall).toBeDefined();

      // Verify no queue message was sent (direct sync bypasses queue)
      expect(mockQueue.send).not.toHaveBeenCalled();

      // Verify no sync schedule was stored (immediate sync bypasses alarm scheduling)
      const syncSchedulePut = findPutCall(mockState, 'syncSchedule');
      expect(syncSchedulePut).toBeUndefined();
    });

    it('should perform immediate sync for document_delete action type', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata for document_delete
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'document_delete',
      }));

      mockState.storage.setAlarm.mockClear();

      // Send binary CRDT update
      const doc = new Y.Doc();
      doc.getMap('root').set('deleted', true);
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // Verify immediate sync happened (HTTP fallback)
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const syncCall = fetchCalls.find(
        (call) => String(call[0]).includes('/internal/crdt-sync'),
      );
      expect(syncCall).toBeDefined();

      // Verify no queue or sync schedule involvement
      expect(mockQueue.send).not.toHaveBeenCalled();
      const syncSchedulePut = findPutCall(mockState, 'syncSchedule');
      expect(syncSchedulePut).toBeUndefined();
    });
  });

  describe('non-immediate action types use normal scheduling', () => {
    it('should use alarm-based scheduling for insert action type', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata for a normal Puck operation
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'insert',
        actionMetadata: { componentType: 'Hero' },
      }));

      mockState.storage.setAlarm.mockClear();

      // Send binary CRDT update
      const doc = new Y.Doc();
      doc.getMap('root').set('content', 'some content');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // Verify alarm WAS scheduled (normal path)
      expect(mockState.storage.setAlarm).toHaveBeenCalled();

      // Verify sync schedule was stored
      const syncSchedulePut = findPutCall(mockState, 'syncSchedule');
      expect(syncSchedulePut).toBeDefined();

      // Verify no immediate HTTP sync happened
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const syncCall = fetchCalls.find(
        (call) => String(call[0]).includes('/internal/crdt-sync'),
      );
      expect(syncCall).toBeUndefined();
    });

    it('should use alarm-based scheduling when no action metadata is sent', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      mockState.storage.setAlarm.mockClear();

      // Send only binary CRDT update (no action_metadata)
      const doc = new Y.Doc();
      doc.getMap('root').set('title', 'No metadata');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // Verify alarm WAS scheduled (normal path)
      expect(mockState.storage.setAlarm).toHaveBeenCalled();
    });
  });

  describe('fallback on failure', () => {
    it('should fall back to alarm-based scheduling when immediate sync fails', async () => {
      // Make HTTP sync fail
      globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/internal/crdt-state')) {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        if (urlStr.includes('/internal/crdt-sync')) {
          return Promise.resolve(new Response('Internal Server Error', { status: 500 }));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata for document_create (immediate action type)
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'document_create',
      }));

      mockState.storage.setAlarm.mockClear();

      // Send binary CRDT update
      const doc = new Y.Doc();
      doc.getMap('root').set('title', 'Will fail sync');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // Verify alarm WAS scheduled as fallback
      expect(mockState.storage.setAlarm).toHaveBeenCalled();

      // Verify sync schedule was stored as fallback
      const syncSchedulePut = findPutCall(mockState, 'syncSchedule');
      expect(syncSchedulePut).toBeDefined();
    });
  });

  describe('metadata cleanup', () => {
    it('should clear pendingActionMetadata after successful immediate sync', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata for document_create
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'document_create',
        actionMetadata: { documentPath: '/new-page' },
      }));

      // Send binary CRDT update (triggers immediate sync)
      const doc1 = new Y.Doc();
      doc1.getMap('root').set('title', 'Created');
      const update1 = Y.encodeStateAsUpdate(doc1);
      await session.webSocketMessage(sender, update1.buffer as ArrayBuffer);

      // Now send a subsequent normal edit WITHOUT action_metadata
      mockState.storage.setAlarm.mockClear();
      (globalThis.fetch as Mock).mockClear();

      const doc2 = new Y.Doc();
      // Apply the first update first so the second is a diff
      Y.applyUpdate(doc2, update1);
      doc2.getMap('root').set('body', 'some content');
      const update2 = Y.encodeStateAsUpdate(doc2);
      await session.webSocketMessage(sender, update2.buffer as ArrayBuffer);

      // The second edit should use normal alarm-based scheduling
      // (pendingActionMetadata was cleared, so no immediate sync)
      expect(mockState.storage.setAlarm).toHaveBeenCalled();

      // Verify no immediate HTTP sync for the second edit
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const syncCall = fetchCalls.find(
        (call) => String(call[0]).includes('/internal/crdt-sync'),
      );
      expect(syncCall).toBeUndefined();
    });
  });
});
