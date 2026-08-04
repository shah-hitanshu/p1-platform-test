/**
 * Conflict between an open session and another actor's edits.
 *
 * Edits that land in a region another session reserved put that session in
 * conflict, whichever kind of actor made them. Both sides learn of it: the
 * editor in the apply response, the session's owner on the session record.
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

interface SessionConflict {
  ownerId: string;
  ownerType: 'user' | 'agent';
  regions: string[];
  sessionId: string;
}

async function applyEdit(
  session: FetchableSession,
  actor: Actor,
  path: string,
  editSessionId?: string,
): Promise<{ status: number; sessionConflicts?: SessionConflict[] }> {
  const body: Record<string, unknown> = {
    operations: [{ type: 'set', path, value: 'updated' }],
    actorId: actor.id,
  };
  if (editSessionId !== undefined) {
    body.editSessionId = editSessionId;
  }
  const response = await session.fetch(
    new Request('http://localhost/apply', {
      method: 'POST',
      headers: headersFor(actor),
      body: JSON.stringify(body),
    }),
  );
  const parsed = await response.json<{ sessionConflicts?: SessionConflict[] }>();
  return { status: response.status, sessionConflicts: parsed.sessionConflicts };
}

interface SessionRecord {
  id: string;
  ownerId: string;
  conflicted?: boolean;
  conflictReason?: string;
}

async function sessionRecord(
  session: FetchableSession,
  sessionId: string,
): Promise<SessionRecord | undefined> {
  const response = await session.fetch(new Request('http://localhost/edit-sessions'));
  const body = await response.json<{ sessions: SessionRecord[] }>();
  return body.sessions.find((s) => s.id === sessionId);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('a person editing over an agent\'s reservation', () => {
  it('reports the agent\'s session back to the person', async () => {
    const session = await newSession();
    const agentSessionId = await startSession(session, AGENT, ['/content']);

    const result = await applyEdit(session, PERSON, 'content');

    expect(result.status).toBe(200);
    expect(result.sessionConflicts).toHaveLength(1);
    expect(result.sessionConflicts?.[0]?.ownerId).toBe(AGENT.id);
    expect(result.sessionConflicts?.[0]?.ownerType).toBe('agent');
    expect(result.sessionConflicts?.[0]?.sessionId).toBe(agentSessionId);
  });

  it('marks the agent\'s session conflicted', async () => {
    const session = await newSession();
    const agentSessionId = await startSession(session, AGENT, ['/content']);

    await applyEdit(session, PERSON, 'content');

    const record = await sessionRecord(session, agentSessionId);
    expect(record?.conflicted).toBe(true);
    expect(record?.conflictReason).toBeDefined();
  });
});

describe('an agent editing over a person\'s reservation', () => {
  it('reports the person\'s session back to the agent', async () => {
    const session = await newSession();
    const personSessionId = await startSession(session, PERSON, ['/content']);
    const agentSessionId = await startSession(session, AGENT, ['/root']);

    const result = await applyEdit(session, AGENT, 'content', agentSessionId);

    expect(result.status).toBe(200);
    expect(result.sessionConflicts).toHaveLength(1);
    expect(result.sessionConflicts?.[0]?.ownerId).toBe(PERSON.id);
    expect(result.sessionConflicts?.[0]?.ownerType).toBe('user');
    expect(result.sessionConflicts?.[0]?.sessionId).toBe(personSessionId);
  });

  it('marks the person\'s session conflicted', async () => {
    const session = await newSession();
    const personSessionId = await startSession(session, PERSON, ['/content']);
    const agentSessionId = await startSession(session, AGENT, ['/root']);

    await applyEdit(session, AGENT, 'content', agentSessionId);

    const record = await sessionRecord(session, personSessionId);
    expect(record?.conflicted).toBe(true);
  });
});

describe('a person editing over another person\'s reservation', () => {
  it('reports the other person\'s session', async () => {
    const session = await newSession();
    const heldSessionId = await startSession(session, OTHER_PERSON, ['/content']);

    const result = await applyEdit(session, PERSON, 'content');

    expect(result.sessionConflicts).toHaveLength(1);
    expect(result.sessionConflicts?.[0]?.ownerId).toBe(OTHER_PERSON.id);
    expect(result.sessionConflicts?.[0]?.ownerType).toBe('user');
    expect(result.sessionConflicts?.[0]?.sessionId).toBe(heldSessionId);
  });
});

describe('edits inside the actor\'s own reservation', () => {
  it('does not put a person\'s own session in conflict', async () => {
    const session = await newSession();
    const editSessionId = await startSession(session, PERSON, ['/content']);

    const result = await applyEdit(session, PERSON, 'content', editSessionId);

    expect(result.status).toBe(200);
    expect(result.sessionConflicts).toBeUndefined();
    const record = await sessionRecord(session, editSessionId);
    expect(record?.conflicted).toBeFalsy();
  });

  it('does not put an agent\'s own session in conflict', async () => {
    const session = await newSession();
    const editSessionId = await startSession(session, AGENT, ['/content']);

    const result = await applyEdit(session, AGENT, 'content', editSessionId);

    expect(result.status).toBe(200);
    expect(result.sessionConflicts).toBeUndefined();
    const record = await sessionRecord(session, editSessionId);
    expect(record?.conflicted).toBeFalsy();
  });
});

describe('edits clear of every reservation', () => {
  it('reports no conflict for a person', async () => {
    const session = await newSession();
    const agentSessionId = await startSession(session, AGENT, ['/content']);

    const result = await applyEdit(session, PERSON, 'root');

    expect(result.sessionConflicts).toBeUndefined();
    const record = await sessionRecord(session, agentSessionId);
    expect(record?.conflicted).toBeFalsy();
  });

  it('reports no conflict for an agent', async () => {
    const session = await newSession();
    const personSessionId = await startSession(session, PERSON, ['/content']);
    const agentSessionId = await startSession(session, AGENT, ['/root']);

    const result = await applyEdit(session, AGENT, 'root', agentSessionId);

    expect(result.sessionConflicts).toBeUndefined();
    const record = await sessionRecord(session, personSessionId);
    expect(record?.conflicted).toBeFalsy();
  });
});
