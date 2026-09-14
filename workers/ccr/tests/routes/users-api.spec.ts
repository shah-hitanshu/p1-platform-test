/**
 * Users API Routes Tests
 *
 * Tests for REST API endpoints for system user allowlist management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import { readJson } from '../helpers/http';
import { users } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

// Mock the organization service for auto-create org
vi.mock('../../src/services/organization-service', async () => {
  const actual = await vi.importActual('../../src/services/organization-service');
  return {
    ...actual,
    createOrgForUser: vi.fn(),
  };
});

describe('Users API Routes', () => {
  const adminPrincipal: AuthenticatedPrincipal = {
    id: 'user-admin',
    type: 'user',
    email: 'admin@example.com',
    pantheonSiteRoles: {},
    tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
    authProvider: 'google',
  };

  const mockUserRow = {
    id: 'user-uuid-1',
    email: 'test@example.com',
    name: 'Test User',
    principalId: null,
    authProvider: null,
    systemRole: 'member',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  let database: DatabaseStub;

  beforeEach(() => {
    vi.clearAllMocks();
    database = stubDatabase();
  });

  describe('Admin access control', () => {
    it('should allow access when no users exist (bootstrap mode)', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      // isSystemAdmin's bootstrap check and handleListUsers' own select share
      // the users.select stub; an empty table (the default, unstubbed) passes
      // both trivially.

      const request = new Request(
        'https://api.example.com/api/admin/users',
        { method: 'GET' },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(200);
    });

    it('should deny access when principal is not a system admin', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      // A populated table with no row naming this principal: not bootstrap,
      // and the role lookup (same stub) finds no systemRole for it.
      database.on(users).select.returns([{ id: 'someone-else' }]);

      const request = new Request(
        'https://api.example.com/api/admin/users',
        { method: 'GET' },
      );

      const response = await handleUsersRoutes(request, {
        principal: { ...adminPrincipal, id: 'user-non-admin' },
      });

      expect(response.status).toBe(403);
      const body = await readJson(response);
      expect(body.error).toContain('admin');
    });

    it('should allow access when principal is a system admin', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      // isSystemAdmin's bootstrap check, its role lookup, and handleListUsers'
      // own select all read this one stubbed row.
      database.on(users).select.returns([{ ...mockUserRow, systemRole: 'superadmin' }]);

      const request = new Request(
        'https://api.example.com/api/admin/users',
        { method: 'GET' },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/admin/users', () => {
    it('should list all users', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      // The admin gate's own bootstrap check reads the same stubbed rows, so
      // the principal carries its role directly rather than depending on a
      // lookup against the row this test is really about: the listing.
      database.on(users).select.returns([
        mockUserRow,
        {
          ...mockUserRow,
          id: 'user-uuid-2',
          email: 'admin@example.com',
          name: 'Admin User',
          systemRole: 'superadmin',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/admin/users',
        { method: 'GET' },
      );

      const response = await handleUsersRoutes(request, {
        principal: { ...adminPrincipal, systemRole: 'superadmin' },
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.users).toHaveLength(2);
      expect(body.users[0].email).toBe('test@example.com');
      expect(body.users[0].systemRole).toBe('member');
      expect(body.users[1].systemRole).toBe('superadmin');
    });

    it('should return empty array when no users exist', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      const request = new Request(
        'https://api.example.com/api/admin/users',
        { method: 'GET' },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.users).toHaveLength(0);
    });
  });

  describe('POST /api/admin/users', () => {
    it('should add a user with valid body', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      database.on(users).insert.returns([mockUserRow]);

      const request = new Request(
        'https://api.example.com/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            name: 'Test User',
            systemRole: 'member',
          }),
        },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.email).toBe('test@example.com');
      expect(body.name).toBe('Test User');
      expect(body.systemRole).toBe('member');
      expect(body.isActive).toBe(true);
    });

    it('should return 400 when email is missing', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      const request = new Request(
        'https://api.example.com/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'No Email' }),
        },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('email');
    });

    it('should return 400 when systemRole is invalid', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      const request = new Request(
        'https://api.example.com/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com', systemRole: 'owner' }),
        },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('Invalid systemRole');
    });

    // PCC-3479: superadmin is a P1-only role, assignable only on this
    // platform-admin surface (the org-scoped user API refuses to grant it).
    it('should accept the superadmin systemRole', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      database.on(users).insert.returns([
        { ...mockUserRow, email: 'root@example.com', systemRole: 'superadmin' },
      ]);

      const request = new Request(
        'https://api.example.com/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'root@example.com', systemRole: 'superadmin' }),
        },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.systemRole).toBe('superadmin');
    });

    it('should return 409 when email already exists', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      // The admin gate's bootstrap check and the duplicate-email check share
      // the users.select stub; the principal carries its role directly so a
      // populated result here only has to answer the duplicate check.
      database.on(users).select.returns([{ id: 'existing-id' }]);

      const request = new Request(
        'https://api.example.com/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' }),
        },
      );

      const response = await handleUsersRoutes(request, {
        principal: { ...adminPrincipal, systemRole: 'superadmin' },
      });

      expect(response.status).toBe(409);
      const body = await readJson(response);
      expect(body.error).toContain('already exists');
    });
  });

  describe('PATCH /api/admin/users/:userId', () => {
    it('should update user role', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      database.on(users).update.returns([{ ...mockUserRow, systemRole: 'superadmin' }]);

      const request = new Request(
        'https://api.example.com/api/admin/users/user-uuid-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemRole: 'superadmin' }),
        },
      );

      const response = await handleUsersRoutes(request, {
        userId: 'user-uuid-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.systemRole).toBe('superadmin');
    });

    // PCC-3479: `admin` is legacy — it grants nothing, so it is not offered as
    // something this surface can assign.
    it('refuses to assign the retired admin role', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      const request = new Request(
        'https://api.example.com/api/admin/users/user-uuid-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemRole: 'admin' }),
        },
      );

      const response = await handleUsersRoutes(request, {
        userId: 'user-uuid-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('member, superadmin');
    });

    it('should update user active status', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      database.on(users).update.returns([{ ...mockUserRow, isActive: false }]);

      const request = new Request(
        'https://api.example.com/api/admin/users/user-uuid-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: false }),
        },
      );

      const response = await handleUsersRoutes(request, {
        userId: 'user-uuid-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.isActive).toBe(false);
    });

    it('should return 400 when no fields to update', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      const request = new Request(
        'https://api.example.com/api/admin/users/user-uuid-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );

      const response = await handleUsersRoutes(request, {
        userId: 'user-uuid-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('No fields');
    });

    it('should return 404 when user not found', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      // Update matches no row (default: an unstubbed update returns none).

      const request = new Request(
        'https://api.example.com/api/admin/users/nonexistent',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated' }),
        },
      );

      const response = await handleUsersRoutes(request, {
        userId: 'nonexistent',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/admin/users/:userId', () => {
    it('should remove a user', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      database.on(users).delete.returns([{ email: mockUserRow.email }]);

      const request = new Request(
        'https://api.example.com/api/admin/users/user-uuid-1',
        { method: 'DELETE' },
      );

      const response = await handleUsersRoutes(request, {
        userId: 'user-uuid-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 when user not found', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      // Delete matches no row (default: an unstubbed delete returns none).

      const request = new Request(
        'https://api.example.com/api/admin/users/nonexistent',
        { method: 'DELETE' },
      );

      const response = await handleUsersRoutes(request, {
        userId: 'nonexistent',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('Method not allowed', () => {
    it('should return 405 for unsupported methods on collection', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      const request = new Request(
        'https://api.example.com/api/admin/users',
        { method: 'PUT' },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(405);
    });

    it('should return 405 for unsupported methods on single user', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');

      const request = new Request(
        'https://api.example.com/api/admin/users/user-uuid-1',
        { method: 'POST' },
      );

      const response = await handleUsersRoutes(request, {
        userId: 'user-uuid-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(405);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Business Accounts Phase 1: Auto-create org on user creation
  // ───────────────────────────────────────────────────────────────────────────

  describe('POST /api/admin/users - auto-create org', () => {
    it('should auto-create org after adding user', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');
      const { createOrgForUser } = await import('../../src/services/organization-service');

      database.on(users).insert.returns([mockUserRow]);

      vi.mocked(createOrgForUser).mockResolvedValueOnce({
        id: 'org-new',
        name: 'Example',
        settings: { agentIdleTimeoutMs: 5000 },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        archivedAt: null,
        externalSpaceId: null,
      });

      const request = new Request(
        'https://api.example.com/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            name: 'Test User',
          }),
        },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(201);
      expect(createOrgForUser).toHaveBeenCalledWith(
        mockUserRow.id,
        'test@example.com',
        undefined,
        undefined,
      );
    });

    it('should pass spaceName and externalSpaceId when provided', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');
      const { createOrgForUser } = await import('../../src/services/organization-service');

      database.on(users).insert.returns([mockUserRow]);

      vi.mocked(createOrgForUser).mockResolvedValueOnce({
        id: 'org-new',
        name: 'Pantheon',
        settings: { agentIdleTimeoutMs: 5000 },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        archivedAt: null,
        externalSpaceId: 'space_abc',
      });

      const request = new Request(
        'https://api.example.com/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            name: 'Test User',
            spaceName: 'Pantheon',
            externalSpaceId: 'space_abc',
          }),
        },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(201);
      expect(createOrgForUser).toHaveBeenCalledWith(
        mockUserRow.id,
        'test@example.com',
        'Pantheon',
        'space_abc',
      );
    });

    it('should still succeed if org creation fails', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');
      const { createOrgForUser } = await import('../../src/services/organization-service');

      database.on(users).insert.returns([mockUserRow]);

      // Org creation fails — user creation should still succeed
      vi.mocked(createOrgForUser).mockRejectedValueOnce(new Error('org creation failed'));

      const request = new Request(
        'https://api.example.com/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            name: 'Test User',
          }),
        },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      // User creation should still return 201 even if org creation fails
      expect(response.status).toBe(201);
    });
  });

  // ===========================================================================
  // PCC-3479: GET /api/users/me — what the dashboard gates its admin tabs on
  // ===========================================================================

  describe('GET /api/users/me', () => {
    function meRequest(method = 'GET'): Request {
      return new Request('https://api.example.com/api/users/me', { method });
    }

    function enriched(
      overrides: Partial<AuthenticatedPrincipal> = {},
    ): AuthenticatedPrincipal {
      return {
        ...adminPrincipal,
        dbUserId: 'user-uuid-1',
        systemRole: 'member',
        ...overrides,
      };
    }

    it('reports a superadmin as a platform admin', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: enriched({ systemRole: 'superadmin' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.systemRole).toBe('superadmin');
      expect(body.isSystemAdmin).toBe(true);
      // The request gate already resolved the role, so nothing is re-read.
      expect(database.statements).toHaveLength(0);
    });

    // PCC-3479: `admin` is a legacy system_role that nothing reads any more.
    // A row still carrying it is exactly a member.
    it('does not count the legacy admin role as a platform admin', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: enriched({ systemRole: 'admin' }),
      });

      const body = await readJson(response);
      expect(body.systemRole).toBe('admin');
      expect(body.isSystemAdmin).toBe(false);
    });

    it('reports a member as not an admin', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: enriched(),
      });

      const body = await readJson(response);
      expect(body.systemRole).toBe('member');
      expect(body.isSystemAdmin).toBe(false);
    });

    it('falls back to a lookup for a principal the gate did not enrich', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');

      database.on(users).select.returns([{ ...mockUserRow, systemRole: 'superadmin' }]);

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: adminPrincipal,
      });

      const body = await readJson(response);
      expect(database.calls(users).select).toHaveLength(1);
      expect(body.id).toBe('user-uuid-1');
      expect(body.email).toBe('test@example.com');
      expect(body.isSystemAdmin).toBe(true);
    });

    it('reports no role for a user with no row yet', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');

      // No stubbed row (default: an unstubbed select returns none).

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: adminPrincipal,
      });

      const body = await readJson(response);
      expect(body.systemRole).toBeNull();
      expect(body.isSystemAdmin).toBe(false);
    });

    it('never treats an agent principal as an admin', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: { ...adminPrincipal, type: 'agent', systemRole: 'superadmin' },
      });

      const body = await readJson(response);
      expect(body.systemRole).toBeNull();
      expect(body.isSystemAdmin).toBe(false);
      expect(database.statements).toHaveLength(0);
    });

    it('rejects a non-GET method', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');

      const response = await handleCurrentUserRoute(meRequest('POST'), {
        principal: enriched(),
      });

      expect(response.status).toBe(405);
    });

    it('returns 500 when the lookup throws', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');

      vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);
      database.on(users).select.rejects(new Error('DB down'));

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(500);
    });

    it('is routed as its own handler, not the admin users one', async () => {
      const { parseRoute } = await import('../../src/routes/route-parser');

      expect(parseRoute('/api/users/me')?.handler).toBe('current-user');
      expect(parseRoute('/api/admin/users')?.handler).toBe('admin-users');
    });
  });
});
