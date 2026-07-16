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
  archiveSite: vi.fn(),
  restoreSite: vi.fn(),
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
  getSiteRole: vi.fn().mockResolvedValue('ADMIN'),
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

// Mock db (used by the route layer for the acting-user email -> users.id lookup)
vi.mock('../../src/db', () => ({
  query: vi.fn(),
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

    it('should pass creatorId to createSite for owner role assignment', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.createSite).mockResolvedValueOnce({
        id: 'site-new',
        pantheonSiteId: 'site-abc-123',
        name: 'My Site',
        allowedOrigins: [],
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

      vi.mocked(services.createMainBranch).mockResolvedValueOnce({
        id: 'branch-main-uuid',
        siteId: 'site-new',
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
          name: 'My Site',
        }),
      });

      await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(services.createSite).toHaveBeenCalledWith(
        expect.objectContaining({ creatorId: 'user-1' }),
        undefined,
      );
    });

    it('should use dbUserId as creatorId when available', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.createSite).mockResolvedValueOnce({
        id: 'site-new',
        pantheonSiteId: 'site-abc-456',
        name: 'Another Site',
        allowedOrigins: [],
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

      vi.mocked(services.createMainBranch).mockResolvedValueOnce({
        id: 'branch-main-uuid',
        siteId: 'site-new',
        name: 'main',
        description: 'Main branch',
        status: 'active',
        isMain: true,
        createdById: 'db-user-123',
        createdByType: 'user',
        createdAt: '2026-01-24T10:00:00.000Z',
        updatedAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request('https://api.example.com/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pantheonSiteId: 'site-abc-456',
          name: 'Another Site',
        }),
      });

      await handleSiteRoutes(request, {
        principal: {
          id: 'provider-uuid',
          type: 'user',
          dbUserId: 'db-user-123',
        },
      });

      expect(services.createSite).toHaveBeenCalledWith(
        expect.objectContaining({ creatorId: 'db-user-123' }),
        undefined,
      );
    });

    it('should pass creatorId and createdByType agent when principal is an agent', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.createSite).mockResolvedValueOnce({
        id: 'site-new',
        pantheonSiteId: 'site-abc-789',
        name: 'Agent Site',
        allowedOrigins: [],
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

      const request = new Request('https://api.example.com/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pantheonSiteId: 'site-abc-789',
          name: 'Agent Site',
        }),
      });

      await handleSiteRoutes(request, {
        principal: { id: 'agent-uuid', type: 'agent' },
      });

      expect(services.createSite).toHaveBeenCalledWith(
        expect.objectContaining({
          creatorId: 'agent-uuid',
          createdByType: 'agent',
        }),
        undefined,
      );
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
          allowedOrigins: [],
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
          allowedOrigins: [],
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
      expect(services.listSites).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, offset: 10 }),
      );
    });

    it('should pass principalId from dbUserId for user-scoped filtering', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockResolvedValueOnce([]);

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
      });

      await handleSiteRoutes(request, {
        principal: {
          id: 'provider-id',
          type: 'user',
          dbUserId: 'db-user-1',
          pantheonSiteRoles: {},
          tokenExpiry: '2026-01-24T10:00:00.000Z',
        },
      });

      expect(services.listSites).toHaveBeenCalledWith(
        expect.objectContaining({ principalId: 'db-user-1', principalType: 'user' }),
      );
    });

    it('should pass the principal systemRole through to listSites', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockResolvedValueOnce([]);

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
      });

      await handleSiteRoutes(request, {
        principal: {
          id: 'provider-id',
          type: 'user',
          dbUserId: 'db-admin-user',
          systemRole: 'admin',
          pantheonSiteRoles: {},
          tokenExpiry: '2026-01-24T10:00:00.000Z',
        },
      });

      expect(services.listSites).toHaveBeenCalledWith(
        expect.objectContaining({
          principalId: 'db-admin-user',
          principalType: 'user',
          systemRole: 'admin',
        }),
      );
    });

    it('should fall back to principal.id when dbUserId is not set', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockResolvedValueOnce([]);

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
      });

      await handleSiteRoutes(request, {
        principal: {
          id: 'provider-id',
          type: 'user',
          pantheonSiteRoles: {},
          tokenExpiry: '2026-01-24T10:00:00.000Z',
        },
      });

      expect(services.listSites).toHaveBeenCalledWith(
        expect.objectContaining({ principalId: 'provider-id' }),
      );
    });

    it('should pass principalType agent when principal is an agent', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockResolvedValueOnce([]);

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
      });

      await handleSiteRoutes(request, {
        principal: { id: 'agent-uuid', type: 'agent' },
      });

      expect(services.listSites).toHaveBeenCalledWith(
        expect.objectContaining({ principalId: 'agent-uuid', principalType: 'agent' }),
      );
    });

    // ---------------------------------------------------------------------
    // PCC-3190: agent + acting-user must intersect listSites by user role
    // so that an authenticated Google user only sees the sites where BOTH
    // the calling agent AND the acting user have roles. This prevents the
    // backend from leaking the full agent's site list when an agent acts
    // on behalf of a user that has no access to those sites.
    // ---------------------------------------------------------------------
    describe('GET /api/sites — agent acting on behalf of a user (PCC-3190)', () => {
      it('should return empty result and not call listSites when acting user is not in app.users allowlist', async () => {
        const { handleSiteRoutes } = await import('../../src/routes/site-api');
        const services = await import('../../src/services');
        const db = await import('../../src/db');

        // Acting-user lookup returns no row -> user is not in the allowlist
        vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

        const request = new Request('https://api.example.com/api/sites', {
          method: 'GET',
        });

        const response = await handleSiteRoutes(request, {
          principal: {
            id: 'agent-uuid',
            type: 'agent',
            actingUserEmail: 'unknown-user@example.com',
            actingUserId: 'acting-user-uuid',
          },
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.sites).toEqual([]);
        // listSites must NOT be called when the acting user is unknown -- otherwise
        // we would leak the agent's full site list.
        expect(services.listSites).not.toHaveBeenCalled();
      });

      it('should pass actingUserId to listSites when acting user is in the allowlist', async () => {
        const { handleSiteRoutes } = await import('../../src/routes/site-api');
        const services = await import('../../src/services');
        const db = await import('../../src/db');

        // Acting-user lookup returns a row -> user is in the allowlist
        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [{ id: 'db-acting-user-id' }],
        });
        vi.mocked(services.listSites).mockResolvedValueOnce([]);

        const request = new Request('https://api.example.com/api/sites', {
          method: 'GET',
        });

        await handleSiteRoutes(request, {
          principal: {
            id: 'agent-uuid',
            type: 'agent',
            actingUserEmail: 'known-user@example.com',
            actingUserId: 'provider-acting-user-id',
          },
        });

        expect(services.listSites).toHaveBeenCalledWith(
          expect.objectContaining({
            principalId: 'agent-uuid',
            principalType: 'agent',
            actingUserId: 'db-acting-user-id',
          }),
        );
      });

      it('should lowercase the acting user email when looking up the allowlist', async () => {
        const { handleSiteRoutes } = await import('../../src/routes/site-api');
        const db = await import('../../src/db');
        const services = await import('../../src/services');

        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [{ id: 'db-acting-user-id' }],
        });
        vi.mocked(services.listSites).mockResolvedValueOnce([]);

        const request = new Request('https://api.example.com/api/sites', {
          method: 'GET',
        });

        await handleSiteRoutes(request, {
          principal: {
            id: 'agent-uuid',
            type: 'agent',
            actingUserEmail: 'Known-User@Example.com',
            actingUserId: 'provider-acting-user-id',
          },
        });

        // The lookup must use the lowercased email so it matches the storage
        // convention used elsewhere in the codebase (see app.users.email).
        const queryCall = vi.mocked(db.query).mock.calls[0];
        expect(queryCall[1]).toContain('known-user@example.com');
      });

      it('should NOT add actingUserId for agent without actingUserEmail (legacy direct agent traffic)', async () => {
        const { handleSiteRoutes } = await import('../../src/routes/site-api');
        const services = await import('../../src/services');
        const db = await import('../../src/db');

        vi.mocked(services.listSites).mockResolvedValueOnce([]);

        const request = new Request('https://api.example.com/api/sites', {
          method: 'GET',
        });

        await handleSiteRoutes(request, {
          principal: { id: 'agent-uuid', type: 'agent' },
        });

        // Behavior unchanged for legacy agent calls: no email lookup happens
        // and listSites is called without actingUserId.
        expect(db.query).not.toHaveBeenCalled();
        const listCall = vi.mocked(services.listSites).mock.calls[0][0];
        expect(listCall.actingUserId).toBeUndefined();
      });

      it('should NOT add actingUserId for user principals', async () => {
        const { handleSiteRoutes } = await import('../../src/routes/site-api');
        const services = await import('../../src/services');
        const db = await import('../../src/db');

        vi.mocked(services.listSites).mockResolvedValueOnce([]);

        const request = new Request('https://api.example.com/api/sites', {
          method: 'GET',
        });

        await handleSiteRoutes(request, {
          principal: {
            id: 'user-1',
            type: 'user',
            email: 'user@example.com',
          },
        });

        // User principals never carry the acting-user concept; no email lookup
        // should occur and listSites should be called without actingUserId.
        expect(db.query).not.toHaveBeenCalled();
        const listCall = vi.mocked(services.listSites).mock.calls[0][0];
        expect(listCall.actingUserId).toBeUndefined();
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
        allowedOrigins: [],
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

    it('includes the caller site-level role', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');
      const authorization = await import('../../src/auth/authorization');

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
      vi.mocked(authorization.getSiteRole).mockResolvedValueOnce('EDITOR');
      vi.mocked(services.getSite).mockResolvedValueOnce({
        id: 'site-1',
        pantheonSiteId: 'pantheon-1',
        name: 'Marketing Website',
        allowedOrigins: [],
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
      expect(body.role).toBe('EDITOR');
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
        allowedOrigins: [],
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
        allowedOrigins: [],
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
      vi.mocked(services.archiveSite).mockResolvedValueOnce(true);

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
        allowedOrigins: [],
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
      vi.mocked(services.archiveSite).mockResolvedValueOnce(true);

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

  // ===========================================================================
  // T64, T65, T66: allowedOrigins field — API round-trip
  // ===========================================================================

  describe('allowedOrigins field', () => {
    // T64: GET /api/sites/:siteId response body includes allowedOrigins field
    it('T64: GET /api/sites/:siteId response includes allowedOrigins', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      // Reset specific mocks to drain any leftover queued values from prior tests
      // (vi.clearAllMocks in beforeEach clears call history but not queued mockResolvedValueOnce values)
      vi.mocked(services.getMainBranch).mockReset();
      vi.mocked(services.getSite).mockReset();

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-123',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getSite).mockResolvedValueOnce({
        id: 'site-123',
        pantheonSiteId: 'pantheon-site-123',
        name: 'Test Site',
        allowedOrigins: ['https://mysite.com'],
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
        'https://api.example.com/api/sites/site-123',
        { method: 'GET' },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'site-123',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect((body as { allowedOrigins: string[] }).allowedOrigins).toEqual(['https://mysite.com']);
    });

    // T65: POST /api/sites and PATCH /api/sites/:siteId pass allowedOrigins to service layer
    it('T65: POST /api/sites passes allowedOrigins to createSite', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.createSite).mockResolvedValueOnce({
        id: 'site-new',
        pantheonSiteId: 'site-abc-123',
        name: 'New Site',
        allowedOrigins: ['https://newsite.com'],
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
      vi.mocked(services.createMainBranch).mockResolvedValueOnce({
        id: 'branch-main-uuid',
        siteId: 'site-new',
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
          name: 'New Site',
          allowedOrigins: ['https://newsite.com'],
        }),
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      expect(services.createSite).toHaveBeenCalledWith(
        expect.objectContaining({ allowedOrigins: ['https://newsite.com'] }),
        undefined,
      );
    });

    it('T65b: PATCH /api/sites/:siteId passes allowedOrigins to updateSite', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      // Reset specific mocks to drain any leftover queued values from prior tests
      vi.mocked(services.getMainBranch).mockReset();
      vi.mocked(services.updateSite).mockReset();

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
        name: 'Site Name',
        allowedOrigins: ['https://updated.com'],
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
            allowedOrigins: ['https://updated.com'],
          }),
        },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.updateSite).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ allowedOrigins: ['https://updated.com'] }),
        undefined,
      );
    });

    // T66: POST /api/sites without allowedOrigins calls createSite with allowedOrigins: [] or undefined
    it('T66: POST /api/sites without allowedOrigins field passes undefined to createSite', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.createSite).mockResolvedValueOnce({
        id: 'site-new',
        pantheonSiteId: 'site-abc-456',
        name: 'New Site',
        allowedOrigins: [],
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
      vi.mocked(services.createMainBranch).mockResolvedValueOnce({
        id: 'branch-main-uuid',
        siteId: 'site-new',
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
          pantheonSiteId: 'site-abc-456',
          name: 'New Site',
          // No allowedOrigins field
        }),
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      // The service layer should be called with allowedOrigins: undefined (body field absent)
      // The service layer then defaults it to []. Either undefined or [] is acceptable.
      const createSiteCall = vi.mocked(services.createSite).mock.calls[0][0];
      const allowedOriginsValue = createSiteCall.allowedOrigins;
      expect(allowedOriginsValue === undefined || allowedOriginsValue.length === 0).toBe(true);
    });

    it('POST /api/sites passes url to createSite', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.createSite).mockResolvedValueOnce({
        id: 'site-new',
        pantheonSiteId: 'site-abc-789',
        name: 'New Site',
        allowedOrigins: [],
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
      vi.mocked(services.createMainBranch).mockResolvedValueOnce({
        id: 'branch-main-uuid',
        siteId: 'site-new',
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
          pantheonSiteId: 'site-abc-789',
          name: 'New Site',
          url: 'https://newsite.example.com',
        }),
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      expect(services.createSite).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://newsite.example.com' }),
        undefined,
      );
    });

    it('PATCH /api/sites/:siteId passes url to updateSite', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockReset();
      vi.mocked(services.updateSite).mockReset();

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
        name: 'Site Name',
        allowedOrigins: [],
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
            url: 'https://updated.example.com',
          }),
        },
      );

      const response = await handleSiteRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.updateSite).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ url: 'https://updated.example.com' }),
        undefined,
      );
    });

    it('POST /api/sites returns 400 when url is malformed', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.createSite).mockRejectedValueOnce(
        new (await import('../../src/services')).InvalidSiteParamsError('url is invalid'),
      );

      const request = new Request('https://api.example.com/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pantheonSiteId: 'site-abc-bad',
          name: 'Bad URL Site',
          url: 'not a url',
        }),
      });

      const response = await handleSiteRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
    });
  });

  // ===========================================================================
  // PCC-3211: Soft delete — DELETE → archive, POST restore, GET ?archived
  // ===========================================================================

  describe('DELETE /api/sites/{siteId} — soft delete (PCC-3211)', () => {
    it('should archive the site (call archiveSite) and return 204', async () => {
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
      vi.mocked(services.listBranches).mockResolvedValueOnce([]);
      vi.mocked(services.archiveSite).mockResolvedValueOnce(true);

      const response = await handleSiteRoutes(
        new Request('https://api.example.com/api/sites/site-1', { method: 'DELETE' }),
        { siteId: 'site-1', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(204);
      expect(services.archiveSite).toHaveBeenCalledWith('site-1');
    });

    it('should return 404 when site not found (getMainBranch returns null)', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(null);

      const response = await handleSiteRoutes(
        new Request('https://api.example.com/api/sites/nonexistent', { method: 'DELETE' }),
        { siteId: 'nonexistent', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(404);
    });

    it('should return 409 when site is already archived (archiveSite returns already_archived)', async () => {
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
      vi.mocked(services.listBranches).mockResolvedValueOnce([]);
      vi.mocked(services.archiveSite).mockResolvedValueOnce('already_archived');

      const response = await handleSiteRoutes(
        new Request('https://api.example.com/api/sites/site-1', { method: 'DELETE' }),
        { siteId: 'site-1', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(409);
    });
  });

  describe('POST /api/sites/{siteId}/restore (PCC-3211)', () => {
    const mockMainBranch = {
      id: 'main-branch-id',
      siteId: 'site-1',
      name: 'main',
      isMain: true,
      status: 'active' as const,
      createdAt: '2026-01-24T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user' as const,
    };

    it('should restore an archived site and return 200 with site JSON', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      const restoredSite = {
        id: 'site-1',
        pantheonSiteId: 'psite-1',
        name: 'Restored Site',
        workflowSettings: {
          mergeApprovalMode: 'optional',
          minApprovers: 1,
          allowSelfApproval: true,
          approverMode: 'both',
          approverMinRole: 'EDITOR',
        },
        allowedOrigins: [],
        createdAt: '2026-01-24T10:00:00.000Z',
        updatedAt: '2026-05-17T10:00:00.000Z',
        archivedAt: null,
      };
      vi.mocked(services.getMainBranch).mockResolvedValueOnce(mockMainBranch);
      vi.mocked(services.restoreSite).mockResolvedValueOnce(restoredSite);

      const response = await handleSiteRoutes(
        new Request('https://api.example.com/api/sites/site-1/restore', { method: 'POST' }),
        { siteId: 'site-1', action: 'restore', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('site-1');
    });

    it('should return 404 when site not found (getMainBranch returns null)', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(null);

      const response = await handleSiteRoutes(
        new Request('https://api.example.com/api/sites/nonexistent/restore', { method: 'POST' }),
        { siteId: 'nonexistent', action: 'restore', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(404);
    });

    it('should return 404 when restoreSite returns null (not found or not archived)', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({ ...mockMainBranch, siteId: 'active-site' });
      vi.mocked(services.restoreSite).mockResolvedValueOnce(null);

      const response = await handleSiteRoutes(
        new Request('https://api.example.com/api/sites/active-site/restore', { method: 'POST' }),
        { siteId: 'active-site', action: 'restore', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/sites?archived=true (PCC-3211)', () => {
    it('should pass archived=true to listSites', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockResolvedValueOnce([]);

      await handleSiteRoutes(
        new Request('https://api.example.com/api/sites?archived=true'),
        { principal: { id: 'user-1', type: 'user' } },
      );

      expect(services.listSites).toHaveBeenCalledWith(
        expect.objectContaining({ archived: true }),
      );
    });

    it('should pass archived=false when ?archived=false', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockResolvedValueOnce([]);

      await handleSiteRoutes(
        new Request('https://api.example.com/api/sites?archived=false'),
        { principal: { id: 'user-1', type: 'user' } },
      );

      expect(services.listSites).toHaveBeenCalledWith(
        expect.objectContaining({ archived: false }),
      );
    });

    it('should not pass archived param when query param is absent (default excludes archived)', async () => {
      const { handleSiteRoutes } = await import('../../src/routes/site-api');
      const services = await import('../../src/services');

      vi.mocked(services.listSites).mockResolvedValueOnce([]);

      await handleSiteRoutes(
        new Request('https://api.example.com/api/sites'),
        { principal: { id: 'user-1', type: 'user' } },
      );

      expect(services.listSites).toHaveBeenCalledWith(
        expect.not.objectContaining({ archived: true }),
      );
    });
  });
});
