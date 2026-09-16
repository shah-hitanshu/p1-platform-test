/**
 * CoW Fallback Tests for PostgresSyncManager.initializeFromHyperdrive()
 *
 * Tests the copy-on-write (CoW) fallback behavior: when a branch-specific
 * query returns 0 rows, the implementation should look up the branch's
 * source_branch_id and attempt to load the latest checkpointed version from
 * that source branch.
 *
 * These tests are written BEFORE the fix is implemented (TDD / red state).
 * All four test cases must FAIL until the CoW fallback is added to
 * initializeFromHyperdrive() in postgres-sync-manager.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as Y from 'yjs';
import { branches, documentVersions } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

// ---------------------------------------------------------------------------
// Mock cloudflare:workers — required because document-session-types imports
// DurableObject from cloudflare:workers (indirectly via document-session).
// PostgresSyncManager itself only imports from '../db' and yjs, but it also
// imports from './document-session-types' which pulls in cloudflare types.
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
}));

// ---------------------------------------------------------------------------
// Mock crdt-operations so applySnapshotToYMap is a spy we can assert on.
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

function createMockStorage(): MockDurableObjectStorage {
  const storageData = new Map<string, unknown>();
  return {
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
}

interface MockEnv {
  HYPERDRIVE?: { connectionString: string };
  INTERNAL_API_URL?: string;
  INTERNAL_SECRET?: string;
}

function createEnvWithHyperdrive(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    HYPERDRIVE: { connectionString: 'postgresql://user:pass@host:5432/db' },
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('PostgresSyncManager: CoW fallback in initializeFromHyperdrive()', () => {
  let storage: MockDurableObjectStorage;
  let ydoc: Y.Doc;
  let database: DatabaseStub;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.resetAllMocks();
    database = stubDatabase();

    storage = createMockStorage();
    ydoc = new Y.Doc();

    // Stub out globalThis.fetch so the HTTP fallback path (initializeFromHttpApi)
    // exits cleanly with "not found" instead of throwing a network error.
    // This ensures that when initializeFromHyperdrive() returns false the test
    // assertions — not a fetch error — are the reason a test fails.
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ found: false }), { status: 404 }),
    );

    // Default: runWithConnection just calls the inner function and returns its result.
    const db = await import('../../src/db');
    (db.runWithConnection as Mock).mockImplementation(
      async (
        _connStr: string,
        _opts: unknown,
        fn: () => Promise<unknown>,
      ) => fn(),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ydoc.destroy();
  });

  // -------------------------------------------------------------------------
  // Helper: build a PostgresSyncManager using real constructor.
  // We pass a session where siteId/documentId/branchId are all populated so
  // initializeFromPostgres() does not bail out early.
  // -------------------------------------------------------------------------
  async function buildManager(
    env: MockEnv,
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

  // =========================================================================
  // Test 1: CoW fallback applied — source branch has a published snapshot
  // =========================================================================
  it('applies snapshot from source branch when branch-specific query returns 0 rows', async () => {
    const { applySnapshotToYMap } = await import(
      '../../src/durable-objects/crdt-operations'
    );

    const sourceBranchSnapshot = { title: 'From source branch via CoW' };

    // The branch holds no version of its own, so the source branch it was cut
    // from is what the second document_versions read is keyed on.
    database.on(branches).select.returnsRaw([{ sourceBranchId: 'branch-source' }]);
    database.on(documentVersions).select.whenBound(['branch-source']).returnsRaw([
      { snapshot: sourceBranchSnapshot, versionNumber: 4 },
    ]);

    const manager = await buildManager(createEnvWithHyperdrive());

    // Invoke via the public method so initializeFromHyperdrive() is exercised.
    await manager.initializeFromPostgres();

    // The CoW snapshot must have been applied to the ydoc root map.
    expect(applySnapshotToYMap).toHaveBeenCalledWith(
      expect.anything(),
      sourceBranchSnapshot,
    );
    expect(database.calls(documentVersions).select).toHaveLength(2);
    expect(database.calls(branches).select).toHaveLength(1);
  });

  // =========================================================================
  // Test 2: No CoW when branch version exists — first query succeeds
  // =========================================================================
  it('does not run CoW queries when the branch-specific query returns a row', async () => {
    const { applySnapshotToYMap } = await import(
      '../../src/durable-objects/crdt-operations'
    );

    const branchSnapshot = { title: 'Direct branch snapshot' };

    database.on(documentVersions).select.returnsRaw([
      { snapshot: branchSnapshot, versionNumber: 2 },
    ]);

    const manager = await buildManager(createEnvWithHyperdrive());
    await manager.initializeFromPostgres();

    // Snapshot must be applied from the branch row
    expect(applySnapshotToYMap).toHaveBeenCalledWith(
      expect.anything(),
      branchSnapshot,
    );
    // The branch's own version answers, so neither the source-branch lookup nor
    // the CoW read is issued.
    expect(database.calls(documentVersions).select).toHaveLength(1);
    expect(database.calls(branches).select).toHaveLength(0);
  });

  // =========================================================================
  // Test 3: No CoW for main branch (source_branch_id is null / is_main = true)
  // =========================================================================
  it('returns false without applying a snapshot when the branch has no source_branch_id', async () => {
    const { applySnapshotToYMap } = await import(
      '../../src/durable-objects/crdt-operations'
    );

    // The lookup filters is_main = false AND source_branch_id IS NOT NULL, so a
    // main branch matches nothing rather than returning a row of nulls.
    const manager = await buildManager(createEnvWithHyperdrive());
    await manager.initializeFromPostgres();

    // No snapshot should have been applied
    expect(applySnapshotToYMap).not.toHaveBeenCalled();
    // The source-branch lookup ran and found nothing, so no CoW read followed.
    expect(database.calls(branches).select).toHaveLength(1);
    expect(database.calls(documentVersions).select).toHaveLength(1);
    // Storage put (persist) must NOT have been called because nothing was loaded
    expect(storage.put).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 4: No CoW when source branch has no published version
  // =========================================================================
  it('returns false without applying a snapshot when the CoW query returns 0 rows', async () => {
    const { applySnapshotToYMap } = await import(
      '../../src/durable-objects/crdt-operations'
    );

    // A source branch exists but holds no published version of the document.
    database.on(branches).select.returnsRaw([{ sourceBranchId: 'branch-source' }]);

    const manager = await buildManager(createEnvWithHyperdrive());
    await manager.initializeFromPostgres();

    // No snapshot should have been applied
    expect(applySnapshotToYMap).not.toHaveBeenCalled();
    expect(database.calls(documentVersions).select).toHaveLength(2);
    expect(database.calls(branches).select).toHaveLength(1);
    // Storage put (persist) must NOT have been called
    expect(storage.put).not.toHaveBeenCalled();
  });
});
