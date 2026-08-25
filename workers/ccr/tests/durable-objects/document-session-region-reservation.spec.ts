/**
 * Region reservation between open edit sessions.
 *
 * An open session holds its target regions against every other actor, whoever
 * owns either session. The hold lasts until the session completes or aborts.
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

const SESSION_ID =
  'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001';

interface MockStorage {
  get: Mock;
  put: Mock;
  delete: Mock;
  list: Mock;
  getAlarm: Mock;
  setAlarm: Mock;
}

interface MockState {
  id: { toString: () => string; name: string };
  storage: MockStorage;
  blockConcurrencyWhile: Mock;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
}

function createMockState(): MockState {
  const storage: MockStorage = {
    get: vi.fn().mockResolvedValue(undefined),
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

interface FetchableSession {
  fetch: (r: Request) => Promise<Response>;
}

async function newSession(): Promise<FetchableSession> {
  const { DocumentSession } = await import('../../src/durable-objects/document-session');
  return new DocumentSession(createMockState(), {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
  });
}

interface Actor {
  id: string;
  type: 'user' | 'agent';
}

const PERSON: Actor = { id: 'auth0|person-1', type: 'user' };
const OTHER_PERSON: Actor = { id: 'auth0|person-2', type: 'user' };
const AGENT: Actor = { id: 'agent-1', type: 'agent' };
const OTHER_AGENT: Actor = { id: 'agent-2', type: 'agent' };

function headersFor(actor: Actor): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Verified-Actor-Id': actor.id,
    'X-Verified-Actor-Type': actor.type,
  };
}

function start(actor: Actor, targetRegions: string[]): Request {
  return new Request('http://localhost/agent-edit-start', {
    method: 'POST',
    headers: headersFor(actor),
    body: JSON.stringify({
      trigger: actor.type === 'user' ? 'human_requested' : 'autonomous',
      intent: `Work by ${actor.id}`,
      targetRegions,
    }),
  });
}

function canEdit(actor: Actor, targetRegions: string[]): Request {
  return new Request('http://localhost/can-agent-edit', {
    method: 'POST',
    headers: headersFor(actor),
    body: JSON.stringify({
      trigger: actor.type === 'user' ? 'human_requested' : 'autonomous',
      targetRegions,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('a region held by an open session', () => {
  it('refuses a second agent the region a first agent holds', async () => {
    const session = await newSession();
    await session.fetch(start(AGENT, ['/content/0']));

    const response = await session.fetch(start(OTHER_AGENT, ['/content/0']));

    expect(response.status).toBe(403);
    const body = await response.json<{ reason?: string; conflictingRegions?: string[] }>();
    expect(body.reason).toBe('region_conflict');
    expect(body.conflictingRegions).toEqual(['/content/0']);
  });

  it('refuses an agent the region a person holds', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0']));

    const response = await session.fetch(start(AGENT, ['/content/0']));

    expect(response.status).toBe(403);
    const body = await response.json<{ reason?: string }>();
    expect(body.reason).toBe('region_conflict');
  });

  it('refuses a person the region an agent holds', async () => {
    const session = await newSession();
    await session.fetch(start(AGENT, ['/content/0']));

    const response = await session.fetch(start(PERSON, ['/content/0']));

    expect(response.status).toBe(403);
    const body = await response.json<{ reason?: string }>();
    expect(body.reason).toBe('region_conflict');
  });

  it('refuses a person the region another person holds', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0']));

    const response = await session.fetch(start(OTHER_PERSON, ['/content/0']));

    expect(response.status).toBe(403);
    const body = await response.json<{ reason?: string }>();
    expect(body.reason).toBe('region_conflict');
  });

  it('refuses a region nested inside one another session holds', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0']));

    const response = await session.fetch(start(AGENT, ['/content/0/props/title']));

    expect(response.status).toBe(403);
    const body = await response.json<{ conflictingRegions?: string[] }>();
    expect(body.conflictingRegions).toEqual(['/content/0/props/title']);
  });

  it('refuses a region that encloses one another session holds', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0/props/title']));

    const response = await session.fetch(start(AGENT, ['/content/0']));

    expect(response.status).toBe(403);
  });

  it('reports only the overlapping regions of a mixed request', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0']));

    const response = await session.fetch(
      start(AGENT, ['/content/0', '/content/1', '/content/2']),
    );

    expect(response.status).toBe(403);
    const body = await response.json<{ conflictingRegions?: string[] }>();
    expect(body.conflictingRegions).toEqual(['/content/0']);
  });
});

describe('a region no session holds', () => {
  it('allows a second session on a separate region', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0']));

    const response = await session.fetch(start(AGENT, ['/content/5']));

    expect(response.status).toBe(200);
  });

  it('frees the region once the holding session completes', async () => {
    const session = await newSession();
    const first = await session.fetch(start(PERSON, ['/content/0']));
    const { editSessionId } = await first.json<{ editSessionId: string }>();

    await session.fetch(
      new Request('http://localhost/agent-edit-complete', {
        method: 'POST',
        headers: headersFor(PERSON),
        body: JSON.stringify({ editSessionId }),
      }),
    );

    const response = await session.fetch(start(AGENT, ['/content/0']));
    expect(response.status).toBe(200);
  });

  it('frees the region once the holding session aborts', async () => {
    const session = await newSession();
    const first = await session.fetch(start(AGENT, ['/content/0']));
    const { editSessionId } = await first.json<{ editSessionId: string }>();

    await session.fetch(
      new Request('http://localhost/agent-edit-abort', {
        method: 'POST',
        headers: headersFor(AGENT),
        body: JSON.stringify({ editSessionId, reason: 'done' }),
      }),
    );

    const response = await session.fetch(start(PERSON, ['/content/0']));
    expect(response.status).toBe(200);
  });
});

describe('the holder revisiting its own reservation', () => {
  it('reports the one-session limit rather than a conflict with itself', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0']));

    const response = await session.fetch(start(PERSON, ['/content/0']));

    expect(response.status).toBe(409);
  });

  it('does not report the holder\'s own regions as conflicting', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0']));

    const response = await session.fetch(canEdit(PERSON, ['/content/0']));

    const body = await response.json<{ allowed: boolean; conflictingRegions: string[] }>();
    expect(body.conflictingRegions).toEqual([]);
    expect(body.allowed).toBe(true);
  });
});

describe('checking permission before starting', () => {
  it('warns an agent that a person holds the region', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0']));

    const response = await session.fetch(canEdit(AGENT, ['/content/0']));

    expect(response.status).toBe(200);
    const body = await response.json<{
      allowed: boolean;
      reason?: string;
      conflictingRegions: string[];
    }>();
    expect(body.allowed).toBe(false);
    expect(body.reason).toBe('region_conflict');
    expect(body.conflictingRegions).toEqual(['/content/0']);
  });

  it('clears an agent for a region no session holds', async () => {
    const session = await newSession();
    await session.fetch(start(PERSON, ['/content/0']));

    const response = await session.fetch(canEdit(AGENT, ['/content/9']));

    const body = await response.json<{ allowed: boolean; conflictingRegions: string[] }>();
    expect(body.allowed).toBe(true);
    expect(body.conflictingRegions).toEqual([]);
  });
});
