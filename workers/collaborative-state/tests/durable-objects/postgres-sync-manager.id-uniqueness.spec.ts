/**
 * Within-document props.id uniqueness backstop at the Durable Object immediate
 * sync write.
 *
 * executeDirectSync flushes the current CRDT snapshot straight to PostgreSQL.
 * Its snapshot must carry unique component props.id values: the first
 * occurrence in walk order (content[] then zones arrays) keeps its id; later
 * duplicates are re-minted to `${type}-${uuid}` and a structured warning fires.
 * A snapshot with no duplicates is written unchanged with no warning.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
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

const MINTED_ID = /-[0-9a-f]{8}-/;

interface Comp {
  type: string;
  props: { id: string; [key: string]: unknown };
}

function comp(type: string, id: string, extra: Record<string, unknown> = {}): Comp {
  return { type, props: { id, ...extra } };
}

interface MockStorage {
  get: Mock;
  put: Mock;
  delete: Mock;
  list: Mock;
  getAlarm: Mock;
  setAlarm: Mock;
}

function createMockStorage(): MockStorage {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(data.get(key))),
    put: vi.fn().mockImplementation((key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => Promise.resolve(data.delete(key))),
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

function createEnv(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    HYPERDRIVE: { connectionString: 'postgresql://user:pass@host:5432/db' },
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    ...overrides,
  };
}

/** Params array of the query call that inserts into document_versions. */
function insertVersionParams(queryMock: Mock): unknown[] {
  const call = queryMock.mock.calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO app.document_versions'),
  );
  if (call === undefined) {
    throw new Error('No INSERT INTO app.document_versions call was captured');
  }
  return call[1] as unknown[];
}

async function buildManager(
  env: MockEnv,
  ydoc: Y.Doc,
  storage: MockStorage,
  sessionId = 'site-1:doc-direct-333:branch-xyz',
): Promise<InstanceType<typeof import('../../src/durable-objects/postgres-sync-manager').PostgresSyncManager>> {
  const { PostgresSyncManager } = await import('../../src/durable-objects/postgres-sync-manager');
  const [siteId, documentId, branchId] = sessionId.split(':');
  return new PostgresSyncManager(
    env as never,
    () => ({ siteId, documentId, branchId }),
    () => ydoc,
    storage as never,
  );
}

describe('executeDirectSync within-document id uniqueness', () => {
  let storage: MockStorage;
  let ydoc: Y.Doc;
  let warnSpy: Mock;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.resetAllMocks();
    storage = createMockStorage();
    ydoc = new Y.Doc();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as Mock;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ found: false }), { status: 404 }),
    );

    const db = await import('../../src/db');
    (db.runWithConnection as Mock).mockImplementation(
      async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
    );
    (db.query as Mock).mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ydoc.destroy();
  });

  it('re-mints later duplicates in content while the first occurrence keeps its id', async () => {
    const db = await import('../../src/db');
    const queryMock = db.query as Mock;

    const root = ydoc.getMap('root');
    root.set('content', [
      comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
      comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
    ]);

    const manager = await buildManager(createEnv(), ydoc, storage);
    await manager.performDirectSync('http://localhost:8787', 'test-secret', 'user-1', 'user');

    const persisted = insertVersionParams(queryMock)[2] as { content: Comp[] };
    expect(persisted.content).toHaveLength(2);
    expect(persisted.content[0].props.id).toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).not.toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).toMatch(MINTED_ID);
    expect(persisted.content[1].props.id).toMatch(/^HeroBlock-/);
    expect(persisted.content[1].props.title).toBe('Second');
  });

  it('walks content before zones so a content occurrence keeps the id over a zones duplicate', async () => {
    const db = await import('../../src/db');
    const queryMock = db.query as Mock;

    const root = ydoc.getMap('root');
    root.set('content', [comp('HeroBlock', 'shared-slot', { title: 'In content' })]);
    root.set('zones', {
      'root:main': [comp('HeroBlock', 'shared-slot', { title: 'In zone' })],
    });

    const manager = await buildManager(createEnv(), ydoc, storage);
    await manager.performDirectSync('http://localhost:8787', 'test-secret', 'user-1', 'user');

    const persisted = insertVersionParams(queryMock)[2] as {
      content: Comp[];
      zones: Record<string, Comp[]>;
    };
    expect(persisted.content[0].props.id).toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).not.toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).toMatch(MINTED_ID);
  });

  it('logs a structured warning naming the document and the previous and new ids', async () => {
    const db = await import('../../src/db');
    const queryMock = db.query as Mock;

    const root = ydoc.getMap('root');
    root.set('content', [
      comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
      comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
    ]);

    const manager = await buildManager(createEnv(), ydoc, storage);
    await manager.performDirectSync('http://localhost:8787', 'test-secret', 'user-1', 'user');

    const newId = (insertVersionParams(queryMock)[2] as { content: Comp[] }).content[1].props.id;
    expect(warnSpy).toHaveBeenCalled();
    const output = JSON.stringify(warnSpy.mock.calls);
    expect(output).toContain('doc-direct-333');
    expect(output).toContain('HeroBlock-dup');
    expect(output).toContain(newId);
  });

  it('writes a snapshot with unique ids unchanged and does not warn', async () => {
    const db = await import('../../src/db');
    const queryMock = db.query as Mock;

    const snapshot = {
      content: [
        comp('HeroBlock', 'HeroBlock-a', { title: 'A' }),
        comp('BodyBlock', 'BodyBlock-b', { text: 'B' }),
      ],
      zones: {
        'root:main': [comp('CardBlock', 'CardBlock-c', { label: 'C' })],
      },
    };

    const root = ydoc.getMap('root');
    root.set('content', structuredClone(snapshot.content));
    root.set('zones', structuredClone(snapshot.zones));

    const manager = await buildManager(createEnv(), ydoc, storage);
    await manager.performDirectSync('http://localhost:8787', 'test-secret', 'user-1', 'user');

    const persisted = insertVersionParams(queryMock)[2];
    expect(persisted).toEqual(snapshot);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
