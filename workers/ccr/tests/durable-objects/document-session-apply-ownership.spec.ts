/**
 * Routing edits through the session that reserved them.
 *
 * An actor holding an open session must apply its edits within that session, so
 * the reservation and the rollback checkpoint both cover the work. An actor
 * holding no session edits directly, which is how a person works in the editor.
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

function headersFor(actor: Actor): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Verified-Actor-Id': actor.id,
    'X-Verified-Actor-Type': actor.type,
  };
}

async function startSession(
  session: FetchableSession,
  actor: Actor,
  targetRegions: string[],
): Promise<string> {
  const response = await session.fetch(
    new Request('http://localhost/agent-edit-start', {
      method: 'POST',
      headers: headersFor(actor),
      body: JSON.stringify({
        trigger: actor.type === 'user' ? 'human_requested' : 'autonomous',
        intent: `Work by ${actor.id}`,
        targetRegions,
      }),
    }),
  );
  const body = await response.json<{ editSessionId: string }>();
  return body.editSessionId;
}

function apply(
  actor: Actor,
  path: string,
  editSessionId?: string,
): Request {
  const body: Record<string, unknown> = {
    operations: [{ type: 'set', path, value: 'updated' }],
    actorId: actor.id,
  };
  if (editSessionId !== undefined) {
    body.editSessionId = editSessionId;
  }
  return new Request('http://localhost/apply', {
    method: 'POST',
    headers: headersFor(actor),
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('an actor holding no session', () => {
  it('lets a person edit directly', async () => {
    const session = await newSession();

    const response = await session.fetch(apply(PERSON, 'content'));

    expect(response.status).toBe(200);
  });

  it('still requires an agent to name a session', async () => {
    const session = await newSession();

    const response = await session.fetch(apply(AGENT, 'content'));

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain('editSessionId');
  });
});

describe('an actor holding an open session', () => {
  it('refuses a person\'s edit that names no session', async () => {
    const session = await newSession();
    await startSession(session, PERSON, ['/content']);

    const response = await session.fetch(apply(PERSON, 'content'));

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain('editSessionId');
  });

  it('names the session the actor already holds when refusing', async () => {
    const session = await newSession();
    const editSessionId = await startSession(session, PERSON, ['/content']);

    const response = await session.fetch(apply(PERSON, 'content'));

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain(editSessionId);
  });

  it('accepts a person\'s edit within their own session', async () => {
    const session = await newSession();
    const editSessionId = await startSession(session, PERSON, ['/content']);

    const response = await session.fetch(apply(PERSON, 'content', editSessionId));

    expect(response.status).toBe(200);
  });

  it('accepts an agent\'s edit within its own session', async () => {
    const session = await newSession();
    const editSessionId = await startSession(session, AGENT, ['/content']);

    const response = await session.fetch(apply(AGENT, 'content', editSessionId));

    expect(response.status).toBe(200);
  });
});

describe('naming a session that belongs to someone else', () => {
  it('refuses a person the session another person owns', async () => {
    const session = await newSession();
    const otherId = await startSession(session, OTHER_PERSON, ['/content/1']);

    const response = await session.fetch(apply(PERSON, 'content', otherId));

    expect(response.status).toBe(403);
  });

  it('refuses an agent the session a person owns', async () => {
    const session = await newSession();
    const personSessionId = await startSession(session, PERSON, ['/content/1']);

    const response = await session.fetch(apply(AGENT, 'content', personSessionId));

    expect(response.status).toBe(403);
  });

  it('refuses a person the session an agent owns', async () => {
    const session = await newSession();
    const agentSessionId = await startSession(session, AGENT, ['/content/1']);

    const response = await session.fetch(apply(PERSON, 'content', agentSessionId));

    expect(response.status).toBe(403);
  });

  it('refuses an unknown session id', async () => {
    const session = await newSession();
    await startSession(session, PERSON, ['/content']);

    const response = await session.fetch(apply(PERSON, 'content', 'edit-does-not-exist'));

    expect(response.status).toBe(403);
  });
});
