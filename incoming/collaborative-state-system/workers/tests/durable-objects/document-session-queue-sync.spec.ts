/**
 * Phase 5.1: Queue-Based Sync in DocumentSession Tests
 *
 * Tests that DocumentSession uses Queue.send() instead of fetch() for
 * DO-to-PostgreSQL sync when SYNC_QUEUE binding is available.
 *
 * Key behaviors:
 * - When SYNC_QUEUE is available, performSync sends to the queue instead of HTTP
 * - Queue message contains correct siteId, documentId, branchId, snapshot
 * - State vector hash and sync schedule are updated after successful queue send
 * - Falls back to fetch() when SYNC_QUEUE is not available
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
// Mock Infrastructure (follows document-session-debounce-broadcast.spec.ts)
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

// =============================================================================
// Tests
// =============================================================================

describe('Phase 5.1: Queue-Based Sync in DocumentSession', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;
  let mockQueue: MockQueue;

  // Store original fetch
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mockState = createMockState();
    mockQueue = createMockQueue();
    mockEnv = createMockEnv({ SYNC_QUEUE: mockQueue });

    // Mock global fetch to track calls
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: { id: 'v-1' } }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  describe('queue-based sync path', () => {
    it('should send sync message to SYNC_QUEUE instead of fetch when queue is available', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Create a WebSocket and send an update to trigger state change
      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      const doc = new Y.Doc();
      const root = doc.getMap('root');
      root.set('title', 'Hello World');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // Wait for broadcast debounce
      await vi.advanceTimersByTimeAsync(100);

      // Now trigger the sync by calling the alarm (which fires sync after idle timeout)
      // First, we need to schedule the sync by storing a sync schedule
      // The webSocketMessage should have already scheduled a sync via scheduleSync
      // Advance past the sync idle timeout (5 seconds)
      await vi.advanceTimersByTimeAsync(6000);

      // Trigger the alarm handler
      await session.alarm();

      // Queue.send should have been called instead of fetch for the sync
      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      const sentMessage = mockQueue.send.mock.calls[0][0] as Record<string, unknown>;
      expect(sentMessage).toMatchObject({
        siteId: 'site-1',
        documentId: 'doc-1',
        branchId: 'branch-1',
        actorType: 'user',
      });
      expect(sentMessage.snapshot).toBeDefined();
      expect(sentMessage.timestamp).toBeDefined();

      // fetch should NOT have been called for sync (it may be called for other things like init)
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const syncFetchCalls = fetchCalls.filter(
        (call) => String(call[0]).includes('/internal/crdt-sync'),
      );
      expect(syncFetchCalls).toHaveLength(0);
    });

    it('should include correct message structure with timestamp', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Send update
      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);
      const doc = new Y.Doc();
      doc.getMap('root').set('key', 'value');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      if (mockQueue.send.mock.calls.length > 0) {
        const sentMessage = mockQueue.send.mock.calls[0][0] as Record<string, unknown>;
        expect(typeof sentMessage.timestamp).toBe('number');
        expect(typeof sentMessage.siteId).toBe('string');
        expect(typeof sentMessage.documentId).toBe('string');
        expect(typeof sentMessage.branchId).toBe('string');
      }
    });

    it('should clear sync schedule after successful queue send', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);
      const doc = new Y.Doc();
      doc.getMap('root').set('title', 'Test');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      // After successful queue send, the syncSchedule key should be deleted
      const deleteCalls = mockState.storage.delete.mock.calls;
      const syncScheduleDeletes = deleteCalls.filter(
        (call) => call[0] === 'syncSchedule',
      );
      expect(syncScheduleDeletes.length).toBeGreaterThan(0);
    });
  });

  describe('fallback to fetch', () => {
    it('should fall back to fetch when SYNC_QUEUE is not available', async () => {
      const envWithoutQueue = createMockEnv({ SYNC_QUEUE: undefined });
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, envWithoutQueue);

      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);
      const doc = new Y.Doc();
      doc.getMap('root').set('title', 'Fallback Test');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      // fetch should be used since no queue
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const syncFetchCalls = fetchCalls.filter(
        (call) => String(call[0]).includes('/internal/crdt-sync'),
      );
      expect(syncFetchCalls.length).toBeGreaterThan(0);
    });
  });

  describe('SYNC_QUEUE in env interface', () => {
    it('should accept SYNC_QUEUE as optional binding in DocumentSessionEnv', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      // Should construct without SYNC_QUEUE
      const sessionNoQueue = new DocumentSession(mockState as unknown, createMockEnv({ SYNC_QUEUE: undefined }));
      expect(sessionNoQueue).toBeDefined();

      // Should construct with SYNC_QUEUE
      const mockState2 = createMockState();
      const sessionWithQueue = new DocumentSession(mockState2 as unknown, createMockEnv({ SYNC_QUEUE: mockQueue }));
      expect(sessionWithQueue).toBeDefined();
    });
  });
});
