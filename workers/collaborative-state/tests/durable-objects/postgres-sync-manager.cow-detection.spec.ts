/**
 * CoW Baseline Mismatch Detection Tests for PostgresSyncManager
 *
 * Tests the copy-on-write (CoW) baseline mismatch detection: when the first
 * sync after a CoW-initialized Durable Object contains a snapshot with zero
 * component overlap with the CoW baseline IDs stored in DO storage, a
 * structured warning should be logged.
 *
 * These tests are written BEFORE the implementation is added (TDD / red state).
 * All six test cases must FAIL until:
 *  1. COW_BASELINE_IDS_KEY is exported from document-session-types.ts
 *  2. detectCoWBaselineMismatch() is implemented in PostgresSyncManager
 *  3. detectCoWBaselineMismatch() is called from performSync() and executeDirectSync()
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as Y from 'yjs';

const loggerWarn = vi.fn();
vi.mock('@pantheon-systems/p1-telemetry', () => ({
  getLogger: () => ({ warn: loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Import the constant that does not yet exist — this will cause a compile /
// import failure until the implementation is added, keeping all tests red.
// ---------------------------------------------------------------------------
import { COW_BASELINE_IDS_KEY } from '../../src/durable-objects/document-session-types';

// ---------------------------------------------------------------------------
// Mock cloudflare:workers — required because document-session-types imports
// DurableObject from cloudflare:workers (indirectly).
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Mock the db module — we control runWithConnection and query per-test.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Mock crdt-operations so applySnapshotToYMap does not throw.
// ---------------------------------------------------------------------------
vi.mock('../../src/durable-objects/crdt-operations', () => ({
  applySnapshotToYMap: vi.fn(),
}));

// =============================================================================
// Helper types & factories
// =============================================================================

interface MockDurableObjectStorage {
  get: Mock;
  put: Mock;
  delete: Mock;
  list: Mock;
  getAlarm: Mock;
  setAlarm: Mock;
}

function createMockStorage(
  initial: Map<string, unknown> = new Map<string, unknown>(),
): MockDurableObjectStorage {
  const storageData = new Map<string, unknown>(initial);
  return {
    get: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(storageData.get(key)),
    ),
    put: vi.fn().mockImplementation((key: string, value: unknown) => {
      storageData.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => {
      storageData.delete(key);
      return Promise.resolve(true);
    }),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };
}

interface MockQueueEnv {
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
  SYNC_QUEUE: { send: Mock };
}

interface MockHyperdriveEnv {
  HYPERDRIVE: { connectionString: string };
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
}

function createQueueEnv(): MockQueueEnv {
  return {
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    SYNC_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

function createHyperdriveEnv(): MockHyperdriveEnv {
  return {
    HYPERDRIVE: { connectionString: 'postgresql://user:pass@host:5432/db' },
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
  };
}

async function buildManager(
  env: MockQueueEnv | MockHyperdriveEnv,
  storage: MockDurableObjectStorage,
  ydoc: Y.Doc,
  sessionId = 'site-1:doc-abc:branch-xyz',
): Promise<InstanceType<typeof import('../../src/durable-objects/postgres-sync-manager').PostgresSyncManager>> {
  const { PostgresSyncManager } = await import(
    '../../src/durable-objects/postgres-sync-manager'
  );

  const sessionInfo = {
    siteId: sessionId.split(':')[0],
    documentId: sessionId.split(':')[1],
    branchId: sessionId.split(':')[2],
  };

  return new PostgresSyncManager(
    env as never,
    () => sessionInfo,
    () => ydoc,
    storage as never,
  );
}

// =============================================================================
// Tests
// =============================================================================

describe('PostgresSyncManager: CoW baseline mismatch detection', () => {
  let ydoc: Y.Doc;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    loggerWarn.mockClear();

    ydoc = new Y.Doc();

    // Stub globalThis.fetch so HTTP fallback paths exit cleanly.
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ found: false }), { status: 200 }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ydoc.destroy();
  });

  // =========================================================================
  // Test 1: Queue path — zero overlap → warning logged
  // =========================================================================
  it('logs a warning when the first sync snapshot has no component overlap with CoW baseline (queue path)', async () => {
    const storageData = new Map<string, unknown>([
      [COW_BASELINE_IDS_KEY, ['id-A', 'id-B', 'id-C']],
    ]);
    const storage = createMockStorage(storageData);
    const env = createQueueEnv();

    // Set ydoc content with no overlap against baseline
    const root = ydoc.getMap('root');
    root.set('content', [
      { type: 'Hero', props: { id: 'id-X' } },
      { type: 'Text', props: { id: 'id-Y' } },
    ]);
    root.set('zones', {});

    const manager = await buildManager(env, storage, ydoc);
    await manager.syncToPostgres('actor-1', 'user');

    expect(loggerWarn).toHaveBeenCalledWith(
      'cow baseline mismatch',
      expect.objectContaining({
        document_id: 'doc-abc',
        branch_id: 'branch-xyz',
        principal_id: 'actor-1',
        reason: 'cow_baseline_mismatch',
      }),
    );
  });

  // =========================================================================
  // Test 2: Queue path — shared component ID → no warning
  // =========================================================================
  it('does not log a warning when the first sync snapshot shares component IDs with the CoW baseline', async () => {
    const storageData = new Map<string, unknown>([
      [COW_BASELINE_IDS_KEY, ['id-A', 'id-B', 'id-C']],
    ]);
    const storage = createMockStorage(storageData);
    const env = createQueueEnv();

    // id-A overlaps with baseline
    const root = ydoc.getMap('root');
    root.set('content', [
      { type: 'Hero', props: { id: 'id-A' } },
      { type: 'Text', props: { id: 'id-D' } },
    ]);
    root.set('zones', {});

    const manager = await buildManager(env, storage, ydoc);
    await manager.syncToPostgres('actor-1', 'user');

    // Confirm warn was NOT called for the mismatch event
    const mismatchCalls = loggerWarn.mock.calls.filter(
      (args) => args[0] === 'cow baseline mismatch',
    );
    expect(mismatchCalls).toHaveLength(0);
  });

  // =========================================================================
  // Test 3: No baseline in storage → no warning
  // =========================================================================
  it('does not log a warning when no CoW baseline IDs are stored', async () => {
    // Storage has no COW_BASELINE_IDS_KEY entry
    const storage = createMockStorage();
    const env = createQueueEnv();

    const root = ydoc.getMap('root');
    root.set('content', [
      { type: 'Hero', props: { id: 'id-X' } },
    ]);
    root.set('zones', {});

    const manager = await buildManager(env, storage, ydoc);
    await manager.syncToPostgres('actor-1', 'user');

    const mismatchCalls = loggerWarn.mock.calls.filter(
      (args) => args[0] === 'cow baseline mismatch',
    );
    expect(mismatchCalls).toHaveLength(0);
  });

  // =========================================================================
  // Test 4: Baseline key deleted after first sync — detection does not repeat
  // =========================================================================
  it('deletes the baseline key after the first sync so detection does not fire again', async () => {
    const storageData = new Map<string, unknown>([
      [COW_BASELINE_IDS_KEY, ['id-A', 'id-B']],
    ]);
    const storage = createMockStorage(storageData);
    const env = createQueueEnv();

    const root = ydoc.getMap('root');
    root.set('content', [{ type: 'Hero', props: { id: 'id-X' } }]);
    root.set('zones', {});

    const manager = await buildManager(env, storage, ydoc);

    // First sync — should log warning
    await manager.syncToPostgres('actor-1', 'user');
    expect(loggerWarn).toHaveBeenCalledWith(
      'cow baseline mismatch',
      expect.anything(),
    );

    // Clear the spy and run a second sync
    loggerWarn.mockClear();
    await manager.syncToPostgres('actor-1', 'user');

    // No mismatch warning on second call
    const mismatchCalls = loggerWarn.mock.calls.filter(
      (args) => args[0] === 'cow baseline mismatch',
    );
    expect(mismatchCalls).toHaveLength(0);

    // Baseline key must have been explicitly deleted from storage
    expect(storage.delete).toHaveBeenCalledWith(COW_BASELINE_IDS_KEY);
    const storedBaseline = await storage.get(COW_BASELINE_IDS_KEY);
    expect(storedBaseline).toBeUndefined();
  });

  // =========================================================================
  // Test 5: Direct Hyperdrive sync path — zero overlap → warning logged
  // =========================================================================
  it('logs a warning on the direct Hyperdrive sync path when zero overlap detected', async () => {
    const db = await import('../../src/db');

    // runWithConnection delegates directly to the inner function
    (db.runWithConnection as Mock).mockImplementation(
      async (
        _connStr: string,
        _opts: unknown,
        fn: () => Promise<unknown>,
      ) => fn(),
    );
    // query returns no rows so the INSERT path completes without error
    (db.query as Mock).mockResolvedValue({ rows: [], rowCount: 0 });

    const storageData = new Map<string, unknown>([
      [COW_BASELINE_IDS_KEY, ['id-A', 'id-B', 'id-C']],
    ]);
    const storage = createMockStorage(storageData);
    const env = createHyperdriveEnv();

    const root = ydoc.getMap('root');
    root.set('content', [
      { type: 'Hero', props: { id: 'id-X' } },
      { type: 'Text', props: { id: 'id-Y' } },
    ]);
    root.set('zones', {});

    const manager = await buildManager(env, storage, ydoc);
    await manager.performDirectSync(
      'http://localhost:8787',
      'test-secret',
      'actor-1',
      'user',
    );

    expect(loggerWarn).toHaveBeenCalledWith(
      'cow baseline mismatch',
      expect.objectContaining({
        document_id: 'doc-abc',
        branch_id: 'branch-xyz',
        principal_id: 'actor-1',
        reason: 'cow_baseline_mismatch',
      }),
    );
    expect(storage.delete).toHaveBeenCalledWith(COW_BASELINE_IDS_KEY);
  });

  // =========================================================================
  // Test 6: Components only in zones (not content array) — warning logged
  // =========================================================================
  it('detects mismatch when components are only in zones (not content array)', async () => {
    const storageData = new Map<string, unknown>([
      [COW_BASELINE_IDS_KEY, ['id-A', 'id-B']],
    ]);
    const storage = createMockStorage(storageData);
    const env = createQueueEnv();

    // content is empty; a zone-only component with non-overlapping id
    const root = ydoc.getMap('root');
    root.set('content', []);
    root.set('zones', {
      'zone-1': [{ type: 'Hero', props: { id: 'id-X' } }],
    });

    const manager = await buildManager(env, storage, ydoc);
    await manager.syncToPostgres('actor-1', 'user');

    expect(loggerWarn).toHaveBeenCalledWith(
      'cow baseline mismatch',
      expect.objectContaining({
        document_id: 'doc-abc',
        branch_id: 'branch-xyz',
        principal_id: 'actor-1',
        reason: 'cow_baseline_mismatch',
      }),
    );
    expect(storage.delete).toHaveBeenCalledWith(COW_BASELINE_IDS_KEY);
  });
});
