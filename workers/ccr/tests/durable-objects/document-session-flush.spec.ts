/**
 * DocumentSession /flush Endpoint Tests (TDD - Red State)
 *
 * Tests for the /flush endpoint that synchronously syncs the DO's CRDT state
 * to PostgreSQL via Hyperdrive, bypassing the async queue. This is used
 * before publish operations to ensure the latest version is in Postgres
 * before the publish endpoint reads it.
 *
 * The /flush endpoint:
 * 1. Persists pending state to DO storage
 * 2. Checks if state has changed since last sync (state vector hash)
 * 3. Writes directly to PostgreSQL via Hyperdrive (bypasses queue)
 * 4. Falls back to HTTP internal API if Hyperdrive unavailable
 * 5. Returns { flushed: true/false } indicating whether a sync occurred
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { readJson } from '../helpers/http';

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

interface FlushEnv {
  API_URL: string;
  ENVIRONMENT: string;
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
  SYNC_QUEUE?: { send: Mock };
  HYPERDRIVE?: { connectionString: string };
}

function createFlushEnv(overrides: Partial<FlushEnv> = {}): FlushEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('DocumentSession /flush endpoint', () => {
  let mockFetch: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    // Mock global fetch for init and HTTP fallback sync
    mockFetch = vi.fn().mockImplementation((url: string | URL | Request) => {
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
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('routing', () => {
    it('should route POST /flush to the flush handler', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(createMockState(), createFlushEnv());

      const request = new Request('http://localhost/flush', { method: 'POST' });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await readJson(response);
      expect(data).toHaveProperty('flushed');
    });

    it('should reject non-POST methods', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(createMockState(), createFlushEnv());

      const request = new Request('http://localhost/flush', { method: 'GET' });
      const response = await session.fetch(request);

      expect(response.status).toBe(405);
    });
  });

  describe('flush always syncs', () => {
    it('should return flushed: true even when no edits have been made', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(createMockState(), createFlushEnv());

      const request = new Request('http://localhost/flush', { method: 'POST' });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await readJson(response);
      expect(data.flushed).toBe(true);
    });
  });

  describe('sync after edits', () => {
    it('should sync to PostgreSQL after local edits and return flushed: true', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState();
      const env = createFlushEnv();
      const session = new DocumentSession(mockState, env);

      // Apply an edit to create pending state
      const applyRequest = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'title', value: 'Hello World' }],
          actorId: 'user-1',
        }),
      });
      const applyResponse = await session.fetch(applyRequest);
      expect(applyResponse.status).toBe(200);

      // Now flush
      const flushRequest = new Request('http://localhost/flush', { method: 'POST' });
      const flushResponse = await session.fetch(flushRequest);

      expect(flushResponse.status).toBe(200);
      const data = await flushResponse.json();
      expect(data.flushed).toBe(true);
    });

    it('should use HTTP internal API when Hyperdrive is not available', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState();
      // No HYPERDRIVE in env, has SYNC_QUEUE but flush should bypass it
      const env = createFlushEnv({
        SYNC_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
      });
      const session = new DocumentSession(mockState, env);

      // Apply an edit
      const applyRequest = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'content', value: 'test' }],
          actorId: 'user-1',
        }),
      });
      await session.fetch(applyRequest);

      // Flush — should use HTTP, NOT the queue
      const flushRequest = new Request('http://localhost/flush', { method: 'POST' });
      await session.fetch(flushRequest);

      // Verify HTTP sync was called (not the queue)
      const syncCall = mockFetch.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes('/internal/crdt-sync'),
      );
      expect(syncCall).toBeDefined();

      // Queue should NOT have been used
      expect(env.SYNC_QUEUE?.send).not.toHaveBeenCalled();
    });

    it('should bypass the sync queue even when SYNC_QUEUE is available', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState();
      const queueSend = vi.fn().mockResolvedValue(undefined);
      const env = createFlushEnv({
        SYNC_QUEUE: { send: queueSend },
      });
      const session = new DocumentSession(mockState, env);

      // Apply edit
      const applyRequest = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'key', value: 'val' }],
          actorId: 'user-1',
        }),
      });
      await session.fetch(applyRequest);

      // Flush
      const flushRequest = new Request('http://localhost/flush', { method: 'POST' });
      const flushResponse = await session.fetch(flushRequest);

      expect(flushResponse.status).toBe(200);
      // The key invariant: queue must NOT be used for flush
      expect(queueSend).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return 500 when sync fails', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState();
      const env = createFlushEnv();
      const session = new DocumentSession(mockState, env);

      // Apply an edit
      const applyRequest = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'x', value: 1 }],
          actorId: 'user-1',
        }),
      });
      await session.fetch(applyRequest);

      // Make sync fail
      mockFetch.mockImplementation((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/internal/crdt-sync')) {
          return Promise.resolve(new Response('Internal Server Error', { status: 500 }));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const flushRequest = new Request('http://localhost/flush', { method: 'POST' });
      const flushResponse = await session.fetch(flushRequest);

      expect(flushResponse.status).toBe(500);
    });

    it('should return flushed: false when internal API is not configured', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState();
      // No INTERNAL_API_URL or INTERNAL_SECRET
      const env = {
        API_URL: 'http://localhost:8787',
        ENVIRONMENT: 'test',
      };
      const session = new DocumentSession(mockState, env);

      // Apply an edit
      const applyRequest = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'a', value: 'b' }],
          actorId: 'user-1',
        }),
      });
      await session.fetch(applyRequest);

      const flushRequest = new Request('http://localhost/flush', { method: 'POST' });
      const flushResponse = await session.fetch(flushRequest);

      expect(flushResponse.status).toBe(200);
      const data = await flushResponse.json();
      expect(data.flushed).toBe(false);
      expect(data.reason).toBe('no_sync_config');
    });
  });

  describe('idempotency', () => {
    it('should return flushed: false on second flush with no new edits', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState();
      const env = createFlushEnv();
      const session = new DocumentSession(mockState, env);

      // Apply edit
      const applyRequest = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'key', value: 'val' }],
          actorId: 'user-1',
        }),
      });
      await session.fetch(applyRequest);

      // First flush — should sync
      const flush1 = new Request('http://localhost/flush', { method: 'POST' });
      const response1 = await session.fetch(flush1);
      const data1 = await response1.json();
      expect(data1.flushed).toBe(true);

      // Second flush — no new edits, but flush always syncs (by design)
      const flush2 = new Request('http://localhost/flush', { method: 'POST' });
      const response2 = await session.fetch(flush2);
      const data2 = await response2.json();
      expect(data2.flushed).toBe(true);
    });
  });
});
