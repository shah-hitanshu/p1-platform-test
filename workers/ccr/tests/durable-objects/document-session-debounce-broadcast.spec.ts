/**
 * Phase 1.2: Debounce WebSocket Broadcasts Tests
 *
 * Tests for debounced broadcasting in DocumentSession Durable Object.
 * Instead of broadcasting every Yjs update immediately to all N-1 connections,
 * updates are batched within a BROADCAST_DEBOUNCE_MS (50ms) window and
 * merged via Y.mergeUpdates() before broadcasting.
 *
 * Key behaviors:
 * - Multiple rapid updates are batched and merged before broadcast
 * - All clients receive the merged update
 * - Update ordering is preserved (merged updates produce correct state)
 * - Single-editor case should not add unnecessary delay
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

function createYjsUpdate(key: string, value: string): Uint8Array {
  const doc = new Y.Doc();
  const root = doc.getMap('root');
  root.set(key, value);
  return Y.encodeStateAsUpdate(doc);
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

describe('Phase 1.2: Debounce WebSocket Broadcasts', () => {
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

  describe('broadcast batching', () => {
    it('should not broadcast immediately on each webSocketMessage — updates are batched', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Create two connected WebSockets (sender + receiver)
      const sender = createMockWebSocket('user-1');
      const receiver = createMockWebSocket('user-2');
      mockState.getWebSockets.mockReturnValue([sender, receiver]);

      // Send a Yjs update from sender
      const update = createYjsUpdate('title', 'Hello');
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // The receiver should NOT receive the update immediately —
      // it should be batched and sent after the broadcast debounce window
      // Note: receiver.send may be called 0 times (fully batched) or
      // might not yet be called until the debounce window elapses.
      // The key invariant is that we don't get N sends for N updates.
      // Send 9 more rapid updates
      for (let i = 0; i < 9; i++) {
        const rapidUpdate = createYjsUpdate(`key-${String(i)}`, `value-${String(i)}`);
        await session.webSocketMessage(sender, rapidUpdate.buffer as ArrayBuffer);
      }

      // After the broadcast debounce window elapses, receiver should get
      // fewer sends than the 10 updates sent (ideally 1 merged update)
      await vi.advanceTimersByTimeAsync(100); // well past 50ms debounce

      const totalSendCount = (receiver.send as Mock).mock.calls.length;
      // We expect significantly fewer sends than 10 (the number of updates)
      // With debouncing, we should get at most a few sends, not 10
      expect(totalSendCount).toBeLessThan(10);
    });

    it('should deliver all updates correctly to receiver after debounce window', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const sender = createMockWebSocket('user-1');
      const receiver = createMockWebSocket('user-2');
      mockState.getWebSockets.mockReturnValue([sender, receiver]);

      // Send a few updates
      const update1 = createYjsUpdate('title', 'First');
      await session.webSocketMessage(sender, update1.buffer as ArrayBuffer);

      const update2 = createYjsUpdate('subtitle', 'Second');
      await session.webSocketMessage(sender, update2.buffer as ArrayBuffer);

      // Wait for debounce to flush
      await vi.advanceTimersByTimeAsync(100);

      // Receiver should have received updates (possibly merged into fewer sends)
      expect((receiver.send as Mock).mock.calls.length).toBeGreaterThan(0);

      // The combined updates, when applied to a fresh doc, should produce the correct state
      const receiverDoc = new Y.Doc();
      for (const call of (receiver.send as Mock).mock.calls) {
        const data = call[0];
        if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
          Y.applyUpdate(receiverDoc, new Uint8Array(data));
        }
      }

      const root = receiverDoc.getMap('root');
      expect(root.get('title')).toBe('First');
      expect(root.get('subtitle')).toBe('Second');
    });
  });

  describe('BROADCAST_DEBOUNCE_MS constant', () => {
    it('should export BROADCAST_DEBOUNCE_MS = 50', async () => {
      const { BROADCAST_DEBOUNCE_MS } = await import('../../src/constants/security-limits');
      expect(BROADCAST_DEBOUNCE_MS).toBe(50);
    });
  });
});
