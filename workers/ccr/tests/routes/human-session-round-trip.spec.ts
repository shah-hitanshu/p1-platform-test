/**
 * The authoring round-trip a signed-in person makes, end to end.
 *
 * Requests enter through the realtime route and reach a real DocumentSession,
 * so route authorisation, verified-identity forwarding and the session's own
 * behaviour are all exercised together rather than in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../src/services/site-service', () => ({
  getCachedSiteAllowedOrigins: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/document-service', () => ({
  getDocumentByPath: vi.fn(),
}));

vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
}));

vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/services/agent-service', () => ({
  getAgentById: vi.fn().mockImplementation((agentId: string) =>
    Promise.resolve({
      id: agentId,
      organizationId: 'org-1',
      name: 'Helpful Agent',
      status: 'active',
      capabilities: ['content_edit'],
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

import * as documentService from '../../src/services/document-service';
import * as branchService from '../../src/services/branch-service';
import { handleRealtimeRoutes, type RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { RealtimeEnv } from '../../src/routes/realtime-utils';
import type { AuthenticatedPrincipal, Branch } from '../../src/types';

const SITE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const BRANCH_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const DOCUMENT_ID = 'cccccccc-0000-4000-8000-000000000001';
const DOCUMENT_PATH = 'home';

const PERSON: AuthenticatedPrincipal = {
  id: 'dddddddd-0000-4000-8000-000000000001',
  type: 'user',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  pantheonSiteRoles: { [SITE_ID]: 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'auth0',
  providerSubjectId: 'auth0|ada',
  dbUserId: 'eeeeeeee-0000-4000-8000-000000000001',
};

const AGENT: AuthenticatedPrincipal = {
  id: 'ffffffff-0000-4000-8000-000000000001',
  type: 'agent',
  pantheonSiteRoles: { [SITE_ID]: 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'agent_key',
};

const asPerson: RealtimeRouteContext = { principal: PERSON };
const asAgent: RealtimeRouteContext = { principal: AGENT };

function branchFixture(): Branch {
  return {
    id: BRANCH_ID,
    siteId: SITE_ID,
    name: 'main',
    status: 'active',
    isMain: true,
    createdById: 'test-user',
    createdByType: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  };
}

/** The single live DocumentSession every request in a test routes to. */
let documentSession: { fetch: (r: Request) => Promise<Response> };
let env: RealtimeEnv;

async function createLiveSession(): Promise<{ fetch: (r: Request) => Promise<Response> }> {
  const { DocumentSession } = await import('../../src/durable-objects/document-session');
  const name = `${SITE_ID}:${DOCUMENT_ID}:${BRANCH_ID}`;
  const storage = {
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };
  return new DocumentSession(
    {
      id: { toString: () => name, name },
      storage,
      blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn().mockReturnValue([]),
    },
    { API_URL: 'http://localhost:8787', ENVIRONMENT: 'test' },
  );
}

function url(action: string): string {
  return `https://example.com/api/sites/${SITE_ID}/branches/${BRANCH_ID}/documents/${DOCUMENT_PATH}/${action}`;
}

async function call(
  action: string,
  context: RealtimeRouteContext,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handleRealtimeRoutes(
    new Request(url(action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    context,
  );
  if (response === null) {
    throw new Error(`Route did not handle ${action}`);
  }
  return { status: response.status, body: await response.json<Record<string, unknown>>() };
}

/** Read DO-internal state the public routes do not expose. */
async function internal(path: string): Promise<Record<string, unknown>> {
  const response = await documentSession.fetch(new Request(`http://internal${path}`));
  return response.json<Record<string, unknown>>();
}

beforeEach(async () => {
  vi.clearAllMocks();
  documentSession = await createLiveSession();
  env = {
    ENVIRONMENT: 'test',
    DOCUMENT_STATE: {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id' }),
      get: vi.fn().mockImplementation(() => documentSession),
    },
    CORS_ORIGINS: 'http://localhost:3000',
  } as unknown as RealtimeEnv;

  vi.mocked(branchService.getBranch).mockResolvedValue(branchFixture());
  vi.mocked(branchService.getBranchByName).mockResolvedValue(branchFixture());
  vi.mocked(documentService.getDocumentByPath).mockResolvedValue({
    id: DOCUMENT_ID,
    siteId: SITE_ID,
    path: DOCUMENT_PATH,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Awaited<ReturnType<typeof documentService.getDocumentByPath>>);
});

describe('a person completing the authoring round-trip', () => {
  it('checks permission, opens a session, edits, and completes', async () => {
    const permission = await call('can-agent-edit', asPerson, {
      trigger: 'human_requested',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content'],
    });
    expect(permission.status).toBe(200);
    expect(permission.body.allowed).toBe(true);

    const started = await call('agent-edit-start', asPerson, {
      trigger: 'human_requested',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content'],
    });
    expect(started.status).toBe(200);
    const editSessionId = started.body.editSessionId as string;
    expect(editSessionId).toBeDefined();
    expect(started.body.checkpointId).toBeDefined();

    const edited = await call('edits', asPerson, {
      operations: [{ type: 'set', path: 'content', value: 'Rewritten' }],
      editSessionId,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.success).toBe(true);

    const completed = await call('agent-edit-complete', asPerson, { editSessionId });
    expect(completed.status).toBe(200);
    expect(completed.body.success).toBe(true);

    const sessions = (await internal('/edit-sessions')).sessions as unknown[];
    expect(sessions).toHaveLength(0);
  });

  it('is attributed to the person while the session is open', async () => {
    await call('agent-edit-start', asPerson, {
      trigger: 'human_requested',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content'],
    });

    const sessions = (await internal('/edit-sessions')).sessions as {
      ownerId: string;
      ownerType: string;
      intent: string;
    }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.ownerId).toBe(PERSON.id);
    expect(sessions[0]?.ownerType).toBe('user');
    expect(sessions[0]?.intent).toBe('Rewrite the hero copy');

    const presences = (await internal('/presences')).presences as {
      actorId: string;
      role: string;
      name: string;
      state: string;
      focusRegions?: string[];
    }[];
    const mine = presences.find((p) => p.actorId === PERSON.id);
    expect(mine?.role).toBe('human');
    expect(mine?.name).toBe('Ada Lovelace');
    expect(mine?.state).toBe('editing');
    expect(mine?.focusRegions).toEqual(['/content']);
  });

  it('releases the person\'s presence once the session is aborted', async () => {
    const started = await call('agent-edit-start', asPerson, {
      trigger: 'human_requested',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content'],
    });
    const editSessionId = started.body.editSessionId as string;

    const aborted = await call('agent-edit-abort', asPerson, {
      editSessionId,
      reason: 'Changed my mind',
    });
    expect(aborted.status).toBe(200);
    expect(aborted.body.success).toBe(true);

    const presences = (await internal('/presences')).presences as { actorId: string }[];
    expect(presences.find((p) => p.actorId === PERSON.id)).toBeUndefined();
    expect((await internal('/edit-sessions')).sessions).toHaveLength(0);
  });
});

describe('a person and an agent working the same document', () => {
  it('refuses the agent a region the person reserved', async () => {
    await call('agent-edit-start', asPerson, {
      trigger: 'human_requested',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content'],
    });

    const denied = await call('agent-edit-start', asAgent, {
      trigger: 'autonomous',
      intent: 'Tidy the copy',
      targetRegions: ['/content'],
    });

    expect(denied.status).toBe(403);
    expect(denied.body.reason).toBe('region_conflict');
  });

  it('surfaces a conflict to both when the agent edits into the person\'s region', async () => {
    const personStart = await call('agent-edit-start', asPerson, {
      trigger: 'human_requested',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content'],
    });
    const personSessionId = personStart.body.editSessionId as string;

    const agentStart = await call('agent-edit-start', asAgent, {
      trigger: 'autonomous',
      intent: 'Adjust page settings',
      targetRegions: ['/root'],
    });
    const agentSessionId = agentStart.body.editSessionId as string;

    const agentEdit = await call('edits', asAgent, {
      operations: [{ type: 'set', path: 'content', value: 'Agent text' }],
      editSessionId: agentSessionId,
    });

    expect(agentEdit.status).toBe(200);
    const conflicts = agentEdit.body.sessionConflicts as {
      ownerId: string;
      ownerType: string;
      sessionId: string;
    }[];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.ownerId).toBe(PERSON.id);
    expect(conflicts[0]?.ownerType).toBe('user');
    expect(conflicts[0]?.sessionId).toBe(personSessionId);

    const sessions = (await internal('/edit-sessions')).sessions as {
      id: string;
      conflicted?: boolean;
    }[];
    const personSession = sessions.find((s) => s.id === personSessionId);
    expect(personSession?.conflicted).toBe(true);
  });

  it('leaves the agent free to reserve a separate region', async () => {
    await call('agent-edit-start', asPerson, {
      trigger: 'human_requested',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content'],
    });

    const allowed = await call('agent-edit-start', asAgent, {
      trigger: 'autonomous',
      intent: 'Adjust page settings',
      targetRegions: ['/root'],
    });

    expect(allowed.status).toBe(200);
    expect((await internal('/edit-sessions')).sessions).toHaveLength(2);
  });
});

describe('agent-only controls', () => {
  it('does not stop a person\'s session', async () => {
    const started = await call('agent-edit-start', asPerson, {
      trigger: 'human_requested',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content'],
    });
    const editSessionId = started.body.editSessionId as string;

    const stopped = await call('agent-stop', asPerson, { agentId: PERSON.id });
    expect(stopped.status).toBe(200);
    expect(stopped.body.rolledBack).toBe(false);

    const sessions = (await internal('/edit-sessions')).sessions as { id: string }[];
    expect(sessions.map((s) => s.id)).toEqual([editSessionId]);
  });
});
