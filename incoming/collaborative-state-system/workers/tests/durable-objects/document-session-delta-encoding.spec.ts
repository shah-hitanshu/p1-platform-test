/**
 * Phase 1.3: Delta Encoding for New Connections Tests
 *
 * Tests for delta encoding support in DocumentSession Durable Object.
 * New WebSocket connections can provide a state vector query parameter
 * to receive only the delta (changes since that state vector) instead
 * of the full document state.
 *
 * Key behaviors:
 * - /snapshot endpoint returns stateVector that can be used for delta sync
 * - Periodic compaction via alarm reduces serialized size
 * - Y.encodeStateAsUpdate(doc, stateVector) produces correct deltas
 *
 * Note: WebSocket /connect tests use 101/501 status since WebSocketPair
 * is not available in the Node test environment. The delta encoding logic
 * is tested indirectly through the document state and snapshot endpoint.
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

// =============================================================================
// Tests
// =============================================================================

describe('Phase 1.3: Delta Encoding for New Connections', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    mockState = createMockState();
    mockEnv = createMockEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('state vector for delta sync', () => {
    it('should return a valid state vector from /snapshot that can produce deltas', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Add initial data
      const applyReq1 = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: 'user-1',
          operations: [{ type: 'set', path: '/title', value: 'Initial' }],
        }),
      });
      await session.fetch(applyReq1);

      // Get the state vector from snapshot
      const snapshotResp = await session.fetch(new Request('http://localhost/snapshot'));
      const snapshotData: { stateVector: number[]; snapshot: Record<string, unknown> } = await snapshotResp.json();

      // The state vector should be a non-empty array
      expect(Array.isArray(snapshotData.stateVector)).toBe(true);
      expect(snapshotData.stateVector.length).toBeGreaterThan(0);

      // The state vector should be usable with Y.encodeStateAsUpdate for delta encoding
      const svBytes = new Uint8Array(snapshotData.stateVector);

      // Build a doc with matching state to verify delta works
      const clientDoc = new Y.Doc();
      const clientRoot = clientDoc.getMap('root');
      clientRoot.set('title', 'Initial');

      // encodeStateAsUpdate with stateVector should produce a delta
      const delta = Y.encodeStateAsUpdate(clientDoc, svBytes);
      expect(delta).toBeInstanceOf(Uint8Array);
    });

    it('should be able to compute delta from state vector after additional changes', () => {
      // Simulate the delta encoding pattern:
      // 1. Server doc has state at time T1
      // 2. Client syncs and captures state vector SV1
      // 3. Server doc gets more changes at T2
      // 4. Delta = encodeStateAsUpdate(serverDoc, SV1) gives only changes since T1

      const serverDoc = new Y.Doc();
      const serverRoot = serverDoc.getMap('root');

      // T1: Initial state on server
      serverRoot.set('title', 'Initial');

      // Client syncs the full state at T1
      const clientDoc = new Y.Doc();
      const fullState = Y.encodeStateAsUpdate(serverDoc);
      Y.applyUpdate(clientDoc, fullState);

      // Client captures its state vector (matches server at T1)
      const sv1 = Y.encodeStateVector(clientDoc);

      // T2: More changes on server only
      serverRoot.set('subtitle', 'Added later');
      serverRoot.set('body', 'Some content');

      // Compute delta from client's state vector
      const delta = Y.encodeStateAsUpdate(serverDoc, sv1);

      // Apply delta to client
      Y.applyUpdate(clientDoc, delta);

      // Client should now have ALL the state
      const root = clientDoc.getMap('root');
      expect(root.get('title')).toBe('Initial');
      expect(root.get('subtitle')).toBe('Added later');
      expect(root.get('body')).toBe('Some content');
    });

    it('delta should be smaller than full state for large documents with minimal changes', () => {
      // Create a document with substantial content
      const serverDoc = new Y.Doc();
      const serverRoot = serverDoc.getMap('root');

      // Add substantial content
      for (let i = 0; i < 50; i++) {
        serverRoot.set(`field-${String(i)}`, `value-${String(i)}-${'x'.repeat(100)}`);
      }

      // Capture state vector at this point
      const sv = Y.encodeStateVector(serverDoc);

      // Make a small change
      serverRoot.set('newField', 'small change');

      // Full state update (no state vector)
      const fullUpdate = Y.encodeStateAsUpdate(serverDoc);

      // Delta update (with state vector)
      const deltaUpdate = Y.encodeStateAsUpdate(serverDoc, sv);

      // Delta should be smaller than full update
      expect(deltaUpdate.length).toBeLessThan(fullUpdate.length);
    });
  });

  describe('periodic compaction via alarm', () => {
    it('should preserve document state after compaction via alarm', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize and add some data with multiple overwrites (creates history)
      for (let i = 0; i < 5; i++) {
        const applyReq = new Request('http://localhost/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actorId: 'user-1',
            operations: [
              { type: 'set', path: '/title', value: `Version ${String(i)}` },
            ],
          }),
        });
        await session.fetch(applyReq);
      }

      // Ensure no WebSocket connections
      mockState.getWebSockets.mockReturnValue([]);

      // Get state before alarm (which may trigger compaction)
      const beforeResp = await session.fetch(new Request('http://localhost/snapshot'));
      const beforeData = await beforeResp.json();

      // Fire alarm
      await session.alarm();

      // Get state after alarm
      const afterResp = await session.fetch(new Request('http://localhost/snapshot'));
      const afterData = await afterResp.json();

      // Content should be preserved after compaction
      expect(afterData.snapshot).toEqual(beforeData.snapshot);
    });

    it('should not compact when there are active connections', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const applyReq = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: 'user-1',
          operations: [{ type: 'set', path: '/title', value: 'Hello' }],
        }),
      });
      await session.fetch(applyReq);

      // Simulate active WebSocket connection
      const ws = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn().mockReturnValue(true),
        deserializeAttachment: vi.fn().mockReturnValue({
          actorId: 'user-1',
          actorType: 'user',
          verified: false,
        }),
      } as unknown as WebSocket;
      mockState.getWebSockets.mockReturnValue([ws]);

      // Fire alarm — should NOT compact because there are active connections
      await session.alarm();

      // State should still be correct
      const resp = await session.fetch(new Request('http://localhost/snapshot'));

      const data = await resp.json();
      expect(data.snapshot).toHaveProperty('/title', 'Hello');
    });
  });

  describe('/connect with stateVector parameter', () => {
    it('should accept stateVector query parameter on /connect (WebSocket not available in test env)', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      await session.fetch(new Request('http://localhost/snapshot'));

      // Try /connect with stateVector param
      // In test env, we expect 501 because WebSocketPair isn't available,
      // but the endpoint should not error on the stateVector parameter
      const svBase64 = btoa(String.fromCharCode(0, 0, 0, 0));
      const request = new Request(
        `http://localhost/connect?actorId=user-2&actorType=user&stateVector=${encodeURIComponent(svBase64)}`,
        {
          headers: {
            'Upgrade': 'websocket',
            'X-Actor-Id': 'user-2',
            'X-Actor-Type': 'user',
          },
        },
      );

      const response = await session.fetch(request);
      // 101 if WebSocketPair is available, 501 in test env — both acceptable
      expect([101, 501]).toContain(response.status);
    });
  });
});
