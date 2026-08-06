/**
 * Phase 7.1d: Grant API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for branch grant operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';

// Mock the services
vi.mock('../../src/services', () => ({
  createGrant: vi.fn(),
  getGrant: vi.fn(),
  listGrants: vi.fn(),
  deleteGrant: vi.fn(),
  getBranch: vi.fn().mockResolvedValue({ id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true }),
  GrantNotFoundError: class GrantNotFoundError extends Error {
    name = 'GrantNotFoundError';
    constructor(public grantId: string) {
      super(`Grant not found: ${grantId}`);
    }
  },
  BranchNotFoundError: class BranchNotFoundError extends Error {
    name = 'BranchNotFoundError';
    constructor(public branchId: string) {
      super(`Branch not found: ${branchId}`);
    }
  },
  DuplicateGrantError: class DuplicateGrantError extends Error {
    name = 'DuplicateGrantError';
    constructor(
      public branchId: string,
      public actorId: string,
    ) {
      super('Grant already exists for actor on branch');
    }
  },
}));

// Mock authorization
vi.mock('../../src/auth/authorization', () => ({
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

describe('Phase 7.1d: Grant API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/branches/{branchId}/grants - Create Grant
  // ===========================================================================

  describe('POST /api/sites/{siteId}/branches/{branchId}/grants', () => {
    it('should create a new grant', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(makeBranch({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      vi.mocked(services.createGrant).mockResolvedValueOnce({
        id: 'grant-1',
        branchId: 'branch-1',
        actorId: 'user-2',
        actorType: 'user',
        role: 'EDITOR',
        grantedById: 'user-1',
        grantedByType: 'user',
        reason: 'Needs edit access',
        grantedAt: '2026-01-24T11:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actorId: 'user-2',
            actorType: 'user',
            role: 'EDITOR',
            reason: 'Needs edit access',
          }),
        },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.id).toBe('grant-1');
      expect(body.role).toBe('EDITOR');
    });

    it('should return 400 for missing actorId', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actorType: 'user',
            role: 'EDITOR',
          }),
        },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 409 for duplicate grant', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(makeBranch({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      vi.mocked(services.createGrant).mockRejectedValueOnce(
        new services.DuplicateGrantError('branch-1', 'user-2'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actorId: 'user-2',
            actorType: 'user',
            role: 'EDITOR',
          }),
        },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(409);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/branches/{branchId}/grants - List Grants
  // ===========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}/grants', () => {
    it('should list all grants for a branch', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.listGrants).mockResolvedValueOnce([
        {
          id: 'grant-1',
          branchId: 'branch-1',
          actorId: 'user-2',
          actorType: 'user',
          role: 'EDITOR',
          grantedById: 'user-1',
          grantedByType: 'user',
          grantedAt: '2026-01-24T11:00:00.000Z',
        },
        {
          id: 'grant-2',
          branchId: 'branch-1',
          actorId: 'agent-1',
          actorType: 'agent',
          role: 'VIEWER',
          grantedById: 'user-1',
          grantedByType: 'user',
          grantedAt: '2026-01-24T12:00:00.000Z',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        { method: 'GET' },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.grants).toHaveLength(2);
      expect(body.grants[0].role).toBe('EDITOR');
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/branches/{branchId}/grants/{grantId} - Get Grant
  // ===========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}/grants/{grantId}', () => {
    it('should return grant details', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.getGrant).mockResolvedValueOnce({
        id: 'grant-1',
        branchId: 'branch-1',
        actorId: 'user-2',
        actorType: 'user',
        role: 'EDITOR',
        grantedById: 'user-1',
        grantedByType: 'user',
        reason: 'Needs edit access',
        grantedAt: '2026-01-24T11:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants/grant-1',
        { method: 'GET' },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        grantId: 'grant-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.id).toBe('grant-1');
    });

    it('should return 404 for non-existent grant', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.getGrant).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants/nonexistent',
        { method: 'GET' },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        grantId: 'nonexistent',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // DELETE /api/sites/{siteId}/branches/{branchId}/grants/{grantId} - Delete Grant
  // ===========================================================================

  describe('DELETE /api/sites/{siteId}/branches/{branchId}/grants/{grantId}', () => {
    it('should delete a grant', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.deleteGrant).mockResolvedValueOnce(true);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants/grant-1',
        { method: 'DELETE' },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        grantId: 'grant-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 for non-existent grant', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.deleteGrant).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants/nonexistent',
        { method: 'DELETE' },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        grantId: 'nonexistent',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 404 for non-existent branch', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.listGrants).mockRejectedValueOnce(
        new services.BranchNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/nonexistent/grants',
        { method: 'GET' },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'nonexistent',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 405 for unsupported methods', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        { method: 'PUT' },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(405);
    });
  });

  // ===========================================================================
  // Authorization
  // ===========================================================================

  describe('Authorization', () => {
    const authPrincipal = {
      id: 'user-1',
      type: 'user' as const,
      email: 'alice@example.com',
      pantheonSiteRoles: { 'site-1': 'admin' as const },
      tokenExpiry: '2026-01-24T10:00:00.000Z',
    };

    it('should check canView permission for GET list grants', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.listGrants).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        { method: 'GET' },
      );

      await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canView',
      );
    });

    it('should check canManageGrants permission for POST create grant', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getBranch).mockResolvedValueOnce(makeBranch({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      vi.mocked(services.createGrant).mockResolvedValueOnce({
        id: 'grant-1',
        branchId: 'branch-1',
        actorId: 'user-2',
        actorType: 'user',
        role: 'EDITOR',
        grantedById: 'user-1',
        grantedByType: 'user',
        grantedAt: '2026-01-24T11:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actorId: 'user-2',
            actorType: 'user',
            role: 'EDITOR',
          }),
        },
      );

      await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canManageGrants',
      );
    });

    it('should return 403 when principal lacks permission', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const { assertPermission, AuthorizationError } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(assertPermission).mockImplementationOnce(() => {
        throw new AuthorizationError(
          'Permission denied',
          'canView',
          'viewer',
        );
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        { method: 'GET' },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: authPrincipal,
      });

      expect(response.status).toBe(403);
    });
  });

  // ===========================================================================
  // Cross-tenant IDOR protection
  // ===========================================================================

  describe('Cross-tenant IDOR protection', () => {
    it('rejects grant creation when branch belongs to a different site', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(makeBranch({
        id: 'branch-1',
        siteId: 'site-OTHER',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actorId: 'user-2',
            actorType: 'user',
            role: 'EDITOR',
          }),
        },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
      expect(services.createGrant).not.toHaveBeenCalled();
    });

    it('rejects grant listing when branch belongs to a different site', async () => {
      const { handleGrantRoutes } = await import('../../src/routes/grant-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(makeBranch({
        id: 'branch-1',
        siteId: 'site-OTHER',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/grants',
        { method: 'GET' },
      );

      const response = await handleGrantRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
      expect(services.listGrants).not.toHaveBeenCalled();
    });
  });
});
