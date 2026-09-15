/**
 * Invariants of the synchronous flush to PostgreSQL.
 *
 * The flush is the write path behind publishing, edit-session completion and
 * the session's own /flush endpoint, so it carries the same Puck action
 * metadata the queued path does, marks the session clean once the write
 * commits, and serializes against every other write from the same session.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as Y from 'yjs';
import { documentVersions } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { insertedVersion } from '../helpers/direct-sync';

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

/** A uuid actor takes the direct Hyperdrive write; anything else goes over HTTP. */
const ACTOR_UUID = '00000000-0000-4000-a000-000000000001';
const ACTOR_OAUTH_SUBJECT = 'auth0|abc123';

const INTERNAL_API_URL = 'http://localhost:8787';
const INTERNAL_SECRET = 'test-secret';

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

function createEnv(): Record<string, unknown> {
  return {
    HYPERDRIVE: { connectionString: 'postgresql://user:pass@host:5432/db' },
    INTERNAL_API_URL,
    INTERNAL_SECRET,
  };
}

type Manager = InstanceType<
  typeof import('../../src/durable-objects/postgres-sync-manager').PostgresSyncManager
>;

async function buildManager(ydoc: Y.Doc, storage: MockStorage): Promise<Manager> {
  const { PostgresSyncManager } = await import('../../src/durable-objects/postgres-sync-manager');
  return new PostgresSyncManager(
    createEnv(),
    () => ({ siteId: 'site-1', documentId: 'doc-1', branchId: 'branch-1' }),
    () => ydoc,
    storage as never,
  );
}

/**
 * What the direct-sync INSERT bound, by what each value carries. The statement
 * names its parameters only by position, so the positions are read once here
 * rather than in every assertion.
 */
describe('Flushing a session to PostgreSQL', () => {
  let storage: MockStorage;
  let ydoc: Y.Doc;
  let database: DatabaseStub;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.resetAllMocks();
    database = stubDatabase();
    database.on(documentVersions).insert.returnsRaw([{ id: 'version-1' }]);
    storage = createMockStorage();
    ydoc = new Y.Doc();
    ydoc.getMap('root').set('title', 'Hello');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: { id: 'version-1' } }), { status: 200 }),
    );

    const db = await import('../../src/db');
    (db.runWithConnection as Mock).mockImplementation(
      async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ydoc.destroy();
  });

  describe('Puck action metadata', () => {
    it('classifies the version from the actions the pending sync carries', async () => {
      await storage.put('syncSchedule', {
        actorId: ACTOR_UUID,
        actorType: 'user',
        dueAt: Date.now(),
        puckActions: [{ type: 'reorder', from: 0, to: 2 }],
      });
      const manager = await buildManager(ydoc, storage);

      await manager.flushAndSync(
        () => Promise.resolve(),
        { actorId: ACTOR_UUID, actorType: 'user' },
      );

      const version = insertedVersion(database);
      expect(version.actionType).toBe('structural');
      expect(JSON.parse(version.actionMetadata as string)).toEqual({
        puckActions: [{ type: 'reorder', from: 0, to: 2 }],
      });
    });

    it('classifies the version from actions held in memory when no sync is owed', async () => {
      const manager = await buildManager(ydoc, storage);
      manager.pendingPuckActions = [{ type: 'set', propName: 'title' }];

      await manager.flushAndSync(
        () => Promise.resolve(),
        { actorId: ACTOR_UUID, actorType: 'user' },
      );

      expect(insertedVersion(database).actionType).toBe('prop_update');
    });

    it('leaves the version unclassified when the edit carries no actions', async () => {
      const manager = await buildManager(ydoc, storage);

      await manager.flushAndSync(
        () => Promise.resolve(),
        { actorId: ACTOR_UUID, actorType: 'user' },
      );

      const version = insertedVersion(database);
      expect(version.actionType).toBeNull();
      expect(version.actionMetadata).toBeNull();
    });

    it('sends the actions to the internal API when the actor is resolved server-side', async () => {
      const manager = await buildManager(ydoc, storage);
      manager.pendingPuckActions = [{ type: 'insert', componentType: 'Hero' }];

      await manager.flushAndSync(
        () => Promise.resolve(),
        { actorId: ACTOR_OAUTH_SUBJECT, actorType: 'agent' },
      );

      const [, init] = (globalThis.fetch as Mock).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        puckActions?: { type: string }[];
      };
      expect(body.puckActions).toEqual([{ type: 'insert', componentType: 'Hero' }]);
    });

    it('records an action only on the version whose content includes it', async () => {
      const release: (() => void)[] = [];
      const sent: { puckActions?: { type: string }[]; snapshot: Record<string, unknown> }[] = [];
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string) as (typeof sent)[number]);
        await new Promise<void>((resolve) => release.push(resolve));
        return new Response(JSON.stringify({ version: { id: 'version-1' } }), { status: 200 });
      });

      const manager = await buildManager(ydoc, storage);
      manager.pendingPuckActions = [{ type: 'reorder', slot: 'first' }];

      const first = manager.flushAndSync(
        () => Promise.resolve(),
        { actorId: ACTOR_OAUTH_SUBJECT, actorType: 'agent' },
      );
      const second = manager.flushAndSync(
        () => Promise.resolve(),
        { actorId: ACTOR_OAUTH_SUBJECT, actorType: 'agent' },
      );

      // A second edit arrives after the first write captured its snapshot.
      await vi.waitFor(() => {
        expect(release).toHaveLength(1);
      });
      ydoc.getMap('root').set('subtitle', 'Added later');
      manager.pendingPuckActions.push({ type: 'insert', slot: 'second' });
      release[0]();

      await vi.waitFor(() => {
        expect(release).toHaveLength(2);
      });
      release[1]();
      await Promise.all([first, second]);

      expect(sent[0]?.puckActions).toEqual([{ type: 'reorder', slot: 'first' }]);
      expect(sent[0]?.snapshot).not.toHaveProperty('subtitle');
      expect(sent[1]?.puckActions).toEqual([{ type: 'insert', slot: 'second' }]);
      expect(sent[1]?.snapshot).toHaveProperty('subtitle', 'Added later');
    });

    it('holds no actions against the next version once they are written', async () => {
      const manager = await buildManager(ydoc, storage);
      manager.pendingPuckActions = [{ type: 'reorder' }];

      await manager.flushAndSync(
        () => Promise.resolve(),
        { actorId: ACTOR_UUID, actorType: 'user' },
      );

      expect(manager.pendingPuckActions).toEqual([]);
    });
  });

  describe('A committed write', () => {
    it('is recorded as synced even when the response body cannot be read', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('not json', { status: 200 }),
      );
      await storage.put('syncSchedule', {
        actorId: ACTOR_OAUTH_SUBJECT,
        actorType: 'agent',
        dueAt: Date.now(),
      });
      const manager = await buildManager(ydoc, storage);

      const versionId = await manager.flushAndSync(
        () => Promise.resolve(),
        { actorId: ACTOR_OAUTH_SUBJECT, actorType: 'agent' },
      );

      expect(versionId).toBeUndefined();
      expect(await storage.get('syncSchedule')).toBeUndefined();
    });

    it('leaves an edit that arrived mid-write owing a sync', async () => {
      const release: (() => void)[] = [];
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        await new Promise<void>((resolve) => release.push(resolve));
        return new Response(JSON.stringify({ version: { id: 'version-1' } }), { status: 200 });
      });
      const manager = await buildManager(ydoc, storage);

      const flush = manager.flushAndSync(
        () => Promise.resolve(),
        { actorId: ACTOR_OAUTH_SUBJECT, actorType: 'agent' },
      );
      await vi.waitFor(() => {
        expect(release).toHaveLength(1);
      });
      ydoc.getMap('root').set('subtitle', 'Added later');
      await manager.scheduleSync(ACTOR_OAUTH_SUBJECT, 'agent');
      release[0]();
      await flush;

      expect(await storage.get('syncSchedule')).toBeDefined();
      expect(manager.lastSyncedStateVectorHash).not.toBe(manager.computeStateVectorHash());
    });

    it('is reported as failed when the write itself is refused', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('sync unavailable', { status: 503 }),
      );
      const manager = await buildManager(ydoc, storage);

      await expect(
        manager.flushAndSync(
          () => Promise.resolve(),
          { actorId: ACTOR_OAUTH_SUBJECT, actorType: 'agent' },
        ),
      ).rejects.toThrow('HTTP sync failed');
    });
  });

  describe('Concurrent flushes', () => {
    it('writes one at a time so two versions never claim the same number', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const release: (() => void)[] = [];

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => release.push(resolve));
        inFlight -= 1;
        return new Response(JSON.stringify({ version: { id: 'version-1' } }), { status: 200 });
      });

      const manager = await buildManager(ydoc, storage);
      const flushes = [0, 1, 2].map(() =>
        manager.performDirectSync(
          INTERNAL_API_URL, INTERNAL_SECRET, ACTOR_OAUTH_SUBJECT, 'agent',
        ),
      );

      // Let each queued write reach the request it is waiting on, then answer it.
      for (let i = 0; i < 3; i += 1) {
        await vi.waitFor(() => {
          expect(release).toHaveLength(i + 1);
        });
        release[i]();
      }
      await Promise.all(flushes);

      expect(maxInFlight).toBe(1);
      expect((globalThis.fetch as Mock).mock.calls).toHaveLength(3);
    });

    it('runs the writes queued behind one that fails', async () => {
      let attempt = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.resolve(new Response('sync unavailable', { status: 503 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ version: { id: 'version-2' } }), { status: 200 }),
        );
      });

      const manager = await buildManager(ydoc, storage);
      const failing = manager.performDirectSync(
        INTERNAL_API_URL, INTERNAL_SECRET, ACTOR_OAUTH_SUBJECT, 'agent',
      );
      const queued = manager.performDirectSync(
        INTERNAL_API_URL, INTERNAL_SECRET, ACTOR_OAUTH_SUBJECT, 'agent',
      );

      await expect(failing).rejects.toThrow('HTTP sync failed');
      await expect(queued).resolves.toBe('version-2');
    });
  });
});
