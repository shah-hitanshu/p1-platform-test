/**
 * Viewer Role Route Tests
 *
 * Tests for GET /api/sites/:siteId/branches/:branchId/auth/role, which reports
 * the caller's own effective role plus the permission flags it carries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import type { RoleName, RolePermissions } from '../../src/types';

const getEffectiveRole = vi.fn();

// The route narrows on `instanceof AuthorizationError`, so the mocked module has
// to supply the same class the route imports.
const { AuthorizationError } = vi.hoisted(() => ({
  AuthorizationError: class AuthorizationError extends Error {
    public readonly name = 'AuthorizationError';
  },
}));

vi.mock('../../src/auth/authorization', () => ({
  AuthorizationError,
  getEffectiveRole: (...args: unknown[]) => getEffectiveRole(...args),
}));

const userPrincipal = {
  id: 'user-uuid-123',
  type: 'user' as const,
  email: 'editor@example.com',
  dbUserId: 'db-user-uuid-123',
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
  authProvider: 'broker' as const,
};

const servicePrincipal = {
  id: 'token-uuid-789',
  type: 'service' as const,
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
};

function request(method = 'GET'): Request {
  return new Request('https://example.com/api/sites/site-1/branches/branch-1/auth/role', { method });
}

async function handle(context: Record<string, unknown>, method = 'GET') {
  const { handleViewerRoleRoutes } = await import('../../src/routes/viewer-role-api');
  return await handleViewerRoleRoutes(request(method), context as never);
}

describe('Viewer Role Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the effective role name and its permission flags', async () => {
    getEffectiveRole.mockResolvedValue({ roleName: 'ADMIN' as RoleName });

    const response = await handle({
      siteId: 'site-1',
      branchId: 'branch-1',
      principal: userPrincipal,
    });

    expect(response.status).toBe(200);
    const body = await readJson<{ roleName: RoleName; permissions: RolePermissions }>(response);
    expect(body.roleName).toBe('ADMIN');
    expect(body.permissions.canMergeToMain).toBe(true);
    expect(body.permissions.canManageGrants).toBe(true);
  });

  it('reports EDITOR without the admin-only flags', async () => {
    getEffectiveRole.mockResolvedValue({ roleName: 'EDITOR' as RoleName });

    const response = await handle({
      siteId: 'site-1',
      branchId: 'branch-1',
      principal: userPrincipal,
    });

    const body = await readJson<{ permissions: RolePermissions }>(response);
    expect(body.permissions.canEditDocuments).toBe(true);
    expect(body.permissions.canMergeToMain).toBe(false);
    expect(body.permissions.canManageGrants).toBe(false);
  });

  // The client renders a read-only editor from this, so it must be reachable as a
  // success. A 403 would collapse "no access" into the same path as a failed request.
  it('returns 200 with NO_ACCESS rather than 403 when the caller has no access', async () => {
    getEffectiveRole.mockResolvedValue({ roleName: 'NO_ACCESS' as RoleName });

    const response = await handle({
      siteId: 'site-1',
      branchId: 'branch-1',
      principal: userPrincipal,
    });

    expect(response.status).toBe(200);
    const body = await readJson<{ roleName: RoleName; permissions: RolePermissions }>(response);
    expect(body.roleName).toBe('NO_ACCESS');
    expect(body.permissions.canView).toBe(false);
  });

  it('forwards the MAS client so a stale cached role is refreshed', async () => {
    getEffectiveRole.mockResolvedValue({ roleName: 'EDITOR' as RoleName });
    const masClient = { cacheTtlSeconds: 300 };

    await handle({
      siteId: 'site-1',
      branchId: 'branch-1',
      principal: userPrincipal,
      masClient,
    });

    expect(getEffectiveRole).toHaveBeenCalledWith(userPrincipal, 'site-1', 'branch-1', masClient);
  });

  it('rejects non-GET methods', async () => {
    const response = await handle(
      { siteId: 'site-1', branchId: 'branch-1', principal: userPrincipal },
      'POST',
    );

    expect(response.status).toBe(405);
    expect(getEffectiveRole).not.toHaveBeenCalled();
  });

  it('requires a branch id', async () => {
    const response = await handle({
      siteId: 'site-1',
      branchId: undefined,
      principal: userPrincipal,
    });

    expect(response.status).toBe(400);
    expect(getEffectiveRole).not.toHaveBeenCalled();
  });

  // 403, not 400: the scope gate in index.ts already rejects service principals
  // with a 403 before dispatch, and the two paths must agree.
  it('rejects service principals, which authorize by token scope rather than role', async () => {
    const response = await handle({
      siteId: 'site-1',
      branchId: 'branch-1',
      principal: servicePrincipal,
    });

    expect(response.status).toBe(403);
    expect(getEffectiveRole).not.toHaveBeenCalled();
  });

  it('maps an AuthorizationError from role resolution to 403 rather than 500', async () => {
    getEffectiveRole.mockRejectedValue(new AuthorizationError('nope'));

    const response = await handle({
      siteId: 'site-1',
      branchId: 'branch-1',
      principal: userPrincipal,
    });

    expect(response.status).toBe(403);
  });

  it('returns 500 when role resolution throws', async () => {
    getEffectiveRole.mockRejectedValue(new Error('db down'));

    const response = await handle({
      siteId: 'site-1',
      branchId: 'branch-1',
      principal: userPrincipal,
    });

    expect(response.status).toBe(500);
  });
});
