/**
 * Edit-session endpoints reached by a signed-in person.
 *
 * The session endpoints act for whichever principal the credential resolved to.
 * A person needs no agent registry entry, so nothing about the registry is
 * consulted on their behalf. A shared service credential is refused outright.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/agent-service', () => ({
  getAgentById: vi.fn(),
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

import * as documentService from '../../src/services/document-service';
import * as branchService from '../../src/services/branch-service';
import { getAgentById } from '../../src/services/agent-service';
import { handleRealtimeRoutes, type RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { RealtimeEnv } from '../../src/routes/realtime-utils';
import type { AuthenticatedPrincipal, Branch } from '../../src/types';

const SITE_ID = 'site-1';
const BRANCH_ID = 'branch-1';

function branchForRef(siteId: string, ref: string): Branch {
  return {
    id: ref,
    siteId,
    name: ref,
    status: 'active',
    isMain: false,
    createdById: 'test-user',
    createdByType: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  };
}

interface MockStub {
  fetch: ReturnType<typeof vi.fn>;
}

let mockStub: MockStub;

function createMockEnv(): RealtimeEnv {
  return {
    ENVIRONMENT: 'test',
    DOCUMENT_STATE: {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id' }),
      get: vi.fn().mockImplementation(() => mockStub),
    },
    CORS_ORIGINS: 'http://localhost:3000',
  } as unknown as RealtimeEnv;
}

let mockEnv: RealtimeEnv;

const personPrincipal: AuthenticatedPrincipal = {
  id: 'ffffffff-0000-4000-8000-000000000001',
  type: 'user',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  pantheonSiteRoles: { [SITE_ID]: 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'auth0',
  providerSubjectId: 'auth0|person-1',
  dbUserId: 'eeeeeeee-0000-4000-8000-000000000001',
};

const servicePrincipal: AuthenticatedPrincipal = {
  id: 'service-1',
  type: 'service',
  pantheonSiteRoles: { [SITE_ID]: 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  siteId: SITE_ID,
};

const personContext: RealtimeRouteContext = { principal: personPrincipal };
const serviceContext: RealtimeRouteContext = { principal: servicePrincipal };

const startBody = {
  trigger: 'human_requested',
  intent: 'Rewrite the hero copy',
  targetRegions: ['/content'],
};

function request(action: string, body: unknown): Request {
  return new Request(
    `https://example.com/api/sites/${SITE_ID}/branches/${BRANCH_ID}/documents/page/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function assertNotNull<T>(value: T | null): T {
  if (value === null) {
    throw new Error('Expected the route to handle this request');
  }
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStub = { fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) };
  mockEnv = createMockEnv();
  vi.mocked(branchService.getBranch).mockResolvedValue(branchForRef(SITE_ID, BRANCH_ID));
  vi.mocked(branchService.getBranchByName).mockResolvedValue(branchForRef(SITE_ID, BRANCH_ID));
  vi.mocked(documentService.getDocumentByPath).mockResolvedValue({
    id: 'dddddddd-0000-4000-8000-000000000001',
    siteId: SITE_ID,
    path: 'page',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Awaited<ReturnType<typeof documentService.getDocumentByPath>>);
});

describe('a signed-in person on the edit-session endpoints', () => {
  it.each([
    ['can-agent-edit', startBody],
    ['agent-edit-start', startBody],
    ['agent-edit-complete', { editSessionId: 'edit-1' }],
    ['agent-edit-abort', { editSessionId: 'edit-1' }],
  ])('reaches the document session for %s', async (action, body) => {
    const response = assertNotNull(
      await handleRealtimeRoutes(request(action, body), mockEnv, personContext),
    );

    expect(response.status).toBe(200);
    expect(mockStub.fetch).toHaveBeenCalled();
  });

  it('never consults the agent registry for a person', async () => {
    await handleRealtimeRoutes(request('agent-edit-start', startBody), mockEnv, personContext);

    expect(vi.mocked(getAgentById)).not.toHaveBeenCalled();
  });

  it('forwards the person as the verified actor', async () => {
    await handleRealtimeRoutes(request('agent-edit-start', startBody), mockEnv, personContext);

    const forwarded = mockStub.fetch.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get('X-Verified-Actor-Id')).toBe(personPrincipal.id);
    expect(forwarded.headers.get('X-Verified-Actor-Type')).toBe('user');
    expect(forwarded.headers.get('X-Verified-Db-User-Id')).toBe(personPrincipal.dbUserId);
    expect(forwarded.headers.get('X-Verified-Name')).toBe('Ada Lovelace');
  });

  it('does not name a person as an agent', async () => {
    await handleRealtimeRoutes(request('agent-edit-start', startBody), mockEnv, personContext);

    const forwarded = mockStub.fetch.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get('X-Agent-Name')).toBeNull();
  });

  it('drops a caller-supplied agent name', async () => {
    const spoofed = new Request(
      `https://example.com/api/sites/${SITE_ID}/branches/${BRANCH_ID}/documents/page/agent-edit-start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Name': 'Totally An Agent' },
        body: JSON.stringify(startBody),
      },
    );

    await handleRealtimeRoutes(spoofed, mockEnv, personContext);

    const forwarded = mockStub.fetch.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get('X-Agent-Name')).toBeNull();
  });
});

describe('a shared service credential', () => {
  it.each([
    ['can-agent-edit', startBody],
    ['agent-edit-start', startBody],
    ['agent-edit-complete', { editSessionId: 'edit-1' }],
    ['agent-edit-abort', { editSessionId: 'edit-1' }],
  ])('is refused on %s', async (action, body) => {
    const response = assertNotNull(
      await handleRealtimeRoutes(request(action, body), mockEnv, serviceContext),
    );

    expect(response.status).toBe(403);
    expect(mockStub.fetch).not.toHaveBeenCalled();
  });
});
