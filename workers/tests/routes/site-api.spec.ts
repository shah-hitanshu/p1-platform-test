/**
 * Phase 7.1.1b: Site API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for site operations.
 * Includes deletion protection for sites with non-archived branches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  createSite: vi.fn(),
  createMainBranch: vi.fn(),
  getSite: vi.fn(),
  updateSite: vi.fn(),
  deleteSite: vi.fn(),
  listSites: vi.fn(),
  listBranches: vi.fn(),
  getMainBranch: vi.fn(),
  DuplicatePantheonSiteIdError: class DuplicatePantheonSiteIdError extends Error {
    name = 'DuplicatePantheonSiteIdError';
    constructor(public pantheonSiteId: string) {
      super(`A site with Pantheon site ID "${pantheonSiteId}" already exists.`);
    }
  },
  InvalidSiteParamsError: class InvalidSiteParamsError extends Error {
    override name = 'InvalidSiteParamsError';
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

describe('Phase 7.1.1b: Site API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /api/sites - Create Site
  // ===========================================================================

  describe('POST /api/sites', () => {
    it('should create a new site with main branch', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.createSite).mockResolvedValueOnce({
        id: 'site-uuid',
        pantheonSiteId: 'site-abc-123',
        name: 'Marketing Website',
        workflowSettings: {
          mergeApprovalMode: 'required',
          minApprovers: 2,
          allowSelfApproval: false,
          approverMode: 'both',
          approverMinRole: 'EDITOR',
        },
        createdAt: '2026-01-24T10:00:00.000Z',
        updatedAt: '2026-01-24T10:00:00.000Z',
      });

      // Mock main branch creation (now auto-created with site)
      vi.mocked(services.createMainBranch).mockResolvedValueOnce({
        id: 'branch-main-uuid',
        siteId: 'site-uuid',
        name: 'main',
        description: 'Main branch',
        status: 'active',
        isMain: true,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-24T10:00:00.000Z',
        updatedAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request('https://api.example.com/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pantheonSiteId: 'site-abc-123',
          name: 'Marketing Website',
          workflowSettings: {
            mergeApprovalMode: 'required',
            minApprovers: 2,
            allowSelfApproval: false,
          },
        }),
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('site-uuid');
      expect(body.pantheonSiteId).toBe('site-abc-123');
      expect(body.name).toBe('Marketing Website');
      expect(body.workflowSettings.mergeApprovalMode).toBe('required');
    });

    it('should return 400 for missing pantheonSiteId', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Marketing Website',
        }),
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('pantheonSiteId');
    });

    it('should return 400 for missing name', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pantheonSiteId: 'site-abc-123',
        }),
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('name');
    });

    it('should return 409 for duplicate pantheonSiteId', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.createSite).mockRejectedValueOnce(
        new services.DuplicatePantheonSiteIdError('site-abc-123'),
      );

      const request = new Request('https://api.example.com/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pantheonSiteId: 'site-abc-123',
          name: 'Marketing Website',
        }),
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(409);
    });
  });

  // ===========================================================================
  // GET /api/sites - List Sites
  // ===========================================================================

  describe('GET /api/sites', () => {
    it('should list all sites', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockResolvedValueOnce([
        {
          id: 'site-1',
          pantheonSiteId: 'pantheon-1',
          name: 'Site One',
          workflowSettings: {
            mergeApprovalMode: 'optional',
            minApprovers: 1,
            allowSelfApproval: true,
            approverMode: 'both',
            approverMinRole: 'EDITOR',
          },
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'site-2',
          pantheonSiteId: 'pantheon-2',
          name: 'Site Two',
          workflowSettings: {
            mergeApprovalMode: 'optional',
            minApprovers: 1,
            allowSelfApproval: true,
            approverMode: 'both',
            approverMinRole: 'EDITOR',
          },
          createdAt: '2026-01-24T11:00:00.000Z',
          updatedAt: '2026-01-24T11:00:00.000Z',
        },
      ]);

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.sites).toHaveLength(2);
      expect(body.sites[0].name).toBe('Site One');
    });

    it('should support pagination parameters', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites?limit=20&offset=10',
        { method: 'GET' },
      );

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.listSites).toHaveBeenCalledWith({
        limit: 20,
        offset: 10,
      });
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId} - Get Site
  // ===========================================================================

  describe('GET /api/sites/{siteId}', () => {
    it('should return site details', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getSite).mockResolvedValueOnce({
        id: 'site-1',
        pantheonSiteId: 'pantheon-1',
        name: 'Marketing Website',
        workflowSettings: {
          mergeApprovalMode: 'required',
          minApprovers: 2,
          allowSelfApproval: false,
          approverMode: 'both',
          approverMinRole: 'EDITOR',
        },
        createdAt: '2026-01-24T10:00:00.000Z',
        updatedAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1',
        { method: 'GET' },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('site-1');
      expect(body.name).toBe('Marketing Website');
    });

    it('should return 404 for non-existent site', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(null);
      vi.mocked(services.getSite).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/nonexistent',
        { method: 'GET' },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // PATCH /api/sites/{siteId} - Update Site
  // ===========================================================================

  describe('PATCH /api/sites/{siteId}', () => {
    it('should update site name', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.updateSite).mockResolvedValueOnce({
        id: 'site-1',
        pantheonSiteId: 'pantheon-1',
        name: 'Updated Website Name',
        workflowSettings: {
          mergeApprovalMode: 'optional',
          minApprovers: 1,
          allowSelfApproval: true,
          approverMode: 'both',
          approverMinRole: 'EDITOR',
        },
        createdAt: '2026-01-24T10:00:00.000Z',
        updatedAt: '2026-01-24T10:30:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Updated Website Name',
          }),
        },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.name).toBe('Updated Website Name');
    });

    it('should update workflow settings (partial)', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.updateSite).mockResolvedValueOnce({
        id: 'site-1',
        pantheonSiteId: 'pantheon-1',
        name: 'Marketing Website',
        workflowSettings: {
          mergeApprovalMode: 'required',
          minApprovers: 3,
          allowSelfApproval: false,
          approverMode: 'both',
          approverMinRole: 'EDITOR',
        },
        createdAt: '2026-01-24T10:00:00.000Z',
        updatedAt: '2026-01-24T10:30:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowSettings: {
              minApprovers: 3,
            },
          }),
        },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.workflowSettings.minApprovers).toBe(3);
    });

    it('should return 404 for non-existent site', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(null);
      vi.mocked(services.updateSite).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/nonexistent',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Updated Name',
          }),
        },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // DELETE /api/sites/{siteId} - Delete Site
  // ===========================================================================

  describe('DELETE /api/sites/{siteId}', () => {
    it('should delete a site when all branches are archived', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // No non-archived branches
      vi.mocked(services.listBranches).mockResolvedValueOnce([]);
      vi.mocked(services.deleteSite).mockResolvedValueOnce(true);

      const request = new Request(
        'https://api.example.com/api/sites/site-1',
        { method: 'DELETE' },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(204);
    });

    it('should return 409 if site has active non-main branches', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Has active non-main branch (feature branch)
      vi.mocked(services.listBranches).mockResolvedValueOnce([
        {
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          isMain: true,
          status: 'active',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        {
          id: 'branch-2',
          siteId: 'site-1',
          name: 'feature-branch',
          isMain: false,
          status: 'active',
          createdAt: '2026-01-24T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1',
        { method: 'DELETE' },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toContain('non-main branches');
    });

    it('should return 404 for non-existent site', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(null);
      vi.mocked(services.listBranches).mockResolvedValueOnce([]);
      vi.mocked(services.deleteSite).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/sites/nonexistent',
        { method: 'DELETE' },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 405 for unsupported methods', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'PUT',
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(405);
    });

    it('should handle service errors gracefully', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(500);
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

    it('should check canView permission for GET single site', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getSite).mockResolvedValueOnce({
        id: 'site-1',
        pantheonSiteId: 'pantheon-1',
        name: 'Marketing Website',
        workflowSettings: {
          mergeApprovalMode: 'optional',
          minApprovers: 1,
          allowSelfApproval: true,
          approverMode: 'both',
          approverMinRole: 'EDITOR',
        },
        createdAt: '2026-01-24T10:00:00.000Z',
        updatedAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1',
        { method: 'GET' },
      );

      await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'main-branch-id',
        'canView',
      );
    });

    it('should check canManageGrants permission for DELETE site', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.listBranches).mockResolvedValueOnce([]);
      vi.mocked(services.deleteSite).mockResolvedValueOnce(true);

      const request = new Request(
        'https://api.example.com/api/sites/site-1',
        { method: 'DELETE' },
      );

      await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'main-branch-id',
        'canManageGrants',
      );
    });

    it('should not check permission for GET list sites', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.listSites).mockResolvedValueOnce([]);

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
      });

      await handleSiteRoutes(request, {
        principal: authPrincipal,
      });

      expect(assertPermission).not.toHaveBeenCalled();
    });

    it('should return 403 when principal lacks permission', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');
      const { assertPermission, AuthorizationError } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(assertPermission).mockImplementationOnce(() => {
        throw new AuthorizationError(
          'Permission denied',
          'canView',
          'viewer',
        );
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1',
        { method: 'GET' },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: authPrincipal,
      });

      expect(response.status).toBe(403);
    });
  });
});
