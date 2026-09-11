/**
 * Site Members API Route Tests
 *
 * GET /api/sites/{siteId}/members — the people and agents on one site.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/types';
import type { SiteMembersResponse } from '../../../src/routes/site-members';
import { resetSiteRosterCacheForTests } from '../../../src/services/mas-roster-cache';
import { readJson } from '../../helpers/http';
import { makeBranch } from '../../helpers/branch';

vi.mock('../../../src/db', () => ({
  query: vi.fn(),
}));

vi.mock('../../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
}));

vi.mock('../../../src/services/agent-site-role-service', () => ({
  listRolesBySite: vi.fn(),
}));

vi.mock('../../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
    constructor(
      message: string,
      public requiredPermission: string,
      public roleName: string,
    ) {
      super(message);
    }
  },
}));

const viewerPrincipal: AuthenticatedPrincipal = {
  id: 'user-viewer',
  type: 'user',
  email: 'viewer@example.com',
  pantheonSiteRoles: { 'site-1': 'team_member' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'auth0',
};

function membersRequest(siteId = 'site-1', method = 'GET'): Request {
  return new Request(`https://api.example.com/api/sites/${siteId}/members`, { method });
}

async function loadRoute() {
  return await import('../../../src/routes/site-members');
}

async function mocks() {
  return {
    db: await import('../../../src/db'),
    branches: await import('../../../src/services/branch-service'),
    agentRoles: await import('../../../src/services/agent-site-role-service'),
    authorization: await import('../../../src/auth/authorization'),
  };
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    role: 'developer',
    source: 'local',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    avatar_url: 'https://cdn.example.com/ada.png',
    ...overrides,
  };
}

describe('GET /api/sites/{siteId}/members', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // The roster memo is module state: without this, one test's upstream read
    // answers the next test's request and the call-count assertions go quiet.
    resetSiteRosterCacheForTests();
    const { branches, agentRoles } = await mocks();
    vi.mocked(branches.getMainBranch).mockResolvedValue(
      makeBranch({ id: 'branch-main', siteId: 'site-1' }),
    );
    vi.mocked(agentRoles.listRolesBySite).mockResolvedValue([]);
  });

  it('returns members and agents as two arrays', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { db, agentRoles } = await mocks();

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [memberRow()] });
    vi.mocked(agentRoles.listRolesBySite).mockResolvedValue([
      {
        id: 'grant-1',
        agentId: 'agent-1',
        siteId: 'site-1',
        role: 'editor',
        agentName: 'Copy Editor',
        grantedBy: 'user-1',
        grantedAt: '2026-01-01T00:00:00Z',
        revokedAt: null,
        isGlobal: false,
      },
    ]);

    const response = await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
    });

    expect(response.status).toBe(200);
    const body = await readJson<SiteMembersResponse>(response);

    expect(body.members).toEqual([
      {
        id: 'user-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        role: 'developer',
        avatar: 'https://cdn.example.com/ada.png',
        source: 'local',
      },
    ]);
    expect(body.agents).toEqual([
      {
        id: 'agent-1',
        name: 'Copy Editor',
        role: 'editor',
        avatar: null,
        isGlobal: false,
      },
    ]);
  });

  it('requires only canView, not grant management', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { db, authorization } = await mocks();

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
    });

    expect(authorization.assertPermission).toHaveBeenCalledWith(
      viewerPrincipal,
      'site-1',
      'branch-main',
      'canView',
      undefined,
    );
  });

  it('folds the local and MAS rows for one person into a single member', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { db } = await mocks();

    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        memberRow({ role: 'team_member', source: 'local' }),
        memberRow({ role: 'admin', source: 'mas' }),
      ],
    });

    const response = await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
    });

    const body = await readJson<SiteMembersResponse>(response);

    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toMatchObject({
      id: 'user-1',
      role: 'admin',
      source: 'mas',
      name: 'Ada Lovelace',
    });
  });

  it('keeps the local grant when both sources rank the same tier', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { db } = await mocks();

    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        memberRow({ role: 'developer', source: 'local' }),
        memberRow({ role: 'editor', source: 'mas' }),
      ],
    });

    const response = await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
    });

    const body = await readJson<SiteMembersResponse>(response);

    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toMatchObject({ role: 'developer', source: 'local' });
  });

  it('adds upstream MAS members that hold no local role row', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { db } = await mocks();

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [memberRow()] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'user-2',
            name: 'Grace Hopper',
            email: 'grace@example.com',
            avatar_url: null,
          },
        ],
      });

    const masClient = {
      getSiteMemberships: vi.fn().mockResolvedValue([{ userId: 'user-2', role: 'admin' }]),
    };

    const response = await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
      masClient: masClient as never,
    });

    const body = await readJson<SiteMembersResponse>(response);

    expect(masClient.getSiteMemberships).toHaveBeenCalledWith('site-1');
    expect(body.members).toHaveLength(2);
    expect(body.members[1]).toEqual({
      id: 'user-2',
      name: 'Grace Hopper',
      email: 'grace@example.com',
      role: 'admin',
      avatar: null,
      source: 'mas',
    });
  });

  it('reports a MAS-only member with no local account as a null name and avatar', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { db } = await mocks();

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const masClient = {
      getSiteMemberships: vi.fn().mockResolvedValue([{ userId: 'user-9', role: 'editor' }]),
    };

    const response = await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
      masClient: masClient as never,
    });

    const body = await readJson<SiteMembersResponse>(response);

    expect(body.members).toEqual([
      {
        id: 'user-9',
        name: null,
        email: null,
        role: 'editor',
        avatar: null,
        source: 'mas',
      },
    ]);
  });

  it('serves the local members when the MAS roster is unavailable', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { db } = await mocks();

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [memberRow()] });

    const masClient = {
      getSiteMemberships: vi.fn().mockResolvedValue(null),
    };

    const response = await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
      masClient: masClient as never,
    });

    expect(response.status).toBe(200);
    const body = await readJson<SiteMembersResponse>(response);
    expect(body.members).toHaveLength(1);
  });

  it('forbids a shared cache in front of the worker from storing the roster', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { db } = await mocks();

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [memberRow()] });

    const response = await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
    });

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('reads the upstream roster once for two requests on the same site', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { db } = await mocks();

    vi.mocked(db.query).mockResolvedValue({ rows: [memberRow()] });

    const masClient = {
      getSiteMemberships: vi.fn().mockResolvedValue([{ userId: 'user-1', role: 'admin' }]),
    };
    const context = {
      siteId: 'site-1',
      principal: viewerPrincipal,
      masClient: masClient as never,
    };

    await handleSiteMembersRoutes(membersRequest(), context);
    const second = await handleSiteMembersRoutes(membersRequest(), context);

    expect(masClient.getSiteMemberships).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(200);
    expect((await readJson<SiteMembersResponse>(second)).members).toHaveLength(1);
  });

  it('returns 403 when the caller cannot view the site', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { authorization } = await mocks();

    vi.mocked(authorization.assertPermission).mockRejectedValue(
      new authorization.AuthorizationError('Insufficient permissions', 'canView', 'NO_ACCESS'),
    );

    const response = await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
    });

    expect(response.status).toBe(403);
  });

  it('returns 404 for a site with no main branch', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();
    const { branches } = await mocks();

    vi.mocked(branches.getMainBranch).mockResolvedValue(null);

    const response = await handleSiteMembersRoutes(membersRequest('site-missing'), {
      siteId: 'site-missing',
      principal: viewerPrincipal,
    });

    expect(response.status).toBe(404);
  });

  it('rejects a non-GET method', async () => {
    const { handleSiteMembersRoutes } = await loadRoute();

    const response = await handleSiteMembersRoutes(membersRequest('site-1', 'POST'), {
      siteId: 'site-1',
      principal: viewerPrincipal,
    });

    expect(response.status).toBe(405);
  });
});
