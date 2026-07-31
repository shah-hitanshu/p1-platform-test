/**
 * Sync writes attribute created_by_id to the resolved dbUserId (app.users.id).
 * Over HTTP `/apply` the scheduled sync takes it from the verified header,
 * falling back to the body actorId when absent. On the direct-Hyperdrive flush
 * a uuid dbUserId is bound straight into the INSERT.
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

const RAW_SUBJECT = 'google-oauth2|107221644627712432289';
const DB_USER_ID = '02588e62-6dd1-545c-88c4-9a127fafba3f';
// The /apply route requires a uuid siteId:documentId:branchId session key.
const UUID_SESSION =
  'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001';

interface MockStorage {
  get: Mock;
  put: Mock;
  delete: Mock;
  list: Mock;
  getAlarm: Mock;
  setAlarm: Mock;
}

function createMockState(sessionId = 'site-1:doc-1:branch-1'): {
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
    id: { toString: () => sessionId, name: sessionId },
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

function scheduledActorId(mockState: { storage: MockStorage }): unknown {
  const put = mockState.storage.put.mock.calls.find((c: unknown[]) => c[0] === 'syncSchedule');
  return (put?.[1] as { actorId?: string } | undefined)?.actorId;
}

describe('HTTP /apply sync attribution', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ found: false }), { status: 404 }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function applyEdit(headers: Record<string, string>): Promise<{ storage: MockStorage }> {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const mockState = createMockState(UUID_SESSION);
    const session = new DocumentSession(mockState, createEnv());
    await session.fetch(new Request('http://localhost/snapshot'));

    await session.fetch(new Request('http://localhost/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        actorId: RAW_SUBJECT,
        operations: [{ type: 'set', path: '/title', value: 'Edit' }],
      }),
    }));
    return mockState;
  }

  it('schedules the sync attributed to the verified dbUserId', async () => {
    const mockState = await applyEdit({
      'X-Verified-Actor-Id': RAW_SUBJECT,
      'X-Verified-Actor-Type': 'user',
      'X-Verified-Db-User-Id': DB_USER_ID,
    });

    expect(scheduledActorId(mockState)).toBe(DB_USER_ID);
  });

  it('falls back to the body actorId when no verified dbUserId is present', async () => {
    const mockState = await applyEdit({
      'X-Verified-Actor-Id': RAW_SUBJECT,
      'X-Verified-Actor-Type': 'user',
    });

    expect(scheduledActorId(mockState)).toBe(RAW_SUBJECT);
  });
});

describe('Direct-Hyperdrive flush attribution', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    vi.resetAllMocks();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const s = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (s.includes('/internal/publish')) {
        return Promise.resolve(new Response(JSON.stringify({
          checkpoint: { id: 'cp-1' },
          publishedVersionId: 'v-1',
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ found: false }), { status: 404 }));
    });

    const db = await import('../../src/db');
    (db.runWithConnection as Mock).mockImplementation(
      async (_conn: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
    );
    (db.query as Mock).mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('writes the resolved dbUserId to created_by_id via the direct INSERT', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const db = await import('../../src/db');
    const mockState = createMockState();
    const session = new DocumentSession(
      mockState,
      createEnv({ HYPERDRIVE: { connectionString: 'postgresql://u:p@h:5432/db' } }),
    );
    await session.fetch(new Request('http://localhost/snapshot'));

    const sender = {
      readyState: 1,
      send: vi.fn(),
      serializeAttachment: vi.fn(),
      deserializeAttachment: () => ({ actorId: RAW_SUBJECT, actorType: 'user', dbUserId: DB_USER_ID }),
    } as unknown as WebSocket;
    mockState.getWebSockets.mockReturnValue([sender]);

    const doc = new Y.Doc();
    doc.getMap('root').set('title', 'Test');
    await session.webSocketMessage(sender, Y.encodeStateAsUpdate(doc).buffer);

    await session.webSocketMessage(sender, JSON.stringify({
      type: 'publish_request',
      requestId: 'req-1',
      timestamp: Date.now(),
    }));

    const insert = (db.query as Mock).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0]).includes('INSERT INTO app.document_versions'),
    );
    if (insert === undefined) throw new Error('expected direct INSERT into document_versions');
    // params: [documentId, branchId, snapshot, created_by_id, created_by_type]
    expect((insert[1] as unknown[])[3]).toBe(DB_USER_ID);
    expect((insert[1] as unknown[])[3]).not.toBe(RAW_SUBJECT);
  });
});
