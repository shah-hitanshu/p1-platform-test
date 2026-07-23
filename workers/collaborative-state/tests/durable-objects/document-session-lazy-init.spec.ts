/**
 * Phase 4.2: Lazy CRDT Initialization Tests
 *
 * Tests for splitting initialization into metadata-only and full CRDT paths.
 * Presence-only endpoints should not trigger expensive Y.Doc loading,
 * while CRDT endpoints still initialize the full document state.
 *
 * Key behaviors:
 * - /presences works without loading Yjs document
 * - /snapshot and /apply still initialize CRDT correctly
 * - Mixed request patterns (presence query then edit) work correctly
 * - Metadata-only init does not touch YDOC storage key
 * - /activity-state works with metadata-only init
 * - /edit-sessions works with metadata-only init
 * - After CRDT init, metadata is also initialized (idempotent)
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

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

// =============================================================================
// Tests
// =============================================================================

describe('Phase 4.2: Lazy CRDT Initialization', () => {
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

  describe('/presences endpoint works without loading Yjs document', () => {
    it('should not access YDOC storage key when handling /presences', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const req = new Request('http://localhost/presences');
      const response = await session.fetch(req);

      expect(response.status).toBe(200);

      // Verify that the 'ydoc' key was NOT accessed in storage.get
      const getCalls = mockState.storage.get.mock.calls;
      const ydocAccesses = getCalls.filter(
        (call: unknown[]) => call[0] === 'ydoc',
      );
      expect(ydocAccesses).toHaveLength(0);
    });
  });

  describe('/snapshot and /apply still initialize CRDT correctly', () => {
    it('should load Yjs document state for /snapshot', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const req = new Request('http://localhost/snapshot');
      const response = await session.fetch(req);

      expect(response.status).toBe(200);

      // Verify that the 'ydoc' key WAS accessed in storage.get
      const getCalls = mockState.storage.get.mock.calls;
      const ydocAccesses = getCalls.filter(
        (call: unknown[]) => call[0] === 'ydoc',
      );
      expect(ydocAccesses.length).toBeGreaterThan(0);
    });

    it('should load Yjs document state for /apply', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const req = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: 'user-1',
          operations: [
            { type: 'set', path: ['title'], value: 'Test' },
          ],
        }),
      });
      const response = await session.fetch(req);

      // Should succeed or return a valid response
      expect(response.status).toBeLessThan(500);

      // Verify that the 'ydoc' key WAS accessed
      const getCalls = mockState.storage.get.mock.calls;
      const ydocAccesses = getCalls.filter(
        (call: unknown[]) => call[0] === 'ydoc',
      );
      expect(ydocAccesses.length).toBeGreaterThan(0);
    });
  });

  describe('mixed request patterns work correctly', () => {
    it('should handle presence query then edit request correctly', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // First: presence query (metadata only)
      const presenceReq = new Request('http://localhost/presences');
      const presenceResponse = await session.fetch(presenceReq);
      expect(presenceResponse.status).toBe(200);

      // Then: CRDT operation (needs full init)
      const snapshotReq = new Request('http://localhost/snapshot');
      const snapshotResponse = await session.fetch(snapshotReq);
      expect(snapshotResponse.status).toBe(200);

      const snapshotData = await snapshotResponse.json();
      expect(snapshotData).toHaveProperty('snapshot');
      expect(snapshotData).toHaveProperty('stateVector');
    });
  });

  describe('metadata-only init does not touch YDOC storage key', () => {
    it('should not read ydoc key for metadata-only endpoints', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Call multiple metadata-only endpoints
      const endpoints = ['/presences', '/activity-state', '/edit-sessions'];

      for (const endpoint of endpoints) {
        const req = new Request(`http://localhost${endpoint}`);
        await session.fetch(req);
      }

      // Check that ydoc was never accessed
      const getCalls = mockState.storage.get.mock.calls;
      const ydocAccesses = getCalls.filter(
        (call: unknown[]) => call[0] === 'ydoc',
      );
      expect(ydocAccesses).toHaveLength(0);
    });
  });

  describe('/activity-state works with metadata-only init', () => {
    it('should return activity state without loading CRDT', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const req = new Request('http://localhost/activity-state');
      const response = await session.fetch(req);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('isIdle');

      // Verify ydoc was NOT accessed
      const getCalls = mockState.storage.get.mock.calls;
      const ydocAccesses = getCalls.filter(
        (call: unknown[]) => call[0] === 'ydoc',
      );
      expect(ydocAccesses).toHaveLength(0);
    });
  });

  describe('/edit-sessions works with metadata-only init', () => {
    it('should return edit sessions without loading CRDT', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const req = new Request('http://localhost/edit-sessions');
      const response = await session.fetch(req);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('sessions');

      // Verify ydoc was NOT accessed
      const getCalls = mockState.storage.get.mock.calls;
      const ydocAccesses = getCalls.filter(
        (call: unknown[]) => call[0] === 'ydoc',
      );
      expect(ydocAccesses).toHaveLength(0);
    });
  });

  describe('CRDT init also initializes metadata (idempotent)', () => {
    it('should initialize metadata when CRDT init is called', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Call a CRDT endpoint first
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Then call a metadata-only endpoint — should work without issues
      const presenceReq = new Request('http://localhost/presences');
      const presenceResponse = await session.fetch(presenceReq);
      expect(presenceResponse.status).toBe(200);

      // Verify ydoc was only accessed once (first call), not again on presences
      const getCalls = mockState.storage.get.mock.calls;
      const ydocAccesses = getCalls.filter(
        (call: unknown[]) => call[0] === 'ydoc',
      );
      expect(ydocAccesses).toHaveLength(1);
    });
  });
});
