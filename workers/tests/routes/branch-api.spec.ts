/**
 * Phase 7.1a: Branch API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for branch operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  createBranch: vi.fn(),
  getBranch: vi.fn(),
  getMainBranch: vi.fn(),
  listBranches: vi.fn(),
  updateBranch: vi.fn(),
  updateBranchStatus: vi.fn(),
  deleteBranch: vi.fn(),
  getLatestCheckpoint: vi.fn(),
  createCheckpoint: vi.fn(),
  BranchNotFoundError: class BranchNotFoundError extends Error {
    name = 'BranchNotFoundError';
    constructor(public branchId: string) {
      super(`Branch not found: ${branchId}`);
    }
  },
  SiteNotFoundError: class SiteNotFoundError extends Error {
    name = 'SiteNotFoundError';
    constructor(public siteId: string) {
      super(`Site not found: ${siteId}`);
    }
  },
  DuplicateBranchNameError: class DuplicateBranchNameError extends Error {
    name = 'DuplicateBranchNameError';
    constructor(
      public siteId: string,
      public name: string,
    ) {
      super(`Branch name already exists: ${name}`);
    }
  },
}));

// Mock authorization
vi.mock('../../src/auth/middleware', () => ({
  requirePermission: vi.fn(() => vi.fn()),
}));

describe('Phase 7.1a: Branch API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/branches - Create Branch
  // ===========================================================================

  describe('POST /api/sites/{siteId}/branches', () => {
    it('should create a new branch', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
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

      vi.mocked(services.getLatestCheckpoint).mockResolvedValueOnce({
        id: 'checkpoint-1',
        branchId: 'main-branch-id',
        name: 'Latest',
        type: 'manual',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.createBranch).mockResolvedValueOnce({
        id: 'new-branch-id',
        siteId: 'site-1',
        name: 'feature-branch',
        description: 'A new feature',
        isMain: false,
        status: 'active',
        sourceBranchId: 'main-branch-id',
        createdFromCheckpointId: 'checkpoint-1',
        createdAt: '2026-01-24T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'feature-branch',
            description: 'A new feature',
            sourceBranch: 'main',
          }),
        },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('new-branch-id');
      expect(body.name).toBe('feature-branch');
    });

    it('should return 400 for missing branch name', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: 'A new feature',
          }),
        },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('name');
    });

    it('should create a branch using parentBranchId instead of sourceBranch', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      // When parentBranchId is provided, getBranch is called (not getMainBranch)
      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getLatestCheckpoint).mockResolvedValueOnce({
        id: 'checkpoint-1',
        branchId: 'main-branch-id',
        name: 'Latest',
        type: 'manual',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.createBranch).mockResolvedValueOnce({
        id: 'new-branch-id',
        siteId: 'site-1',
        name: 'feature-branch',
        isMain: false,
        status: 'active',
        parentBranchId: 'main-branch-id',
        createdFromCheckpointId: 'checkpoint-1',
        createdAt: '2026-01-24T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Send parentBranchId (UUID) instead of sourceBranch (name)
      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'feature-branch',
            parentBranchId: 'main-branch-id',
          }),
        },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('new-branch-id');
      expect(services.createBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceBranchId: 'main-branch-id',
        }),
      );
    });

    it('should create a branch from a non-main branch using parentBranchId', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      // Parent branch is a feature branch, not main
      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'feature-branch-id',
        siteId: 'site-1',
        name: 'feature-1',
        isMain: false,
        status: 'active',
        parentBranchId: 'main-branch-id',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getLatestCheckpoint).mockResolvedValueOnce({
        id: 'checkpoint-2',
        branchId: 'feature-branch-id',
        name: 'Latest on feature',
        type: 'manual',
        createdAt: '2026-01-24T10:30:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.createBranch).mockResolvedValueOnce({
        id: 'sub-feature-id',
        siteId: 'site-1',
        name: 'sub-feature',
        isMain: false,
        status: 'active',
        parentBranchId: 'feature-branch-id',
        createdFromCheckpointId: 'checkpoint-2',
        createdAt: '2026-01-24T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'sub-feature',
            parentBranchId: 'feature-branch-id',
          }),
        },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('sub-feature-id');
      expect(body.parentBranchId).toBe('feature-branch-id');
      // Verify createBranch was called with the correct source branch ID
      expect(services.createBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceBranchId: 'feature-branch-id',
          sourceCheckpointId: 'checkpoint-2',
        }),
      );
    });

    it('should return 404 when parentBranchId does not exist', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      // Parent branch not found
      vi.mocked(services.getBranch).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'new-branch',
            parentBranchId: 'nonexistent-branch-id',
          }),
        },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('Parent branch not found');
    });

    it('should return 409 for duplicate branch name', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
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

      vi.mocked(services.getLatestCheckpoint).mockResolvedValueOnce({
        id: 'checkpoint-1',
        branchId: 'main-branch-id',
        name: 'Latest',
        type: 'manual',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.createBranch).mockRejectedValueOnce(
        new services.DuplicateBranchNameError('site-1', 'existing-branch'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'existing-branch',
            sourceBranch: 'main',
          }),
        },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(409);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/branches - List Branches
  // ===========================================================================

  describe('GET /api/sites/{siteId}/branches', () => {
    it('should list all branches for a site', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

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
          name: 'feature',
          isMain: false,
          status: 'active',
          createdAt: '2026-01-24T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches',
        { method: 'GET' },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.branches).toHaveLength(2);
      expect(body.branches[0].name).toBe('main');
    });

    it('should filter branches by status', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

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
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches?status=active',
        { method: 'GET' },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.listBranches).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ status: 'active' }),
      );
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/branches/{branchId} - Get Branch
  // ===========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}', () => {
    it('should return branch details', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'feature-branch',
        description: 'A feature branch',
        isMain: false,
        status: 'active',
        sourceBranchId: 'main-branch-id',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1',
        { method: 'GET' },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('branch-1');
      expect(body.name).toBe('feature-branch');
    });

    it('should return 404 for non-existent branch', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/nonexistent',
        { method: 'GET' },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        branchId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // PATCH /api/sites/{siteId}/branches/{branchId} - Update Branch
  // ===========================================================================

  describe('PATCH /api/sites/{siteId}/branches/{branchId}', () => {
    it('should update branch details', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.updateBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'updated-name',
        description: 'Updated description',
        isMain: false,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'updated-name',
            description: 'Updated description',
          }),
        },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.name).toBe('updated-name');
    });

    it('should update branch status', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.updateBranchStatus).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'feature-branch',
        isMain: false,
        status: 'review',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'review',
          }),
        },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('review');
    });
  });

  // ===========================================================================
  // DELETE /api/sites/{siteId}/branches/{branchId} - Delete Branch
  // ===========================================================================

  describe('DELETE /api/sites/{siteId}/branches/{branchId}', () => {
    it('should delete a branch', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.deleteBranch).mockResolvedValueOnce(undefined);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1',
        { method: 'DELETE' },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 for non-existent branch', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.deleteBranch).mockRejectedValueOnce(
        new services.BranchNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/nonexistent',
        { method: 'DELETE' },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        branchId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 404 for non-existent site', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.listBranches).mockRejectedValueOnce(
        new services.SiteNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/nonexistent/branches',
        { method: 'GET' },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });

    it('should return 405 for unsupported methods', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches',
        { method: 'PUT' },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(405);
    });
  });
});
