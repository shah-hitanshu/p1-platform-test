/**
 * Site-scoped agent role routes — authorization (PCC-3676).
 *
 * POST/GET/DELETE /api/sites/:siteId/agent-roles all manage grants and must
 * require canManageGrants (site admin) on the site. Without it, any allowlisted
 * user could grant an agent admin on a site they don't administer and then act
 * through that agent — the cross-site privilege escalation this closes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/agent-site-role-service', () => ({
  grantRole: vi.fn(),
  listRolesBySite: vi.fn().mockResolvedValue([]),
  revokeRoleBySite: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/services', () => ({
  getMainBranch: vi.fn().mockResolvedValue({
    id: 'branch-main-uuid',
    siteId: 'site-uuid-100',
    name: 'main',
    isMain: true,
  }),
}));

// Real AuthorizationError (handler does `instanceof`); assertPermission stubbed.
vi.mock('../../src/auth/authorization', async (importActual) => {
  const actual = await importActual<typeof import('../../src/auth/authorization')>();
  return { ...actual, assertPermission: vi.fn().mockResolvedValue(undefined) };
});

const adminUser = {
  id: 'user-uuid-123',
  type: 'user' as const,
  email: 'admin@example.com',
  dbUserId: 'db-user-uuid-123',
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
  authProvider: 'google' as const,
};

const agentPrincipal = {
  id: 'agent-uuid-456',
  type: 'agent' as const,
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
  authProvider: 'agent_key' as const,
};

function grantRequest() {
  return new Request('https://api.example.com/api/sites/site-uuid-100/agent-roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'agent-uuid-456', role: 'admin' }),
  });
}

describe('Site Agent Role Routes — authorization (PCC-3676)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('grants when the caller is a site admin (201)', async () => {
    const { handleSiteAgentRoleRoutes } = await import('../../src/routes/site-agent-role-api');
    const roleService = await import('../../src/services/agent-site-role-service');
    vi.mocked(roleService.grantRole).mockResolvedValue({
      id: 'role-1', agentId: 'agent-uuid-456', siteId: 'site-uuid-100',
      role: 'admin', grantedBy: 'db-user-uuid-123', grantedAt: '2026-08-19T00:00:00.000Z', revokedAt: null,
    });

    const response = await handleSiteAgentRoleRoutes(grantRequest(), {
      siteId: 'site-uuid-100',
      principal: adminUser,
    });

    expect(response.status).toBe(201);
    expect(roleService.grantRole).toHaveBeenCalled();
  });

  it('rejects a grant when the caller lacks canManageGrants on the site (403)', async () => {
    const { handleSiteAgentRoleRoutes } = await import('../../src/routes/site-agent-role-api');
    const roleService = await import('../../src/services/agent-site-role-service');
    const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new AuthorizationError('Missing permission: canManageGrants.', 'canManageGrants', 'EDITOR'),
    );

    const response = await handleSiteAgentRoleRoutes(grantRequest(), {
      siteId: 'site-uuid-100',
      principal: adminUser,
    });

    expect(response.status).toBe(403);
    expect(roleService.grantRole).not.toHaveBeenCalled();
  });

  it('rejects listing agent roles without canManageGrants (403)', async () => {
    const { handleSiteAgentRoleRoutes } = await import('../../src/routes/site-agent-role-api');
    const roleService = await import('../../src/services/agent-site-role-service');
    const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new AuthorizationError('Missing permission: canManageGrants.', 'canManageGrants', 'VIEWER'),
    );

    const response = await handleSiteAgentRoleRoutes(
      new Request('https://api.example.com/api/sites/site-uuid-100/agent-roles', { method: 'GET' }),
      { siteId: 'site-uuid-100', principal: adminUser },
    );

    expect(response.status).toBe(403);
    expect(roleService.listRolesBySite).not.toHaveBeenCalled();
  });

  it('rejects a revoke without canManageGrants (403)', async () => {
    const { handleSiteAgentRoleRoutes } = await import('../../src/routes/site-agent-role-api');
    const roleService = await import('../../src/services/agent-site-role-service');
    const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new AuthorizationError('Missing permission: canManageGrants.', 'canManageGrants', 'EDITOR'),
    );

    const response = await handleSiteAgentRoleRoutes(
      new Request('https://api.example.com/api/sites/site-uuid-100/agent-roles/role-1', { method: 'DELETE' }),
      { siteId: 'site-uuid-100', roleId: 'role-1', principal: adminUser },
    );

    expect(response.status).toBe(403);
    expect(roleService.revokeRoleBySite).not.toHaveBeenCalled();
  });

  it('returns 404 when the site does not exist', async () => {
    const { handleSiteAgentRoleRoutes } = await import('../../src/routes/site-agent-role-api');
    const roleService = await import('../../src/services/agent-site-role-service');
    const services = await import('../../src/services');
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(null);

    const response = await handleSiteAgentRoleRoutes(grantRequest(), {
      siteId: 'no-such-site',
      principal: adminUser,
    });

    expect(response.status).toBe(404);
    expect(roleService.grantRole).not.toHaveBeenCalled();
  });

  it('rejects non-user principals before any authorization work (403)', async () => {
    const { handleSiteAgentRoleRoutes } = await import('../../src/routes/site-agent-role-api');
    const services = await import('../../src/services');

    const response = await handleSiteAgentRoleRoutes(grantRequest(), {
      siteId: 'site-uuid-100',
      principal: agentPrincipal,
    });

    expect(response.status).toBe(403);
    expect(services.getMainBranch).not.toHaveBeenCalled();
  });
});
