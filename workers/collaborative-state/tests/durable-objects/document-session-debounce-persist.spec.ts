/**
 * Phase 1.1: Debounce DO Storage Persistence Tests
 *
 * Tests for debounced persistence in DocumentSession Durable Object.
 * Instead of persisting on every WebSocket message, persistence is debounced
 * to happen at most every PERSIST_DEBOUNCE_MS (2000ms).
 *
 * Key behaviors:
 * - webSocketMessage() sets a persistPending flag instead of persisting immediately
 * - Alarm handler flushes pending persistence
 * - Persist happens immediately on last client disconnect
 * - Persist happens immediately on /apply endpoint
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

function createMockState(sessionId = 'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001'): MockDurableObjectState {
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

/**
 * Create a valid Yjs update that sets a key on the root map.
 */
function createYjsUpdate(key: string, value: string): Uint8Array {
  const doc = new Y.Doc();
  const root = doc.getMap('root');
  root.set(key, value);
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Create a mock WebSocket with the given readyState
 */
function createMockWebSocket(readyState: number = WebSocket.OPEN): WebSocket {
  const ws = {
    readyState,
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
      actorId: 'user-1',
      actorType: 'user',
      verified: false,
    }),
  } as unknown as WebSocket;
  return ws;
}

// =============================================================================
// Tests
// =============================================================================

describe('Phase 1.1: Debounce DO Storage Persistence', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mockState = createMockState();
    mockEnv = createMockEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('webSocketMessage debounced persistence', () => {
    it('should NOT persist immediately on webSocketMessage', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize the session
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Create a mock WebSocket and register it
      const ws = createMockWebSocket();
      mockState.getWebSockets.mockReturnValue([ws]);

      // Clear put calls from initialization
      mockState.storage.put.mockClear();

      // Send a Yjs update via WebSocket message
      const update = createYjsUpdate('title', 'Hello');
      await session.webSocketMessage(ws, update.buffer as ArrayBuffer);

      // persist() should NOT be called directly - it should be debounced
      // Instead of calling storage.put('ydoc', ...), a persist alarm should be scheduled
      const ydocPuts = mockState.storage.put.mock.calls.filter(
        (call) => call[0] === 'ydoc',
      );
      expect(ydocPuts.length).toBe(0);
    });

    it('should schedule a persist alarm when webSocketMessage is received', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const ws = createMockWebSocket();
      mockState.getWebSockets.mockReturnValue([ws]);

      mockState.storage.setAlarm.mockClear();

      // Send a Yjs update
      const update = createYjsUpdate('title', 'Hello');
      await session.webSocketMessage(ws, update.buffer as ArrayBuffer);

      // An alarm should have been scheduled (for either persist or sync debounce)
      expect(mockState.storage.setAlarm).toHaveBeenCalled();
    });

    it('should persist when alarm fires after debounce period', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const ws = createMockWebSocket();
      mockState.getWebSockets.mockReturnValue([ws]);

      // Send a Yjs update
      const update = createYjsUpdate('title', 'Debounced');
      await session.webSocketMessage(ws, update.buffer as ArrayBuffer);

      // Clear put calls from before alarm
      mockState.storage.put.mockClear();

      // Fire the alarm
      await session.alarm();

      // Now persist should have been called with 'ydoc' key
      const ydocPuts = mockState.storage.put.mock.calls.filter(
        (call) => call[0] === 'ydoc',
      );
      expect(ydocPuts.length).toBe(1);
    });

    it('should batch multiple edits into a single persist', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const ws = createMockWebSocket();
      mockState.getWebSockets.mockReturnValue([ws]);

      // Send multiple Yjs updates rapidly
      for (let i = 0; i < 10; i++) {
        const update = createYjsUpdate(`key-${String(i)}`, `value-${String(i)}`);
        await session.webSocketMessage(ws, update.buffer as ArrayBuffer);
      }

      // Clear storage puts from before alarm
      mockState.storage.put.mockClear();

      // Fire the alarm - should persist once with ALL accumulated state
      await session.alarm();

      // Only ONE persist call should have happened
      const ydocPuts = mockState.storage.put.mock.calls.filter(
        (call) => call[0] === 'ydoc',
      );
      expect(ydocPuts.length).toBe(1);
    });
  });

  describe('immediate persistence on disconnect', () => {
    it('should persist immediately when the last client disconnects', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const ws = createMockWebSocket();
      mockState.getWebSockets.mockReturnValue([ws]);

      // Send a Yjs update (should be debounced, not persisted yet)
      const update = createYjsUpdate('title', 'Before disconnect');
      await session.webSocketMessage(ws, update.buffer as ArrayBuffer);

      // Clear put calls
      mockState.storage.put.mockClear();

      // Simulate WebSocket close (last client disconnects)
      // After close, getWebSockets returns empty (exclude the closing ws)
      mockState.getWebSockets.mockReturnValue([]);
      await session.webSocketClose(ws, 1000, 'normal', true);

      // Persist should happen immediately on last disconnect
      const ydocPuts = mockState.storage.put.mock.calls.filter(
        (call) => call[0] === 'ydoc',
      );
      expect(ydocPuts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('immediate persistence on /apply', () => {
    it('should persist immediately on /apply endpoint', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Clear puts from initialization
      mockState.storage.put.mockClear();

      // Send an /apply request
      const applyReq = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: 'user-1',
          operations: [
            { type: 'set', path: '/title', value: 'Applied' },
          ],
        }),
      });

      const response = await session.fetch(applyReq);
      expect(response.status).toBe(200);

      // /apply should persist immediately (not debounced)
      const ydocPuts = mockState.storage.put.mock.calls.filter(
        (call) => call[0] === 'ydoc',
      );
      expect(ydocPuts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PERSIST_DEBOUNCE_MS constant', () => {
    it('should export PERSIST_DEBOUNCE_MS = 2000', async () => {
      const { PERSIST_DEBOUNCE_MS } = await import('../../src/constants/security-limits');
      expect(PERSIST_DEBOUNCE_MS).toBe(2000);
    });
  });
});
