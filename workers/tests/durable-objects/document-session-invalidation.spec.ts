/**
 * DocumentSession: Pull-Based KV Invalidation Tests
 *
 * Tests for the pull-based invalidation mechanism where the DO
 * checks a KV timestamp on fetch() and alarm() to detect when
 * it needs to reload state from PostgreSQL after a merge.
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
// Mock Types (mirrors document-session-reload.spec.ts pattern)
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
    delete: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };

  return {
    id: { toString: () => sessionId, name: sessionId },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
  };
}

function createMockKV(branchVersions: Record<string, string> = {}): KVNamespace {
  return {
    get: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(branchVersions[key] ?? null),
    ),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
  CONFIG_KV?: KVNamespace;
}

function createMockEnv(configKV?: KVNamespace): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    CONFIG_KV: configKV,
  };
}

describe('DocumentSession pull-based KV invalidation', () => {
  let mockState: MockDurableObjectState;
  let mockFetch: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    mockState = createMockState('site-1:doc-1:branch-1');

    // Mock global fetch for internal API calls (Hyperdrive/HTTP init)
    mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ found: true, snapshot: { title: 'Test' }, crdtState: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should not reload when CONFIG_KV is not bound', async () => {
    const mockEnv = createMockEnv(undefined); // no KV
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    const response = await session.fetch(new Request('http://localhost/snapshot'));
    expect(response.status).toBe(200);
  });

  it('should not reload when KV has no entry for this branch', async () => {
    const mockKV = createMockKV({}); // empty KV
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // First request initializes the DO
    await session.fetch(new Request('http://localhost/snapshot'));

    // Second request should check KV but find nothing — no reload
    const fetchCountBeforeSecond = mockFetch.mock.calls.length;
    await session.fetch(new Request('http://localhost/snapshot'));

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockKV.get).toHaveBeenCalledWith('branch-version:branch-1');
    // No additional initializeFromPostgres calls beyond the initial one
    expect(mockFetch.mock.calls.length).toBe(fetchCountBeforeSecond);
  });

  it('should reload when KV timestamp is newer than last-seen', async () => {
    // Start with no KV entry
    const kvStore: Record<string, string> = {};
    const mockKV = createMockKV(kvStore);
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // Initialize the DO
    await session.fetch(new Request('http://localhost/snapshot'));

    // Now simulate a merge by setting a KV timestamp
    const mergeTimestamp = Date.now().toString();
    (mockKV.get as Mock).mockImplementation((key: string) => {
      if (key === 'branch-version:branch-1') return Promise.resolve(mergeTimestamp);
      return Promise.resolve(null);
    });

    // Mock the reload response with different content
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          found: true,
          snapshot: { title: 'Merged Content' },
          crdtState: null,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    // Next request should detect staleness and reload
    const response = await session.fetch(new Request('http://localhost/snapshot'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.snapshot.title).toBe('Merged Content');
  });

  it('should not reload twice for the same KV timestamp', async () => {
    const mergeTimestamp = Date.now().toString();
    const mockKV = createMockKV({ 'branch-version:branch-1': mergeTimestamp });
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // First request: init + check KV + reload
    await session.fetch(new Request('http://localhost/snapshot'));

    const fetchCountAfterFirst = mockFetch.mock.calls.length;

    // Second request: check KV, same timestamp — should NOT reload
    await session.fetch(new Request('http://localhost/snapshot'));

    // Fetch count should not increase (no new initializeFromPostgres)
    const fetchCountAfterSecond = mockFetch.mock.calls.length;
    expect(fetchCountAfterSecond).toBe(fetchCountAfterFirst);
  });

  it('should handle KV read errors gracefully without disrupting normal operation', async () => {
    const mockKV = createMockKV({});
    (mockKV.get as Mock).mockRejectedValue(new Error('KV read failed'));
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // Should still serve the request normally despite KV error
    const response = await session.fetch(new Request('http://localhost/snapshot'));
    expect(response.status).toBe(200);
  });

  it('should broadcast diff to WebSocket clients after invalidation-triggered reload', async () => {
    const mockKV = createMockKV({});
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // Initialize with initial content
    await session.fetch(new Request('http://localhost/snapshot'));

    // Set up a mock WebSocket connection
    const mockWs = { readyState: WebSocket.OPEN, send: vi.fn() };
    mockState.getWebSockets.mockReturnValue([mockWs]);

    // Simulate merge: set KV timestamp
    const mergeTimestamp = (Date.now() + 1000).toString();
    (mockKV.get as Mock).mockImplementation((key: string) => {
      if (key === 'branch-version:branch-1') return Promise.resolve(mergeTimestamp);
      return Promise.resolve(null);
    });

    // Mock reload response with new content
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          found: true,
          snapshot: { title: 'After Merge' },
          crdtState: null,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    // Trigger fetch — should detect staleness, reload, and broadcast
    await session.fetch(new Request('http://localhost/snapshot'));

    // The WebSocket should have received the diff
    expect(mockWs.send).toHaveBeenCalled();
  });

  it('should detect merge via alarm() and reload (idle DO path)', async () => {
    const mockKV = createMockKV({});
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // Initialize the DO via fetch first
    await session.fetch(new Request('http://localhost/snapshot'));

    // Now simulate a merge by setting a KV timestamp
    const mergeTimestamp = (Date.now() + 1000).toString();
    (mockKV.get as Mock).mockImplementation((key: string) => {
      if (key === 'branch-version:branch-1') return Promise.resolve(mergeTimestamp);
      return Promise.resolve(null);
    });

    // Mock reload response with new content
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          found: true,
          snapshot: { title: 'Alarm Reloaded' },
          crdtState: null,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const fetchCountBeforeAlarm = mockFetch.mock.calls.length;

    // Trigger alarm — should detect staleness and reload
    await session.alarm();

    // Verify that a reload was triggered (fetch count increased)
    expect(mockFetch.mock.calls.length).toBeGreaterThan(fetchCountBeforeAlarm);
  });

  it('should NOT check KV for branch invalidation on /reload endpoint (avoids circular reload)', async () => {
    const mergeTimestamp = Date.now().toString();
    const mockKV = createMockKV({ 'branch-version:branch-1': mergeTimestamp });
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // Initialize the DO
    await session.fetch(new Request('http://localhost/snapshot'));

    // Clear KV mock call history after initialization
    (mockKV.get as Mock).mockClear();

    // Send a POST /reload request
    await session.fetch(new Request('http://localhost/reload', { method: 'POST' }));

    // KV.get should NOT have been called during the /reload request
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockKV.get).not.toHaveBeenCalled();
  });
});
