/**
 * Phase 6.3: Checkpoint Bypass for Queue Tests
 *
 * Tests that DocumentSession checkpoint methods (createAgentPreEditCheckpoint,
 * createAgentPostEditCheckpoint, rollbackToAgentCheckpoint) use direct
 * Hyperdrive database access when available, falling back to HTTP.
 *
 * Key behaviors:
 * - Checkpoint start uses direct DB via createCheckpoint() when HYPERDRIVE available
 * - Checkpoint complete uses direct DB when HYPERDRIVE available
 * - Rollback uses direct DB via revertToCheckpoint() when HYPERDRIVE available
 * - Falls back to HTTP internal API when Hyperdrive is not available or fails
 * - Operations remain transactional via runWithConnection()
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import 'yjs';

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

// Mock the db module
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

// Mock the checkpoint service
vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
  BranchNotFoundError: class BranchNotFoundError extends Error {
    branchId: string;
    constructor(branchId: string) {
      super(`Branch not found: ${branchId}`);
      this.branchId = branchId;
    }
  },
  CheckpointNotFoundError: class CheckpointNotFoundError extends Error {
    checkpointId: string;
    constructor(checkpointId: string) {
      super(`Checkpoint not found: ${checkpointId}`);
      this.checkpointId = checkpointId;
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

function createMockState(
  sessionId = 'site-1:doc-1:branch-1',
): MockDurableObjectState {
  const storageData = new Map<string, unknown>();

  const storage: MockDurableObjectStorage = {
    get: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(storageData.get(key)),
    ),
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
    blockConcurrencyWhile: vi.fn().mockImplementation(
      async (cb: () => Promise<void>) => {
        await cb();
      },
    ),
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

describe('Phase 6.3: Checkpoint Bypass for Queue', () => {
  let mockState: MockDurableObjectState;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockState = createMockState();

    // Default: HTTP API responds with success
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ found: false }), { status: 404 }),
    );

    // Default: runWithConnection just runs the fn
    const db = await import('../../src/db');
    (db.runWithConnection as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _connStr: string,
        _opts: unknown,
        fn: () => Promise<unknown>,
      ) => fn(),
    );
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [],
      rowCount: 0,
    });

    // Default: checkpoint service mocks
    const checkpointService = await import(
      '../../src/services/checkpoint-service'
    );
    (checkpointService.createCheckpoint as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        checkpoint: { id: 'cp-direct-123' },
        documentCount: 1,
      });
    (checkpointService.revertToCheckpoint as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        checkpoint: { id: 'cp-direct-123' },
        documentsReverted: 2,
      });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('checkpoint start via direct DB', () => {
    it('should use direct DB for pre-edit checkpoint when HYPERDRIVE is available', async () => {
      const checkpointService = await import(
        '../../src/services/checkpoint-service'
      );
      const db = await import('../../src/db');

      const env = createMockEnv({
        HYPERDRIVE: { connectionString: 'postgresql://host/db' },
      });

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );
      const session = new DocumentSession(mockState as unknown, env);

      // Initialize the session
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Trigger agent-edit-start which calls createAgentPreEditCheckpoint
      const editStartReq = new Request(
        'http://localhost/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-1',
            trigger: 'autonomous',
            intent: 'test edit',
            targetRegions: ['$.content'],
          }),
        },
      );
      await session.fetch(editStartReq);

      // Should have used runWithConnection + createCheckpoint
      expect(db.runWithConnection).toHaveBeenCalledWith(
        'postgresql://host/db',
        expect.objectContaining({ isHyperdrive: true }),
        expect.any(Function),
      );
      expect(checkpointService.createCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          branchId: 'branch-1',
          checkpointType: 'agent_pre_edit',
          createdById: 'agent-1',
          createdByType: 'agent',
        }),
      );

      // HTTP fetch should NOT have been called for checkpoint
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const checkpointFetchCalls = fetchCalls.filter(
        (call) =>
          String(call[0]).includes('/internal/agent-checkpoint-start'),
      );
      expect(checkpointFetchCalls).toHaveLength(0);
    });
  });

  describe('checkpoint complete via direct DB', () => {
    it('should use direct DB for post-edit checkpoint when HYPERDRIVE is available', async () => {
      const checkpointService = await import(
        '../../src/services/checkpoint-service'
      );

      const env = createMockEnv({
        HYPERDRIVE: { connectionString: 'postgresql://host/db' },
      });

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );
      const session = new DocumentSession(mockState as unknown, env);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Start edit first (to create an edit session)
      (checkpointService.createCheckpoint as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          checkpoint: { id: 'cp-pre-123' },
          documentCount: 1,
        })
        .mockResolvedValueOnce({
          checkpoint: { id: 'cp-post-123' },
          documentCount: 1,
        });

      const editStartReq = new Request(
        'http://localhost/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-1',
            trigger: 'autonomous',
            intent: 'test edit',
            targetRegions: ['$.content'],
          }),
        },
      );
      const startResp = await session.fetch(editStartReq);
      const startResult = await startResp.json();

      // Complete the edit
      const editCompleteReq = new Request(
        'http://localhost/agent-edit-complete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            editSessionId: startResult.editSessionId,
          }),
        },
      );
      await session.fetch(editCompleteReq);

      // createCheckpoint should have been called twice (pre + post)
      expect(checkpointService.createCheckpoint).toHaveBeenCalledTimes(2);

      // The second call should be the post-edit checkpoint
      const secondCall = (
        checkpointService.createCheckpoint as ReturnType<typeof vi.fn>
      ).mock.calls[1][0];
      expect(secondCall).toMatchObject({
        checkpointType: 'agent_post_edit',
        createdById: 'agent-1',
      });
    });
  });

  describe('fallback to HTTP', () => {
    it('should fall back to HTTP for checkpoint when HYPERDRIVE is not available', async () => {
      // Mock HTTP checkpoint response
      globalThis.fetch = vi.fn().mockImplementation(
        (urlOrReq: string | Request) => {
          const urlStr = typeof urlOrReq === 'string'
            ? urlOrReq
            : urlOrReq.url;
          if (urlStr.includes('/internal/agent-checkpoint-start')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({ checkpointId: 'cp-http-123', documentCount: 1 }),
                { status: 200 },
              ),
            );
          }
          // Default 404 for other requests (like crdt-state init)
          return Promise.resolve(
            new Response(
              JSON.stringify({ found: false }),
              { status: 404 },
            ),
          );
        },
      );

      const env = createMockEnv({
        HYPERDRIVE: undefined,
        INTERNAL_API_URL: 'http://localhost:8787',
        INTERNAL_SECRET: 'test-secret',
      });

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );
      const session = new DocumentSession(mockState as unknown, env);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Start edit
      const editStartReq = new Request(
        'http://localhost/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-1',
            trigger: 'autonomous',
            intent: 'test edit',
            targetRegions: ['$.content'],
          }),
        },
      );
      await session.fetch(editStartReq);

      // HTTP should have been used for checkpoint
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const checkpointCalls = fetchCalls.filter(
        (call) =>
          String(call[0]).includes('/internal/agent-checkpoint-start'),
      );
      expect(checkpointCalls.length).toBeGreaterThan(0);
    });

    it('should fall back to HTTP when Hyperdrive checkpoint fails', async () => {
      const db = await import('../../src/db');

      // Make direct DB path fail
      (db.runWithConnection as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Hyperdrive connection failed'),
      );

      // Mock HTTP checkpoint response for fallback
      globalThis.fetch = vi.fn().mockImplementation(
        (urlOrReq: string | Request) => {
          const urlStr = typeof urlOrReq === 'string'
            ? urlOrReq
            : urlOrReq.url;
          if (urlStr.includes('/internal/agent-checkpoint-start')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  checkpointId: 'cp-fallback-123',
                  documentCount: 1,
                }),
                { status: 200 },
              ),
            );
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({ found: false }),
              { status: 404 },
            ),
          );
        },
      );

      const env = createMockEnv({
        HYPERDRIVE: { connectionString: 'postgresql://host/db' },
        INTERNAL_API_URL: 'http://localhost:8787',
        INTERNAL_SECRET: 'test-secret',
      });

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );
      const session = new DocumentSession(mockState as unknown, env);

      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const editStartReq = new Request(
        'http://localhost/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-1',
            trigger: 'autonomous',
            intent: 'test edit',
            targetRegions: ['$.content'],
          }),
        },
      );
      await session.fetch(editStartReq);

      // createCheckpoint via direct DB should have failed
      // HTTP fallback should have been used
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const checkpointCalls = fetchCalls.filter(
        (call) =>
          String(call[0]).includes('/internal/agent-checkpoint-start'),
      );
      expect(checkpointCalls.length).toBeGreaterThan(0);
    });
  });

  describe('transactional operations', () => {
    it('should use runWithConnection for checkpoint operations', async () => {
      const db = await import('../../src/db');

      const env = createMockEnv({
        HYPERDRIVE: { connectionString: 'postgresql://host/db' },
      });

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );
      const session = new DocumentSession(mockState as unknown, env);

      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const editStartReq = new Request(
        'http://localhost/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-1',
            trigger: 'autonomous',
            intent: 'test edit',
          }),
        },
      );
      await session.fetch(editStartReq);

      // Verify runWithConnection was called (ensures transactional behavior)
      expect(db.runWithConnection).toHaveBeenCalledWith(
        'postgresql://host/db',
        expect.objectContaining({ isHyperdrive: true }),
        expect.any(Function),
      );
    });
  });
});
