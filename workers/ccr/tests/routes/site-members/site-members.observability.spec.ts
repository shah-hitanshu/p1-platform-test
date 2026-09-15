/**
 * The served-request log line.
 *
 * `outcome` on this line is what an alert would be built from, so a request the
 * memo rescued after a failed upstream call has to say degraded — otherwise an
 * outage inside the stale grace window reads as 100% healthy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/types';
import type { MASClient } from '../../../src/services/mas-client';
import { resetSiteRosterCacheForTests } from '../../../src/services/mas-roster-cache';
import { makeBranch } from '../../helpers/branch';
import { stubDatabase } from '../../__stubs__/database';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon-systems/p1-telemetry')>();
  return { ...actual, getLogger: () => logger };
});

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

const upstreamRoster = [{ userId: 'user-mas', role: 'admin' as const }];

function membersRequest(): Request {
  return new Request('https://api.example.com/api/sites/site-1/members');
}

function servedFields(): Record<string, unknown> {
  const calls = logger.info.mock.calls as [string, Record<string, unknown>][];
  const served = calls.filter((call) => call[0] === 'site members served');
  expect(served.length).toBeGreaterThan(0);
  return served[served.length - 1][1];
}

describe('site members served log line', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetSiteRosterCacheForTests();
    vi.useFakeTimers();

    const branches = await import('../../../src/services/branch-service');
    const agentRoles = await import('../../../src/services/agent-site-role-service');
    stubDatabase();

    vi.mocked(branches.getMainBranch).mockResolvedValue(
      makeBranch({ id: 'branch-main', siteId: 'site-1' }),
    );
    vi.mocked(agentRoles.listRolesBySite).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports ok when the memo answers', async () => {
    const { handleSiteMembersRoutes } = await import('../../../src/routes/site-members');
    const masClient = {
      getSiteMemberships: vi.fn(async () => upstreamRoster),
    } as unknown as MASClient;

    await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
      masClient,
    });
    await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
      masClient,
    });

    expect(servedFields()).toMatchObject({ roster_source: 'memo', outcome: 'ok' });
  });

  it('reports degraded when a stale memo covered for a failed upstream call', async () => {
    const { handleSiteMembersRoutes } = await import('../../../src/routes/site-members');
    const getSiteMemberships = vi
      .fn<() => Promise<typeof upstreamRoster | null>>()
      .mockResolvedValueOnce(upstreamRoster)
      .mockResolvedValue(null);
    const masClient = { getSiteMemberships } as unknown as MASClient;

    await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
      masClient,
    });

    vi.advanceTimersByTime(120_000);

    await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
      masClient,
    });

    expect(servedFields()).toMatchObject({ roster_source: 'stale', outcome: 'degraded' });
  });

  it('reports ok for a deployment with no MAS client', async () => {
    const { handleSiteMembersRoutes } = await import('../../../src/routes/site-members');

    await handleSiteMembersRoutes(membersRequest(), {
      siteId: 'site-1',
      principal: viewerPrincipal,
    });

    expect(servedFields()).toMatchObject({ roster_source: 'unconfigured', outcome: 'ok' });
  });
});
