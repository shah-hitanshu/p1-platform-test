/**
 * Users API Routes Tests
 *
 * Tests for REST API endpoints for system user allowlist management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import { readJson } from '../helpers/http';

// Mock the db module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

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
    principal_id: null,
    auth_provider: null,
    system_role: 'member',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('Admin access control', () => {
    it('should allow access when no users exist (bootstrap mode)', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');
      const db = await import('../../src/db');

      // Count query: no users
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // List query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

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
      const db = await import('../../src/db');

      // Count query: users exist
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '1' }] });
      // Admin check: not found
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

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
      const db = await import('../../src/db');

      // Count query: users exist
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '1' }] });
      // Admin check: found with the platform admin role
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ system_role: 'superadmin' }] });
      // List query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockUserRow] });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // List query
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          mockUserRow,
          {
            ...mockUserRow,
            id: 'user-uuid-2',
            email: 'admin@example.com',
            name: 'Admin User',
            system_role: 'superadmin',
          },
        ],
      });

      const request = new Request(
        'https://api.example.com/api/admin/users',
        { method: 'GET' },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // List query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

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
      const db = await import('../../src/db');

      // isSystemAdmin count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // handleAddUser bootstrap count query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Auto-insert principal as admin (different email from test@example.com)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Duplicate check
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Insert
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockUserRow] });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });

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
      const db = await import('../../src/db');

      // isSystemAdmin count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // handleAddUser bootstrap count query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Auto-insert principal as admin (different email from root@example.com)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Duplicate check
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Insert
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ ...mockUserRow, email: 'root@example.com', system_role: 'superadmin' }],
      });

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
      const db = await import('../../src/db');

      // isSystemAdmin count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // handleAddUser bootstrap count query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Auto-insert principal as admin
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Duplicate check: found
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] });

      const request = new Request(
        'https://api.example.com/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' }),
        },
      );

      const response = await handleUsersRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(409);
      const body = await readJson(response);
      expect(body.error).toContain('already exists');
    });
  });

  describe('PATCH /api/admin/users/:userId', () => {
    it('should update user role', async () => {
      const { handleUsersRoutes } = await import('../../src/routes/users-api');
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Update query
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ ...mockUserRow, system_role: 'superadmin' }],
      });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Update query
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ ...mockUserRow, is_active: false }],
      });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Update query: no rows returned
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Delete query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Delete query: no rows deleted
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });

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
      const db = await import('../../src/db');

      // Count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });

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
      const db = await import('../../src/db');
      const { createOrgForUser } = await import('../../src/services/organization-service');

      // isSystemAdmin count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // handleAddUser bootstrap count query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Auto-insert principal as admin
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Duplicate check
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Insert user
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockUserRow] });

      // createOrgForUser mock
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
      const db = await import('../../src/db');
      const { createOrgForUser } = await import('../../src/services/organization-service');

      // isSystemAdmin count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // handleAddUser bootstrap count query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Auto-insert principal as admin
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Duplicate check
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Insert user
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockUserRow] });

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
      const db = await import('../../src/db');
      const { createOrgForUser } = await import('../../src/services/organization-service');

      // isSystemAdmin count query: no users (bootstrap)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // handleAddUser bootstrap count query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // Auto-insert principal as admin
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Duplicate check
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Insert user
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockUserRow] });

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
      const db = await import('../../src/db');

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: enriched({ systemRole: 'superadmin' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.systemRole).toBe('superadmin');
      expect(body.isSystemAdmin).toBe(true);
      // The request gate already resolved the role, so nothing is re-read.
      expect(db.query).not.toHaveBeenCalled();
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
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ ...mockUserRow, system_role: 'superadmin' }],
      });

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: adminPrincipal,
      });

      const body = await readJson(response);
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(body.id).toBe('user-uuid-1');
      expect(body.email).toBe('test@example.com');
      expect(body.isSystemAdmin).toBe(true);
    });

    it('reports no role for a user with no row yet', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: adminPrincipal,
      });

      const body = await readJson(response);
      expect(body.systemRole).toBeNull();
      expect(body.isSystemAdmin).toBe(false);
    });

    it('never treats an agent principal as an admin', async () => {
      const { handleCurrentUserRoute } = await import('../../src/routes/users-api');
      const db = await import('../../src/db');

      const response = await handleCurrentUserRoute(meRequest(), {
        principal: { ...adminPrincipal, type: 'agent', systemRole: 'superadmin' },
      });

      const body = await readJson(response);
      expect(body.systemRole).toBeNull();
      expect(body.isSystemAdmin).toBe(false);
      expect(db.query).not.toHaveBeenCalled();
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
      const db = await import('../../src/db');

      vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);
      vi.mocked(db.query).mockRejectedValueOnce(new Error('DB down'));

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
