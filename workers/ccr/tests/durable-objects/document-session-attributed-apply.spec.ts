/**
 * An `/apply` that carries an attribution (an agent's accepted proposal, applied
 * for a person) is written to Postgres at once, as a version of its own that
 * carries the attribution, rather than waiting for the idle-timeout sync.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
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

const USER_ID = '55555555-5555-4555-8555-555555555555';
const AGENT_ID = '66666666-6666-4666-8666-666666666666';
const UUID_SESSION =
  'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001';

const attribution = {
  agent: { id: AGENT_ID, name: 'Copy Editor' },
  onBehalfOf: { id: USER_ID, name: 'Ada Lovelace' },
  description: 'Shorten the headline',
};

interface MockStorage {
  get: Mock;
  put: Mock;
  delete: Mock;
  list: Mock;
  getAlarm: Mock;
  setAlarm: Mock;
}

function createMockState(): {
  id: { toString: () => string; name: string };
  storage: MockStorage;
  blockConcurrencyWhile: Mock;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
  } {
  const data = new Map<string, unknown>();
  const storage: MockStorage = {
    get: vi.fn().mockImplementation((k: string) => Promise.resolve(data.get(k))),
    put: vi.fn().mockImplementation((k: string, v: unknown) => {
      data.set(k, v);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((k: string) => Promise.resolve(data.delete(k))),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };
  return {
    id: { toString: () => UUID_SESSION, name: UUID_SESSION },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
  };
}

function createEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    ...overrides,
  };
}

function applyRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Verified-Actor-Id': USER_ID,
      'X-Verified-Actor-Type': 'user',
      'X-Verified-Name': 'Ada Lovelace',
    },
    body: JSON.stringify({ actorId: USER_ID, ...body }),
  });
}

function syncBodies(): Record<string, unknown>[] {
  return (globalThis.fetch as Mock).mock.calls
    .filter((call: unknown[]) => String(call[0]).includes('/internal/crdt-sync'))
    .map((call: unknown[]) => JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>);
}

describe('attributed /apply', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const s = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (s.includes('/internal/crdt-sync')) {
        return Promise.resolve(new Response(JSON.stringify({ version: { id: 'v-1' } }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ found: false }), { status: 404 }));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects an attribution missing its parts', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(createMockState(), createEnv());

    const response = await session.fetch(applyRequest({
      operations: [{ type: 'set', path: 'title', value: 'Hello' }],
      attribution: { agent: { id: AGENT_ID } },
    }));

    expect(response.status).toBe(400);
    expect(syncBodies()).toHaveLength(0);
  });

  it('syncs at once with the attribution, instead of scheduling', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const mockState = createMockState();
    const session = new DocumentSession(mockState, createEnv());

    const response = await session.fetch(applyRequest({
      operations: [{ type: 'set', path: 'title', value: 'Hello' }],
      attribution,
    }));

    expect(response.status).toBe(200);
    const bodies = syncBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      actorId: USER_ID,
      actorType: 'user',
      actorName: 'Ada Lovelace',
      attribution,
      snapshot: { title: 'Hello' },
    });
    expect(mockState.storage.put.mock.calls.some((c: unknown[]) => c[0] === 'syncSchedule')).toBe(false);
  });

  it('writes edits already waiting as their own version before the attributed one', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(createMockState(), createEnv());

    await session.fetch(applyRequest({
      operations: [{ type: 'set', path: 'subtitle', value: 'By hand' }],
    }));
    expect(syncBodies()).toHaveLength(0);

    await session.fetch(applyRequest({
      operations: [{ type: 'set', path: 'title', value: 'Hello' }],
      attribution,
    }));

    const bodies = syncBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).not.toHaveProperty('attribution');
    expect(bodies[0]?.snapshot).toEqual({ subtitle: 'By hand' });
    expect(bodies[1]).toMatchObject({ attribution, snapshot: { subtitle: 'By hand', title: 'Hello' } });
  });

  it('schedules the sync, attribution included, when the immediate write fails', async () => {
    (globalThis.fetch as Mock).mockImplementation((url: string | URL | Request) => {
      const s = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      const status = s.includes('/internal/crdt-sync') ? 503 : 404;
      return Promise.resolve(new Response(JSON.stringify({ found: false }), { status }));
    });
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const mockState = createMockState();
    const session = new DocumentSession(mockState, createEnv());

    const response = await session.fetch(applyRequest({
      operations: [{ type: 'set', path: 'title', value: 'Hello' }],
      attribution,
    }));

    expect(response.status).toBe(200);
    const schedule = mockState.storage.put.mock.calls.find((c: unknown[]) => c[0] === 'syncSchedule');
    expect(schedule?.[1]).toMatchObject({ actorId: USER_ID, attribution });
  });

  it('refuses the apply when the edits already waiting cannot be written first', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(createMockState(), createEnv());

    await session.fetch(applyRequest({
      operations: [{ type: 'set', path: 'subtitle', value: 'By hand' }],
    }));
    (globalThis.fetch as Mock).mockImplementation((url: string | URL | Request) => {
      const s = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      const status = s.includes('/internal/crdt-sync') ? 503 : 404;
      return Promise.resolve(new Response(JSON.stringify({ found: false }), { status }));
    });

    const response = await session.fetch(applyRequest({
      operations: [{ type: 'set', path: 'title', value: 'Hello' }],
      attribution,
    }));

    expect(response.status).toBe(503);
    expect(syncBodies().every((body) => !('attribution' in body))).toBe(true);
    const snapshot = await session.fetch(new Request('http://localhost/snapshot'));
    const data = await snapshot.json<{ snapshot: Record<string, unknown> }>();
    expect(data.snapshot).toEqual({ subtitle: 'By hand' });
  });

  it('leaves the operations unapplied when the attribution is malformed', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(createMockState(), createEnv());

    await session.fetch(applyRequest({
      operations: [{ type: 'set', path: 'title', value: 'Hello' }],
      attribution: 'Copy Editor',
    }));
    const snapshot = await session.fetch(new Request('http://localhost/snapshot'));
    const data = await snapshot.json<{ snapshot: Record<string, unknown> }>();

    expect(data.snapshot).toEqual({});
  });
});

describe('attributed /apply over Hyperdrive', () => {
  let originalFetch: typeof globalThis.fetch;
  let database: DatabaseStub;

  beforeEach(async () => {
    vi.resetAllMocks();
    database = stubDatabase();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ found: false }), { status: 404 }),
    );
    const db = await import('../../src/db');
    (db.runWithConnection as Mock).mockImplementation(
      async (_conn: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('stores the attribution inside the version metadata', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(
      createMockState(),
      createEnv({ HYPERDRIVE: { connectionString: 'postgresql://u:p@h:5432/db' } }),
    );

    const response = await session.fetch(applyRequest({
      operations: [{ type: 'set', path: 'title', value: 'Hello' }],
      attribution,
    }));

    expect(response.status).toBe(200);
    const { createdById, createdByType, actionMetadata } = insertedVersion(database);
    expect(createdById).toBe(USER_ID);
    expect(createdByType).toBe('user');
    expect(JSON.parse(actionMetadata as string)).toMatchObject({ attribution });
  });
});
