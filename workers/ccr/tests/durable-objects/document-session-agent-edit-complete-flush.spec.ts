/**
 * Completing an agent edit session writes the edit to Postgres before it
 * answers, so nothing that reads Postgres afterwards — the post-edit
 * checkpoint's manifest, or the caller's next read — can observe the content
 * the session started from.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import 'yjs';
import { readJson } from '../helpers/http';

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
}));

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
  BranchNotFoundError: class BranchNotFoundError extends Error {},
  CheckpointNotFoundError: class CheckpointNotFoundError extends Error {},
}));

const SESSION_ID = [
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'cccccccc-0000-4000-8000-000000000001',
].join(':');

interface MockState {
  id: { toString: () => string; name: string };
  storage: {
    get: Mock;
    put: Mock;
    delete: Mock;
    list: Mock;
    getAlarm: Mock;
    setAlarm: Mock;
  };
  blockConcurrencyWhile: Mock;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
}

function createMockState(): MockState {
  const data = new Map<string, unknown>();
  return {
    id: { toString: () => SESSION_ID, name: SESSION_ID },
    storage: {
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(data.get(key))),
      put: vi.fn().mockImplementation((key: string, value: unknown) => {
        data.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn().mockImplementation((key: string) => Promise.resolve(data.delete(key))),
      list: vi.fn().mockResolvedValue(new Map()),
      getAlarm: vi.fn().mockResolvedValue(null),
      setAlarm: vi.fn().mockResolvedValue(undefined),
    },
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
  };
}

function createEnv(): Record<string, unknown> {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    // The agent's actor id is an OAuth subject rather than a uuid, so the flush
    // takes the internal-API path while checkpoints go direct (PCC-3457).
    HYPERDRIVE: { connectionString: 'postgresql://host/db' },
  };
}

/** Bodies posted to the CRDT sync endpoint, in order. */
interface SyncCall {
  snapshot: Record<string, unknown>;
  actorId: string;
  actorType: string;
}

describe('Agent edit completion', () => {
  let mockState: MockState;
  let syncCalls: SyncCall[];
  let callOrder: string[];
  let syncStatus: number;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockState = createMockState();
    syncCalls = [];
    callOrder = [];
    syncStatus = 200;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: string | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/internal/crdt-sync')) {
          callOrder.push('sync');
          const body = typeof init?.body === 'string'
            ? init.body
            : await (input as Request).text();
          syncCalls.push(JSON.parse(body) as SyncCall);
          if (syncStatus !== 200) {
            return new Response('sync unavailable', { status: syncStatus });
          }
          return new Response(
            JSON.stringify({ version: { id: 'version-after-edit' } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ found: false }), { status: 404 });
      }),
    );

    const db = await import('../../src/db');
    (db.runWithConnection as Mock).mockImplementation(
      async (_conn: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
    );

    const checkpointService = await import('../../src/services/checkpoint-service');
    (checkpointService.createCheckpoint as Mock).mockImplementation(() => {
      callOrder.push('checkpoint');
      return Promise.resolve({ checkpoint: { id: 'cp-1' }, documentCount: 1 });
    });
  });

  async function startSessionWithEdit(): Promise<{
    session: { fetch: (request: Request) => Promise<Response> };
    editSessionId: string;
  }> {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState, createEnv()) as unknown as {
      fetch: (request: Request) => Promise<Response>;
    };

    await session.fetch(new Request('http://localhost/snapshot'));

    const startResponse = await session.fetch(
      new Request('http://localhost/agent-edit-start', {
        method: 'POST',
        headers: {
          'X-Verified-Actor-Id': 'agent-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: 'agent-1',
          trigger: 'autonomous',
          intent: 'translate the page',
          targetRegions: ['$.content'],
        }),
      }),
    );
    const started = await readJson<{ editSessionId: string }>(startResponse);

    const applyResponse = await session.fetch(
      new Request('http://localhost/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verified-Actor-Id': 'agent-1',
          'X-Verified-Actor-Type': 'agent',
        },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'title', value: 'Bonjour' }],
          actorId: 'agent-1',
          editSessionId: started.editSessionId,
        }),
      }),
    );

    expect(applyResponse.status).toBe(200);

    return { session, editSessionId: started.editSessionId };
  }

  function complete(
    session: { fetch: (request: Request) => Promise<Response> },
    editSessionId: string,
  ): Promise<Response> {
    return session.fetch(
      new Request('http://localhost/agent-edit-complete', {
        method: 'POST',
        headers: {
          'X-Verified-Actor-Id': 'agent-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ editSessionId }),
      }),
    );
  }

  it('writes the edit to Postgres before answering', async () => {
    const { session, editSessionId } = await startSessionWithEdit();
    syncCalls = [];

    const response = await complete(session, editSessionId);

    expect(response.status).toBe(200);
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0]?.snapshot).toMatchObject({ title: 'Bonjour' });
  });

  it('names the version the edit is readable from', async () => {
    const { session, editSessionId } = await startSessionWithEdit();

    const response = await complete(session, editSessionId);
    const body = await readJson<{ versionId?: string }>(response);

    expect(body.versionId).toBe('version-after-edit');
  });

  it('attributes the version to the editing agent', async () => {
    const { session, editSessionId } = await startSessionWithEdit();
    syncCalls = [];

    await complete(session, editSessionId);

    expect(syncCalls[0]?.actorId).toBe('agent-1');
    expect(syncCalls[0]?.actorType).toBe('agent');
  });

  it('attributes the version to the person when a person owns the session', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState, createEnv()) as unknown as {
      fetch: (request: Request) => Promise<Response>;
    };
    await session.fetch(new Request('http://localhost/snapshot'));

    const startResponse = await session.fetch(
      new Request('http://localhost/agent-edit-start', {
        method: 'POST',
        headers: {
          'X-Verified-Actor-Id': 'person-1',
          'X-Verified-Actor-Type': 'user',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: 'person-1',
          trigger: 'human_requested',
          intent: 'edit the page',
          targetRegions: ['$.content'],
        }),
      }),
    );
    const started = await readJson<{ editSessionId: string }>(startResponse);
    syncCalls = [];

    await session.fetch(
      new Request('http://localhost/agent-edit-complete', {
        method: 'POST',
        headers: {
          'X-Verified-Actor-Id': 'person-1',
          'X-Verified-Actor-Type': 'user',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ editSessionId: started.editSessionId }),
      }),
    );

    expect(syncCalls[0]?.actorType).toBe('user');
    expect(syncCalls[0]?.actorId).toBe('person-1');
  });

  it('writes the edit before taking the post-edit checkpoint', async () => {
    const { session, editSessionId } = await startSessionWithEdit();
    callOrder = [];

    await complete(session, editSessionId);

    expect(callOrder).toEqual(['sync', 'checkpoint']);
  });

  it('reports failure rather than success when the edit cannot be written', async () => {
    const { session, editSessionId } = await startSessionWithEdit();
    syncStatus = 503;

    const response = await complete(session, editSessionId);

    expect(response.status).toBe(503);
    const body = await readJson<{ success?: boolean }>(response);
    expect(body.success).not.toBe(true);
  });

  it('leaves the session open so a failed completion can be retried', async () => {
    const { session, editSessionId } = await startSessionWithEdit();
    syncStatus = 503;
    await complete(session, editSessionId);

    syncStatus = 200;
    const retry = await complete(session, editSessionId);

    expect(retry.status).toBe(200);
    const body = await readJson<{ versionId?: string }>(retry);
    expect(body.versionId).toBe('version-after-edit');
  });

  it('takes no checkpoint when the edit cannot be written', async () => {
    const { session, editSessionId } = await startSessionWithEdit();
    syncStatus = 503;
    callOrder = [];

    await complete(session, editSessionId);

    expect(callOrder).not.toContain('checkpoint');
  });
});
