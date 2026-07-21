/**
 * Agent Politeness System - Phase 1.5: Organization API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for organization operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  createOrganization: vi.fn(),
  getOrganizationById: vi.fn(),
  updateOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
  archiveOrganization: vi.fn(),
  restoreOrganization: vi.fn(),
  listOrganizations: vi.fn(),
  linkSiteToOrganization: vi.fn(),
  unlinkSiteFromOrganization: vi.fn(),
  getSitesByOrganization: vi.fn(),
  InvalidOrganizationParamsError: class InvalidOrganizationParamsError extends Error {
    override name = 'InvalidOrganizationParamsError';
  },
  OrganizationHasSitesError: class OrganizationHasSitesError extends Error {
    override name = 'OrganizationHasSitesError';
    constructor(public organizationId: string) {
      super(`Cannot delete organization "${organizationId}" because it has linked sites.`);
    }
  },
  OrganizationNotFoundError: class OrganizationNotFoundError extends Error {
    override name = 'OrganizationNotFoundError';
    constructor(public organizationId: string) {
      super(`Organization "${organizationId}" not found.`);
    }
  },
}));

describe('Agent Politeness Phase 1.5: Organization API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // Helper to create mock organization
  function createMockOrganization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'org-uuid-123',
      name: 'Test Organization',
      settings: { agentIdleTimeoutMs: 5000 },
      createdAt: '2026-01-26T12:00:00.000Z',
      updatedAt: '2026-01-26T12:00:00.000Z',
      ...overrides,
    };
  }

  // ===========================================================================
  // POST /api/organizations - Create Organization
  // ===========================================================================

  describe('POST /api/organizations', () => {
    it('should create a new organization', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.createOrganization).mockResolvedValueOnce(createMockOrganization());

      const request = new Request('https://api.example.com/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Organization',
        }),
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('org-uuid-123');
      expect(body.name).toBe('Test Organization');
    });

    it('should create organization with custom settings', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.createOrganization).mockResolvedValueOnce(
        createMockOrganization({ settings: { agentIdleTimeoutMs: 10000 } }),
      );

      const request = new Request('https://api.example.com/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Custom Org',
          settings: { agentIdleTimeoutMs: 10000 },
        }),
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.settings.agentIdleTimeoutMs).toBe(10000);
    });

    it('should return 400 for missing name', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');

      const request = new Request('https://api.example.com/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('name');
    });

    it('should return 400 for empty name', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.createOrganization).mockRejectedValueOnce(
        new services.InvalidOrganizationParamsError('Organization name cannot be empty.'),
      );

      const request = new Request('https://api.example.com/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
    });
  });

  // ===========================================================================
  // GET /api/organizations - List Organizations
  // ===========================================================================

  describe('GET /api/organizations', () => {
    it('should list all organizations', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.listOrganizations).mockResolvedValueOnce([
        createMockOrganization({ id: 'org-1', name: 'Org One' }),
        createMockOrganization({ id: 'org-2', name: 'Org Two' }),
      ]);

      const request = new Request('https://api.example.com/api/organizations', {
        method: 'GET',
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.organizations).toHaveLength(2);
    });

    it('should support pagination', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.listOrganizations).mockResolvedValueOnce([
        createMockOrganization({ id: 'org-2', name: 'Org Two' }),
      ]);

      const request = new Request('https://api.example.com/api/organizations?limit=1&offset=1', {
        method: 'GET',
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.listOrganizations).toHaveBeenCalledWith({ limit: 1, offset: 1 });
    });
  });

  // ===========================================================================
  // GET /api/organizations/{organizationId} - Get Organization
  // ===========================================================================

  describe('GET /api/organizations/{organizationId}', () => {
    it('should return organization by ID', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce(createMockOrganization());

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123', {
        method: 'GET',
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('org-uuid-123');
    });

    it('should return 404 for non-existent organization', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce(null);

      const request = new Request('https://api.example.com/api/organizations/non-existent', {
        method: 'GET',
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'non-existent',
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // PATCH /api/organizations/{organizationId} - Update Organization
  // ===========================================================================

  describe('PATCH /api/organizations/{organizationId}', () => {
    it('should update organization name', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.updateOrganization).mockResolvedValueOnce(
        createMockOrganization({ name: 'Updated Name' }),
      );

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.name).toBe('Updated Name');
    });

    it('should update organization settings', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.updateOrganization).mockResolvedValueOnce(
        createMockOrganization({ settings: { agentIdleTimeoutMs: 15000 } }),
      );

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { agentIdleTimeoutMs: 15000 } }),
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.settings.agentIdleTimeoutMs).toBe(15000);
    });

    it('should return 404 for non-existent organization', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.updateOrganization).mockResolvedValueOnce(null);

      const request = new Request('https://api.example.com/api/organizations/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'non-existent',
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // DELETE /api/organizations/{organizationId} - Delete Organization
  // ===========================================================================

  describe('DELETE /api/organizations/{organizationId}', () => {
    it('should archive organization (soft delete)', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveOrganization).mockResolvedValueOnce(true);

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123', {
        method: 'DELETE',
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 for non-existent organization', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveOrganization).mockResolvedValueOnce(false);

      const request = new Request('https://api.example.com/api/organizations/non-existent', {
        method: 'DELETE',
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'non-existent',
      });

      expect(response.status).toBe(404);
    });

    it('should return 409 when organization has active sites', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveOrganization).mockRejectedValueOnce(
        new services.OrganizationHasSitesError('org-uuid-123'),
      );

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123', {
        method: 'DELETE',
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toContain('linked sites');
    });
  });

  // ===========================================================================
  // GET /api/organizations/{organizationId}/sites - Get Organization Sites
  // ===========================================================================

  describe('GET /api/organizations/{organizationId}/sites', () => {
    it('should return sites for organization', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.getSitesByOrganization).mockResolvedValueOnce([
        {
          id: 'site-1',
          pantheonSiteId: 'ps-1',
          name: 'Site One',
          organizationId: 'org-uuid-123',
          workflowSettings: { mergeApprovalMode: 'optional' },
          createdAt: '2026-01-26T12:00:00.000Z',
          updatedAt: '2026-01-26T12:00:00.000Z',
        },
      ]);

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123/sites', {
        method: 'GET',
      });

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        subResource: 'sites',
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.sites).toHaveLength(1);
      expect(body.sites[0].name).toBe('Site One');
    });
  });

  // ===========================================================================
  // POST /api/organizations/{organizationId}/sites/{siteId} - Link Site
  // ===========================================================================

  describe('POST /api/organizations/{organizationId}/sites/{siteId}', () => {
    it('should link site to organization', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.linkSiteToOrganization).mockResolvedValueOnce(true);

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/sites/site-uuid-456',
        { method: 'POST' },
      );

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        subResource: 'sites',
        subResourceId: 'site-uuid-456',
      });

      expect(response.status).toBe(200);
    });

    it('should return 404 when site not found', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.linkSiteToOrganization).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/sites/non-existent',
        { method: 'POST' },
      );

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        subResource: 'sites',
        subResourceId: 'non-existent',
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // DELETE /api/organizations/{organizationId}/sites/{siteId} - Unlink Site
  // ===========================================================================

  describe('DELETE /api/organizations/{organizationId}/sites/{siteId}', () => {
    it('should unlink site from organization', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.unlinkSiteFromOrganization).mockResolvedValueOnce(true);

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/sites/site-uuid-456',
        { method: 'DELETE' },
      );

      const response = await handleOrganizationRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        subResource: 'sites',
        subResourceId: 'site-uuid-456',
      });

      expect(response.status).toBe(204);
    });
  });

  // ===========================================================================
  // PCC-3211: Soft delete — DELETE → archive, POST restore, GET ?archived
  // ===========================================================================

  describe('DELETE /api/organizations/{organizationId} — soft delete (PCC-3211)', () => {
    it('should archive the organization and return 204', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveOrganization).mockResolvedValueOnce(true);

      const response = await handleOrganizationRoutes(
        new Request('https://api.example.com/api/organizations/org-123', { method: 'DELETE' }),
        { principal: { id: 'user-1', type: 'user' }, organizationId: 'org-123' },
      );

      expect(response.status).toBe(204);
      expect(services.archiveOrganization).toHaveBeenCalledWith('org-123');
    });

    it('should return 404 when archiveOrganization returns false', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveOrganization).mockResolvedValueOnce(false);

      const response = await handleOrganizationRoutes(
        new Request('https://api.example.com/api/organizations/nonexistent', { method: 'DELETE' }),
        { principal: { id: 'user-1', type: 'user' }, organizationId: 'nonexistent' },
      );

      expect(response.status).toBe(404);
    });

    it('should return 409 when org is already archived', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveOrganization).mockResolvedValueOnce('already_archived');

      const response = await handleOrganizationRoutes(
        new Request('https://api.example.com/api/organizations/org-123', { method: 'DELETE' }),
        { principal: { id: 'user-1', type: 'user' }, organizationId: 'org-123' },
      );

      expect(response.status).toBe(409);
    });

    it('should return 409 when org has active sites', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveOrganization).mockRejectedValueOnce(
        new services.OrganizationHasSitesError('org-123'),
      );

      const response = await handleOrganizationRoutes(
        new Request('https://api.example.com/api/organizations/org-123', { method: 'DELETE' }),
        { principal: { id: 'user-1', type: 'user' }, organizationId: 'org-123' },
      );

      expect(response.status).toBe(409);
    });
  });

  describe('POST /api/organizations/{organizationId}/restore (PCC-3211)', () => {
    it('should restore an archived organization and return 200', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.restoreOrganization).mockResolvedValueOnce(true);

      const response = await handleOrganizationRoutes(
        new Request('https://api.example.com/api/organizations/org-123/restore', { method: 'POST' }),
        { principal: { id: 'user-1', type: 'user' }, organizationId: 'org-123', action: 'restore' },
      );

      expect(response.status).toBe(200);
    });

    it('should return 404 when restoreOrganization returns false', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.restoreOrganization).mockResolvedValueOnce(false);

      const response = await handleOrganizationRoutes(
        new Request('https://api.example.com/api/organizations/nonexistent/restore', { method: 'POST' }),
        { principal: { id: 'user-1', type: 'user' }, organizationId: 'nonexistent', action: 'restore' },
      );

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/organizations?archived=true (PCC-3211)', () => {
    it('should pass archived=true to listOrganizations', async () => {
      const { handleOrganizationRoutes } = await import('../../src/routes/organization-api');
      const services = await import('../../src/services');

      vi.mocked(services.listOrganizations).mockResolvedValueOnce([]);

      await handleOrganizationRoutes(
        new Request('https://api.example.com/api/organizations?archived=true'),
        { principal: { id: 'user-1', type: 'user' } },
      );

      expect(services.listOrganizations).toHaveBeenCalledWith(
        expect.objectContaining({ archived: true }),
      );
    });
  });
});
