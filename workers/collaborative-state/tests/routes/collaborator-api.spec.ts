/**
 * Collaborator API Routes Tests
 *
 * Tests for REST API endpoints for site collaborator management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import { readJson } from '../helpers/http';
import { makeBranch } from '../helpers/branch';

// Mock the db module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock services (for getMainBranch)
vi.mock('../../src/services', () => ({
  getMainBranch: vi.fn(),
}));

// Mock authorization
vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  getEffectiveRole: vi.fn(),
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

describe('Collaborator API Routes', () => {
  const adminPrincipal: AuthenticatedPrincipal = {
    id: 'user-admin',
    type: 'user',
    email: 'admin@example.com',
    pantheonSiteRoles: { 'site-1': 'admin' },
    tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
    authProvider: 'auth0',
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('POST /api/sites/{siteId}/collaborators', () => {
    it('should grant site access with valid body', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const db = await import('../../src/db');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(makeBranch({
        id: 'branch-main',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{
          id: 'role-1',
          user_id: 'user-2',
          site_id: 'site-1',
          role: 'developer',
          source: 'local',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/collaborators',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: 'user-2',
            role: 'developer',
          }),
        },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'site-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.userId).toBe('user-2');
      expect(body.role).toBe('developer');
      expect(body.source).toBe('local');
    });

    it('should return 400 when userId is missing', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(makeBranch({
        id: 'branch-main',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      const request = new Request(
        'https://api.example.com/api/sites/site-1/collaborators',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'developer' }),
        },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'site-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('userId');
    });

    it('should return 400 when role is invalid', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(makeBranch({
        id: 'branch-main',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      const request = new Request(
        'https://api.example.com/api/sites/site-1/collaborators',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user-2', role: 'superadmin' }),
        },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'site-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('Invalid role');
    });
  });

  describe('GET /api/sites/{siteId}/collaborators', () => {
    it('should list all collaborators', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const db = await import('../../src/db');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(makeBranch({
        id: 'branch-main',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'role-1',
            user_id: 'user-1',
            site_id: 'site-1',
            role: 'admin',
            source: 'local',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'role-2',
            user_id: 'user-2',
            site_id: 'site-1',
            role: 'developer',
            source: 'mas',
            created_at: '2026-01-02T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
          },
        ],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/collaborators',
        { method: 'GET' },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'site-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.collaborators).toHaveLength(2);
      expect(body.collaborators[0].source).toBe('local');
      expect(body.collaborators[1].source).toBe('mas');
    });
  });

  describe('DELETE /api/sites/{siteId}/collaborators/{userId}', () => {
    it('should remove a local collaborator grant', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const db = await import('../../src/db');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(makeBranch({
        id: 'branch-main',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      // Owner count: 2 owners exist, safe to remove
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '2' }] });
      // Delete succeeds
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/collaborators/user-2',
        { method: 'DELETE' },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'site-1',
        userId: 'user-2',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 when local grant not found', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const db = await import('../../src/db');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(makeBranch({
        id: 'branch-main',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      // Owner count: 2 owners, safe to proceed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '2' }] });
      // Delete finds nothing
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/collaborators/user-2',
        { method: 'DELETE' },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'site-1',
        userId: 'user-2',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should prevent removing the last owner', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const db = await import('../../src/db');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(makeBranch({
        id: 'branch-main',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      // Count query returns 1 owner
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '1' }],
      });
      // Target role check — this user is the owner
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ role: 'owner' }],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/collaborators/user-1',
        { method: 'DELETE' },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'site-1',
        userId: 'user-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(409);
      const body = await readJson(response);
      expect(body.error).toContain('last owner');
    });

    it('should allow removing an owner when another owner exists', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const db = await import('../../src/db');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(makeBranch({
        id: 'branch-main',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      // Count query returns 2 owners
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '2' }],
      });
      // Delete succeeds
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/collaborators/user-1',
        { method: 'DELETE' },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'site-1',
        userId: 'user-1',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(204);
    });
  });

  describe('Authorization', () => {
    it('should return 403 when principal lacks admin role', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue(makeBranch({
        id: 'branch-main',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      vi.mocked(auth.assertPermission).mockRejectedValueOnce(
        new auth.AuthorizationError(
          'Missing permission: canManageGrants',
          'canManageGrants',
          'EDITOR',
        ),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/collaborators',
        { method: 'GET' },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'site-1',
        principal: {
          ...adminPrincipal,
          id: 'user-editor',
          pantheonSiteRoles: { 'site-1': 'developer' },
        },
      });

      expect(response.status).toBe(403);
    });

    it('should return 404 when site not found', async () => {
      const { handleCollaboratorRoutes } = await import('../../src/routes/collaborator-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/nonexistent/collaborators',
        { method: 'GET' },
      );

      const response = await handleCollaboratorRoutes(request, {
        siteId: 'nonexistent',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(404);
    });
  });
});
