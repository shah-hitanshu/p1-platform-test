/**
 * Baseline provenance recording.
 *
 * Diagnostic only — the gate keys on whether the document has content, not on
 * how it got it. This field exists so a gate warning says which load path ran.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import * as Y from 'yjs';

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

vi.mock('../../src/durable-objects/crdt-operations', () => ({
  applySnapshotToYMap: vi.fn(),
}));

interface MockStorage {
  get: Mock; put: Mock; delete: Mock; list: Mock; getAlarm: Mock; setAlarm: Mock;
}

function createMockStorage(): MockStorage {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => Promise.resolve(data.get(key))),
    put: vi.fn((key: string, value: unknown) => { data.set(key, value); return Promise.resolve(); }),
    delete: vi.fn((key: string) => { data.delete(key); return Promise.resolve(true); }),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };
}

async function buildManager(storage: MockStorage, ydoc: Y.Doc, env: unknown) {
  const { PostgresSyncManager } = await import(
    '../../src/durable-objects/postgres-sync-manager'
  );
  return new PostgresSyncManager(
    env as never,
    () => ({ siteId: 'site-1', documentId: 'doc-1', branchId: 'branch-1' }),
    () => ydoc,
    storage as never,
  );
}

describe('PostgresSyncManager baselineSource', () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    vi.resetAllMocks();
    ydoc = new Y.Doc();
  });

  it("defaults to 'restored' before any Postgres load runs", async () => {
    const manager = await buildManager(createMockStorage(), ydoc, {});
    expect(manager.baselineSource).toBe('restored');
  });

  it("records 'branch' when the branch has its own version", async () => {
    const { runWithConnection, query } = await import('../../src/db');
    (runWithConnection as Mock).mockImplementation(
      (_conn: string, _opts: unknown, cb: () => Promise<boolean>) => cb(),
    );
    (query as Mock).mockResolvedValueOnce({
      rows: [{ snapshot: { content: [] }, version_number: 3 }],
    });

    const manager = await buildManager(createMockStorage(), ydoc, {
      HYPERDRIVE: { connectionString: 'postgresql://x' },
    });
    await manager.initializeFromPostgres();

    expect(manager.baselineSource).toBe('branch');
  });

  it("records 'cow' when the baseline comes from the source branch", async () => {
    const { runWithConnection, query } = await import('../../src/db');
    (runWithConnection as Mock).mockImplementation(
      (_conn: string, _opts: unknown, cb: () => Promise<boolean>) => cb(),
    );
    (query as Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ source_branch_id: 'branch-source' }] })
      .mockResolvedValueOnce({ rows: [{ snapshot: { content: [] }, version_number: 7 }] });

    const manager = await buildManager(createMockStorage(), ydoc, {
      HYPERDRIVE: { connectionString: 'postgresql://x' },
    });
    await manager.initializeFromPostgres();

    expect(manager.baselineSource).toBe('cow');
  });

  it("records 'none' when neither the branch nor a CoW source has a version", async () => {
    const { runWithConnection, query } = await import('../../src/db');
    (runWithConnection as Mock).mockImplementation(
      (_conn: string, _opts: unknown, cb: () => Promise<boolean>) => cb(),
    );
    (query as Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const manager = await buildManager(createMockStorage(), ydoc, {
      HYPERDRIVE: { connectionString: 'postgresql://x' },
    });
    await manager.initializeFromPostgres();

    expect(manager.baselineSource).toBe('none');
  });
});
