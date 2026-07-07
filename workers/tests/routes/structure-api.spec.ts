/**
 * Phase 7.1.1b: Structure API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for structure operations.
 * Structures are branch-scoped for consistency with documents.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  createStructure: vi.fn(),
  getBranch: vi.fn().mockResolvedValue({ id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true }),
  getBranchStructure: vi.fn(),
  getBranchStructureBySlug: vi.fn(),
  listBranchStructures: vi.fn(),
  updateBranchStructure: vi.fn(),
  deleteBranchStructure: vi.fn(),
  getStructureAtCheckpoint: vi.fn(),
  getCheckpoint: vi.fn(),
  BranchNotFoundError: class BranchNotFoundError extends Error {
    override name = 'BranchNotFoundError';
    constructor(public branchId: string) {
      super(`Branch not found: ${branchId}`);
    }
  },
  StructureNotFoundError: class StructureNotFoundError extends Error {
    override name = 'StructureNotFoundError';
    constructor(public structureId: string) {
      super(`Structure not found: ${structureId}`);
    }
  },
  DuplicateStructureSlugError: class DuplicateStructureSlugError extends Error {
    override name = 'DuplicateStructureSlugError';
    constructor(public slug: string) {
      super(`Structure with slug "${slug}" already exists`);
    }
  },
  CheckpointNotFoundError: class CheckpointNotFoundError extends Error {
    override name = 'CheckpointNotFoundError';
    constructor(public checkpointId: string) {
      super(`Checkpoint not found: ${checkpointId}`);
    }
  },
  InvalidSlugError: class InvalidSlugError extends Error {
    override name = 'InvalidSlugError';
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

describe('Phase 7.1.1b: Structure API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/branches/{branchId}/structures - Create Structure
  // ===========================================================================

  describe('POST /api/sites/{siteId}/branches/{branchId}/structures', () => {
    it('should create a new structure', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.createStructure).mockResolvedValueOnce({
        id: 'structure-uuid',
        siteId: 'site-1',
        name: 'Main Navigation',
        slug: 'main-nav',
        description: 'Primary site navigation',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Main Navigation',
            slug: 'main-nav',
            description: 'Primary site navigation',
            structureType: 'hierarchy',
          }),
        },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('structure-uuid');
      expect(body.name).toBe('Main Navigation');
      expect(body.slug).toBe('main-nav');
    });

    it('should return 400 for missing name', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: 'main-nav',
          }),
        },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('name');
    });

    it('should return 409 for duplicate slug', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.createStructure).mockRejectedValueOnce(
        new services.DuplicateStructureSlugError('main-nav'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Main Navigation',
            slug: 'main-nav',
          }),
        },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(409);
    });

    it('should return 400 for invalid slug on create', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.createStructure).mockRejectedValueOnce(
        new services.InvalidSlugError('slug "my section" contains invalid characters; only letters, numbers, hyphens, underscores, and dots are allowed'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'My Section',
            slug: 'my section',
          }),
        },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('invalid characters');
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/branches/{branchId}/structures - List Structures
  // ===========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}/structures', () => {
    it('should list structures on branch', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.listBranchStructures).mockResolvedValueOnce([
        {
          id: 'struct-1',
          siteId: 'site-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
          createdAt: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'struct-2',
          siteId: 'site-1',
          name: 'Blog',
          slug: 'blog',
          structureType: 'collection',
          createdAt: '2026-01-24T11:00:00.000Z',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.structures).toHaveLength(2);
    });

    it('should filter by structure type', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.listBranchStructures).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures?type=hierarchy',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.listBranchStructures).toHaveBeenCalledWith(
        'branch-1',
        expect.objectContaining({ structureType: 'hierarchy' }),
      );
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId} - Get
  // ===========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}', () => {
    it('should return structure details', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Navigation',
        slug: 'main-nav',
        description: 'Primary navigation',
        structureType: 'hierarchy',
        metadataSchema: { type: 'object' },
        schemaEnforcement: 'warn',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('struct-1');
      expect(body.name).toBe('Main Navigation');
    });

    it('should return 404 for non-existent structure', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/nonexistent',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // PATCH /api/sites/{siteId}/branches/{branchId}/structures/{structureId}
  // ===========================================================================

  describe('PATCH /api/sites/{siteId}/branches/{branchId}/structures/{structureId}', () => {
    it('should update structure name and slug', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.updateBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'stuff-i-write',
        slug: 'stuff-i-write',
        description: 'My blog posts',
        structureType: 'collection',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'stuff-i-write',
            slug: 'stuff-i-write',
            description: 'My blog posts',
          }),
        },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.name).toBe('stuff-i-write');
      expect(body.slug).toBe('stuff-i-write');
    });

    it('should return 404 for non-existent structure', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.updateBranchStructure).mockRejectedValueOnce(
        new services.StructureNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/nonexistent',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Updated Name',
          }),
        },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });

    it('should return 409 for duplicate slug', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.updateBranchStructure).mockRejectedValueOnce(
        new services.DuplicateStructureSlugError('existing-slug'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: 'existing-slug',
          }),
        },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(409);
    });

    it('should return 400 for invalid slug on update', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.updateBranchStructure).mockRejectedValueOnce(
        new services.InvalidSlugError('slug "a/b" contains invalid characters; only letters, numbers, hyphens, underscores, and dots are allowed'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: 'a/b',
          }),
        },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('invalid characters');
    });
  });

  // ===========================================================================
  // DELETE /api/sites/{siteId}/branches/{branchId}/structures/{structureId}
  // ===========================================================================

  describe('DELETE /api/sites/{siteId}/branches/{branchId}/structures/{structureId}', () => {
    it('should delete a structure from branch', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.deleteBranchStructure).mockResolvedValueOnce(undefined);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1',
        { method: 'DELETE' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 for non-existent structure', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.deleteBranchStructure).mockRejectedValueOnce(
        new services.StructureNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/nonexistent',
        { method: 'DELETE' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/checkpoints/{checkpointId}/structures/{structureId}
  // ===========================================================================

  describe('GET /api/sites/{siteId}/checkpoints/{checkpointId}/structures/{structureId}', () => {
    it('should return structure at checkpoint', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getStructureAtCheckpoint).mockResolvedValueOnce({
        checkpointId: 'checkpoint-1',
        structureId: 'struct-1',
        name: 'blogs',
        slug: 'blogs',
        structureType: 'collection',
        structureTree: [{ id: 'node-1' }],
        metadataSchema: { type: 'object' },
        schemaEnforcement: 'warn',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/checkpoints/checkpoint-1/structures/struct-1',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        checkpointId: 'checkpoint-1',
        structureId: 'struct-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.name).toBe('blogs');
      expect(body.structureTree).toHaveLength(1);
    });

    it('should return 404 for structure not in checkpoint', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getStructureAtCheckpoint).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/checkpoints/checkpoint-1/structures/nonexistent',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        checkpointId: 'checkpoint-1',
        structureId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 404 for non-existent branch', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.listBranchStructures).mockRejectedValueOnce(
        new services.BranchNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/nonexistent/structures',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });

    it('should return 405 for unsupported methods', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        { method: 'PUT' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(405);
    });

    it('should handle service errors gracefully', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.listBranchStructures).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
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

    it('should check canView permission for GET list structures', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.listBranchStructures).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        { method: 'GET' },
      );

      await handleStructureRoutes(request, {
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

    it('should check canEdit permission for POST create structure', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.createStructure).mockResolvedValueOnce({
        id: 'structure-uuid',
        siteId: 'site-1',
        name: 'Main Navigation',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Main Navigation',
          }),
        },
      );

      await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canEdit',
      );
    });

    it('should return 403 when principal lacks permission', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const { assertPermission, AuthorizationError } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(assertPermission).mockRejectedValueOnce(
        new AuthorizationError(
          'Missing permission: canView',
          'canView',
          'viewer',
        ),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
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
    it('rejects structure creation when branch belongs to a different site', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-from-other-site',
        siteId: 'site-OTHER',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-from-other-site/structures',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Navigation', slug: 'nav' }),
        },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-from-other-site',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
      expect(services.createStructure).not.toHaveBeenCalled();
    });

    it('rejects structure listing when branch belongs to a different site', async () => {
      const { handleStructureRoutes } = await import(
        '../../src/routes/structure-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-from-other-site',
        siteId: 'site-OTHER',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-from-other-site/structures',
        { method: 'GET' },
      );

      const response = await handleStructureRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-from-other-site',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
      expect(services.listBranchStructures).not.toHaveBeenCalled();
    });
  });
});
