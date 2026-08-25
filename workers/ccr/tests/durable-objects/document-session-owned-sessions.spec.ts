/**
 * Edit sessions owned by a signed-in person.
 *
 * A session's owner comes from the identity the Worker verified, never from the
 * request body. Ownership decides who may act on the session, whose presence it
 * publishes, and which agent-only safeguards pass it by.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

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

vi.mock('../../src/services/agent-service', () => ({
  getAgentById: vi.fn().mockImplementation((agentId: string) =>
    Promise.resolve({
      id: agentId,
      organizationId: 'test-org',
      name: `Test Agent ${agentId}`,
      status: 'active',
      capabilities: ['edit'],
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  ),
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

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
  BranchNotFoundError: class BranchNotFoundError extends Error {},
  CheckpointNotFoundError: class CheckpointNotFoundError extends Error {},
}));

const SESSION_ID =
  'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001';

const PERSON_ID = 'auth0|person-1';
const PERSON_DB_ID = 'dddddddd-0000-4000-8000-000000000001';
const AGENT_ID = 'agent-1';

interface MockStorage {
  get: Mock<(key: string) => Promise<unknown>>;
  put: Mock<(key: string, value: unknown) => Promise<void>>;
  delete: Mock<(key: string) => Promise<boolean>>;
  list: Mock<() => Promise<Map<string, unknown>>>;
  getAlarm: Mock<() => Promise<number | null>>;
  setAlarm: Mock<(t: number) => Promise<void>>;
}

/** DO state whose storage starts empty unless a test seeds a key. */
function createMockState(seed: Record<string, unknown> = {}): {
  id: { toString: () => string; name: string };
  storage: MockStorage;
  blockConcurrencyWhile: Mock;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
} {
  const storage: MockStorage = {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(seed[key])),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };
  return {
    id: { toString: () => SESSION_ID, name: SESSION_ID },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
  };
}

function createMockEnv(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { API_URL: 'http://localhost:8787', ENVIRONMENT: 'test', ...extra };
}

interface StartOptions {
  actorId: string;
  actorType: 'user' | 'agent';
  trigger?: 'human_requested' | 'autonomous';
  intent?: string;
  targetRegions?: string[];
  dbUserId?: string;
  verifiedName?: string;
}

function startRequest(options: StartOptions): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Verified-Actor-Id': options.actorId,
    'X-Verified-Actor-Type': options.actorType,
  };
  if (options.dbUserId !== undefined) {
    headers['X-Verified-Db-User-Id'] = options.dbUserId;
  }
  if (options.verifiedName !== undefined) {
    headers['X-Verified-Name'] = options.verifiedName;
  }
  return new Request('http://localhost/agent-edit-start', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      trigger: options.trigger ?? 'human_requested',
      intent: options.intent ?? 'Rewrite the hero copy',
      targetRegions: options.targetRegions ?? ['/content/0'],
    }),
  });
}

interface SessionSummary {
  id: string;
  ownerId: string;
  ownerType: 'user' | 'agent';
  intent: string;
  targetRegions: string[];
}

async function listSessions(session: FetchableSession): Promise<SessionSummary[]> {
  const response = await session.fetch(new Request('http://localhost/edit-sessions'));
  const body = await response.json<{ sessions: SessionSummary[] }>();
  return body.sessions;
}

interface FetchableSession {
  fetch: (r: Request) => Promise<Response>;
}

async function newSession(
  env: Record<string, unknown> = createMockEnv(),
  seed: Record<string, unknown> = {},
): Promise<FetchableSession> {
  const { DocumentSession } = await import('../../src/durable-objects/document-session');
  return new DocumentSession(createMockState(seed), env);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('deriving the session owner', () => {
  it('records a person as the owner when the verified actor is a user', async () => {
    const session = await newSession();

    const response = await session.fetch(
      startRequest({ actorId: PERSON_ID, actorType: 'user' }),
    );

    expect(response.status).toBe(200);
    const sessions = await listSessions(session);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.ownerType).toBe('user');
    expect(sessions[0]?.ownerId).toBe(PERSON_ID);
  });

  it('records an agent as the owner when the verified actor is an agent', async () => {
    const session = await newSession();

    const response = await session.fetch(
      startRequest({ actorId: AGENT_ID, actorType: 'agent', trigger: 'autonomous' }),
    );

    expect(response.status).toBe(200);
    const sessions = await listSessions(session);
    expect(sessions[0]?.ownerType).toBe('agent');
    expect(sessions[0]?.ownerId).toBe(AGENT_ID);
  });

  it('ignores an owner type claimed in the request body', async () => {
    const session = await newSession();

    const response = await session.fetch(
      new Request('http://localhost/agent-edit-start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verified-Actor-Id': AGENT_ID,
          'X-Verified-Actor-Type': 'agent',
        },
        body: JSON.stringify({
          trigger: 'autonomous',
          intent: 'Optimise headings',
          targetRegions: ['/content/0'],
          ownerType: 'user',
          ownerId: PERSON_ID,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const sessions = await listSessions(session);
    expect(sessions[0]?.ownerType).toBe('agent');
    expect(sessions[0]?.ownerId).toBe(AGENT_ID);
  });

  it('treats an absent verified actor type as an agent', async () => {
    const session = await newSession();

    const response = await session.fetch(
      new Request('http://localhost/agent-edit-start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verified-Actor-Id': AGENT_ID,
        },
        body: JSON.stringify({
          trigger: 'autonomous',
          intent: 'Optimise headings',
          targetRegions: ['/content/0'],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const sessions = await listSessions(session);
    expect(sessions[0]?.ownerType).toBe('agent');
  });
});

describe('checkpoints for a person-owned session', () => {
  it('creates a recoverable checkpoint even though the trigger is not autonomous', async () => {
    const session = await newSession();

    const response = await session.fetch(
      startRequest({ actorId: PERSON_ID, actorType: 'user', trigger: 'human_requested' }),
    );

    const body = await response.json<{ checkpointId?: string }>();
    expect(body.checkpointId).toBeDefined();
  });

  it('attributes the checkpoint to the person\'s database identity', async () => {
    const { createCheckpoint } = await import('../../src/services/checkpoint-service');
    const { runWithConnection } = await import('../../src/db');
    vi.mocked(runWithConnection).mockImplementation(
      async (_c: unknown, _o: unknown, cb: () => Promise<unknown>) => cb(),
    );
    vi.mocked(createCheckpoint).mockResolvedValue({
      checkpoint: { id: 'checkpoint-1' },
      documentCount: 1,
    } as unknown as Awaited<ReturnType<typeof createCheckpoint>>);

    const session = await newSession(
      createMockEnv({ HYPERDRIVE: { connectionString: 'postgres://test' } }),
    );

    await session.fetch(
      startRequest({
        actorId: PERSON_ID,
        actorType: 'user',
        dbUserId: PERSON_DB_ID,
      }),
    );

    const args = vi.mocked(createCheckpoint).mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(args.createdByType).toBe('user');
    expect(args.createdById).toBe(PERSON_DB_ID);
  });

  it('leaves an agent-owned human-requested session without a checkpoint', async () => {
    const session = await newSession();

    const response = await session.fetch(
      startRequest({ actorId: AGENT_ID, actorType: 'agent', trigger: 'human_requested' }),
    );

    const body = await response.json<{ checkpointId?: string }>();
    expect(body.checkpointId).toBeUndefined();
  });
});

describe('presence for a person-owned session', () => {
  it('publishes the person as a human editor with their intent', async () => {
    const session = await newSession();

    await session.fetch(
      startRequest({
        actorId: PERSON_ID,
        actorType: 'user',
        intent: 'Rewrite the hero copy',
        targetRegions: ['/content/0'],
        verifiedName: 'Ada Lovelace',
      }),
    );

    const response = await session.fetch(new Request('http://localhost/presences'));
    const body = await response.json<{
      presences: {
        actorId: string;
        actorType: string;
        role: string;
        name: string;
        state: string;
        intent?: string;
        focusRegions?: string[];
      }[];
    }>();

    const presence = body.presences.find((p) => p.actorId === PERSON_ID);
    expect(presence).toBeDefined();
    expect(presence?.actorType).toBe('user');
    expect(presence?.role).toBe('human');
    expect(presence?.name).toBe('Ada Lovelace');
    expect(presence?.state).toBe('editing');
    expect(presence?.intent).toBe('Rewrite the hero copy');
    expect(presence?.focusRegions).toEqual(['/content/0']);
  });

  it('clears the person\'s presence when the session completes', async () => {
    const session = await newSession();

    const startResponse = await session.fetch(
      startRequest({ actorId: PERSON_ID, actorType: 'user' }),
    );
    const { editSessionId } = await startResponse.json<{ editSessionId: string }>();

    await session.fetch(
      new Request('http://localhost/agent-edit-complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verified-Actor-Id': PERSON_ID,
          'X-Verified-Actor-Type': 'user',
        },
        body: JSON.stringify({ editSessionId }),
      }),
    );

    const response = await session.fetch(new Request('http://localhost/presences'));
    const body = await response.json<{ presences: { actorId: string }[] }>();
    expect(body.presences.find((p) => p.actorId === PERSON_ID)).toBeUndefined();
  });

  it('ignores a requester the caller names for itself', async () => {
    const session = await newSession();

    await session.fetch(
      new Request('http://localhost/agent-edit-start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verified-Actor-Id': PERSON_ID,
          'X-Verified-Actor-Type': 'user',
          // Only the Worker sets X-Verified-Requested-By-*, and it does so from
          // the credential; a value the caller supplies is not a substitute.
          'X-Acting-User-Id': 'auth0|someone-else',
          'X-Acting-User-Name': 'Someone Else',
        },
        body: JSON.stringify({
          trigger: 'human_requested',
          intent: 'Rewrite the hero copy',
          targetRegions: ['/content/0'],
        }),
      }),
    );

    const response = await session.fetch(new Request('http://localhost/presences'));
    const body = await response.json<{
      presences: { actorId: string; requestedById?: string; requestedByName?: string }[];
    }>();

    const presence = body.presences.find((p) => p.actorId === PERSON_ID);
    expect(presence).toBeDefined();
    expect(presence?.requestedById).toBeUndefined();
    expect(presence?.requestedByName).toBeUndefined();
  });

  it('still publishes the requester an agent acts for', async () => {
    const session = await newSession();

    await session.fetch(
      new Request('http://localhost/agent-edit-start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verified-Actor-Id': AGENT_ID,
          'X-Verified-Actor-Type': 'agent',
          'X-Verified-Requested-By-Id': 'auth0|person-1',
          'X-Verified-Requested-By-Name': 'Ada Lovelace',
        },
        body: JSON.stringify({
          trigger: 'human_requested',
          intent: 'Rewrite the hero copy',
          targetRegions: ['/content/0'],
        }),
      }),
    );

    const response = await session.fetch(new Request('http://localhost/presences'));
    const body = await response.json<{
      presences: { actorId: string; requestedById?: string; requestedByName?: string }[];
    }>();

    const presence = body.presences.find((p) => p.actorId === AGENT_ID);
    expect(presence?.requestedById).toBe('auth0|person-1');
    expect(presence?.requestedByName).toBe('Ada Lovelace');
  });
});

describe('acting on someone else\'s session', () => {
  it('refuses to complete a person\'s session as a different actor', async () => {
    const session = await newSession();

    const startResponse = await session.fetch(
      startRequest({ actorId: PERSON_ID, actorType: 'user' }),
    );
    const { editSessionId } = await startResponse.json<{ editSessionId: string }>();

    const response = await session.fetch(
      new Request('http://localhost/agent-edit-complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verified-Actor-Id': 'auth0|person-2',
          'X-Verified-Actor-Type': 'user',
        },
        body: JSON.stringify({ editSessionId }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it('refuses an agent sharing an identifier with the person who owns the session', async () => {
    const session = await newSession();

    const startResponse = await session.fetch(
      startRequest({ actorId: PERSON_ID, actorType: 'user' }),
    );
    const { editSessionId } = await startResponse.json<{ editSessionId: string }>();

    const response = await session.fetch(
      new Request('http://localhost/agent-edit-abort', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verified-Actor-Id': PERSON_ID,
          'X-Verified-Actor-Type': 'agent',
        },
        body: JSON.stringify({ editSessionId }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it('lets the owning person abort their own session', async () => {
    const session = await newSession();

    const startResponse = await session.fetch(
      startRequest({ actorId: PERSON_ID, actorType: 'user' }),
    );
    const { editSessionId } = await startResponse.json<{ editSessionId: string }>();

    const response = await session.fetch(
      new Request('http://localhost/agent-edit-abort', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verified-Actor-Id': PERSON_ID,
          'X-Verified-Actor-Type': 'user',
        },
        body: JSON.stringify({ editSessionId, reason: 'Changed my mind' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await listSessions(session)).toHaveLength(0);
  });

  it('refuses to complete a session for a caller carrying no verified identity', async () => {
    const session = await newSession();

    const startResponse = await session.fetch(
      startRequest({ actorId: PERSON_ID, actorType: 'user' }),
    );
    const { editSessionId } = await startResponse.json<{ editSessionId: string }>();

    const response = await session.fetch(
      new Request('http://localhost/agent-edit-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editSessionId }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await listSessions(session)).toHaveLength(1);
  });

  it('refuses to abort a session for a caller carrying no verified identity', async () => {
    const session = await newSession();

    const startResponse = await session.fetch(
      startRequest({ actorId: PERSON_ID, actorType: 'user' }),
    );
    const { editSessionId } = await startResponse.json<{ editSessionId: string }>();

    const response = await session.fetch(
      new Request('http://localhost/agent-edit-abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editSessionId }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await listSessions(session)).toHaveLength(1);
  });
});

describe('agent-only safeguards', () => {
  async function withPersonSession(): Promise<FetchableSession> {
    const session = await newSession();
    await session.fetch(startRequest({ actorId: PERSON_ID, actorType: 'user' }));
    return session;
  }

  it('leaves a person\'s session alone when stopping an agent by identifier', async () => {
    const session = await withPersonSession();

    const response = await session.fetch(
      new Request('http://localhost/agent-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: PERSON_ID }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json<{ rolledBack: boolean }>();
    expect(body.rolledBack).toBe(false);
    expect(await listSessions(session)).toHaveLength(1);
  });

  it('does not kick a person\'s session', async () => {
    const session = await withPersonSession();

    const response = await session.fetch(
      new Request('http://localhost/kick-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: PERSON_ID, reason: 'cleanup' }),
      }),
    );

    expect(response.status).toBe(404);
    expect(await listSessions(session)).toHaveLength(1);
  });

  it('spares a person\'s session when kicking every agent', async () => {
    const session = await newSession();
    await session.fetch(startRequest({ actorId: PERSON_ID, actorType: 'user' }));
    await session.fetch(
      startRequest({
        actorId: AGENT_ID,
        actorType: 'agent',
        trigger: 'autonomous',
        targetRegions: ['/content/5'],
      }),
    );

    const response = await session.fetch(
      new Request('http://localhost/kick-all-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'maintenance' }),
      }),
    );

    const body = await response.json<{ kickedCount: number; kickedAgents: string[] }>();
    expect(body.kickedCount).toBe(1);
    expect(body.kickedAgents).toEqual([AGENT_ID]);

    const remaining = await listSessions(session);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.ownerId).toBe(PERSON_ID);
  });

  it('omits person-owned sessions from the active agent list', async () => {
    const session = await newSession();
    await session.fetch(startRequest({ actorId: PERSON_ID, actorType: 'user' }));
    await session.fetch(
      startRequest({
        actorId: AGENT_ID,
        actorType: 'agent',
        trigger: 'autonomous',
        targetRegions: ['/content/5'],
      }),
    );

    const response = await session.fetch(new Request('http://localhost/active-agents'));
    const body = await response.json<{ agents: { agentId: string }[] }>();

    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]?.agentId).toBe(AGENT_ID);
  });
});

describe('restoring sessions persisted before ownership was recorded', () => {
  it('reads a stored session that names only an agent as agent-owned', async () => {
    const stored = {
      'edit-legacy': {
        id: 'edit-legacy',
        agentId: AGENT_ID,
        trigger: 'autonomous',
        intent: 'Optimise headings',
        targetRegions: ['/content/0'],
        startedAt: Date.now(),
      },
    };

    const session = await newSession(createMockEnv(), {
      editSessions: JSON.stringify(stored),
    });

    const sessions = await listSessions(session);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.ownerType).toBe('agent');
    expect(sessions[0]?.ownerId).toBe(AGENT_ID);
  });
});
