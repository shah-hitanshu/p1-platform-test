/**
 * Phase 5.3: Direct Hyperdrive from DOs Tests
 *
 * Tests that DocumentSession uses direct Hyperdrive database access for
 * initialization instead of the HTTP internal API when HYPERDRIVE is available.
 *
 * Key behaviors:
 * - DO initializes from PostgreSQL via Hyperdrive when binding is available
 * - Falls back to HTTP internal API when Hyperdrive is not available or fails
 * - CRDT state is preferred over snapshot when both are available
 * - Connection is properly cleaned up after use via runWithConnection()
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

// Mock the db module for direct Hyperdrive access
vi.mock('../../src/db', () => ({
  runWithConnection: vi.fn(),
  query: vi.fn(),
  setDatabaseInstance: vi.fn(),
  getDatabaseInstance: vi.fn(),
  initializeDatabaseFromConnectionString: vi.fn(),
  initializeDatabaseFromHyperdrive: vi.fn(),
  initializeDatabase: vi.fn(),
  closeDatabaseConnection: vi.fn(),
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
    delete: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(storageData.delete(key)),
    ),
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

interface MockHyperdrive {
  connectionString: string;
}

interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
  INTERNAL_API_URL?: string;
  INTERNAL_SECRET?: string;
  HYPERDRIVE?: MockHyperdrive;
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

// =============================================================================
// Tests
// =============================================================================

describe('Phase 5.3: Direct Hyperdrive from DOs', () => {
  let mockState: MockDurableObjectState;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.resetAllMocks();

    mockState = createMockState();

    // Default: no HTTP API calls
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ found: false }), { status: 404 }),
    );

    // Default: runWithConnection just runs the fn
    const db = await import('../../src/db');
    (db.runWithConnection as ReturnType<typeof vi.fn>).mockImplementation(
      async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
    );
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('Hyperdrive initialization path', () => {
    it('should use direct Hyperdrive for initialization when binding is available', async () => {
      const db = await import('../../src/db');

      // Mock the database query to return document data
      (db.runWithConnection as ReturnType<typeof vi.fn>).mockImplementation(
        async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
      );
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{
          snapshot: { title: 'From DB' },
        }],
        rowCount: 1,
      });

      const env = createMockEnv({
        HYPERDRIVE: { connectionString: 'postgresql://user:pass@host:5432/db' },
      });

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, env);

      // Trigger initialization via /snapshot
      const req = new Request('http://localhost/snapshot');
      await session.fetch(req);

      // runWithConnection should have been called with the Hyperdrive connection string
      expect(db.runWithConnection).toHaveBeenCalledWith(
        'postgresql://user:pass@host:5432/db',
        expect.objectContaining({ isHyperdrive: true }),
        expect.any(Function),
      );
    });

    it('should use snapshot from Hyperdrive query', async () => {
      const db = await import('../../src/db');

      (db.runWithConnection as ReturnType<typeof vi.fn>).mockImplementation(
        async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
      );
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{
          snapshot: { title: 'Snapshot Only' },
        }],
        rowCount: 1,
      });

      const env = createMockEnv({
        HYPERDRIVE: { connectionString: 'postgresql://user:pass@host:5432/db' },
      });

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, env);

      const req = new Request('http://localhost/snapshot');
      const response = await session.fetch(req);
      const result = await response.json();

      expect(result.snapshot.title).toBe('Snapshot Only');
    });
  });

  describe('fallback to HTTP internal API', () => {
    it('should fall back to HTTP when HYPERDRIVE is not available', async () => {
      // Mock HTTP API response
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          found: true,
          snapshot: { title: 'From HTTP' },
        }), { status: 200 }),
      );

      const env = createMockEnv({
        HYPERDRIVE: undefined,
        INTERNAL_API_URL: 'http://localhost:8787',
        INTERNAL_SECRET: 'test-secret',
      });

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, env);

      const req = new Request('http://localhost/snapshot');
      const response = await session.fetch(req);
      const result = await response.json();

      expect(result.snapshot.title).toBe('From HTTP');

      // Should have used fetch (HTTP API)
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const crdtStateCalls = fetchCalls.filter(
        (call) => String(call[0]).includes('/internal/crdt-state'),
      );
      expect(crdtStateCalls.length).toBeGreaterThan(0);
    });

    it('should fall back to HTTP when Hyperdrive query fails', async () => {
      const db = await import('../../src/db');

      // Make Hyperdrive path fail
      (db.runWithConnection as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Hyperdrive connection failed'),
      );

      // Mock HTTP API response for fallback
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          found: true,
          snapshot: { title: 'HTTP Fallback' },
        }), { status: 200 }),
      );

      const env = createMockEnv({
        HYPERDRIVE: { connectionString: 'postgresql://user:pass@host:5432/db' },
        INTERNAL_API_URL: 'http://localhost:8787',
        INTERNAL_SECRET: 'test-secret',
      });

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, env);

      const req = new Request('http://localhost/snapshot');
      const response = await session.fetch(req);
      const result = await response.json();

      // Should have fallen back to HTTP after Hyperdrive failure
      expect(result.snapshot.title).toBe('HTTP Fallback');
    });
  });

  describe('connection cleanup', () => {
    it('should use runWithConnection for proper connection lifecycle', async () => {
      const db = await import('../../src/db');

      (db.runWithConnection as ReturnType<typeof vi.fn>).mockImplementation(
        async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
      );
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const env = createMockEnv({
        HYPERDRIVE: { connectionString: 'postgresql://user:pass@host:5432/db' },
      });

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, env);

      const req = new Request('http://localhost/snapshot');
      await session.fetch(req);

      // Verify runWithConnection was called (ensures connection cleanup)
      expect(db.runWithConnection).toHaveBeenCalled();
    });
  });

  describe('HYPERDRIVE in env interface', () => {
    it('should accept HYPERDRIVE as optional binding in DocumentSessionEnv', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      // Should construct without HYPERDRIVE
      const session1 = new DocumentSession(
        mockState,
        createMockEnv({ HYPERDRIVE: undefined }),
      );
      expect(session1).toBeDefined();

      // Should construct with HYPERDRIVE
      const mockState2 = createMockState();
      const session2 = new DocumentSession(
        mockState2,
        createMockEnv({ HYPERDRIVE: { connectionString: 'postgresql://host/db' } }),
      );
      expect(session2).toBeDefined();
    });
  });
});
