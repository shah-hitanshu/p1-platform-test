/**
 * Phase 7.1a: Branch API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for branch operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

// Mock the services
vi.mock('../../src/services', () => ({
  createBranch: vi.fn(),
  getBranch: vi.fn(),
  getMainBranch: vi.fn(),
  listBranches: vi.fn(),
  updateBranch: vi.fn(),
  updateBranchStatus: vi.fn(),
  deleteBranch: vi.fn(),
  archiveBranch: vi.fn(),
  restoreBranch: vi.fn(),
  getLatestCheckpoint: vi.fn(),
  createCheckpoint: vi.fn(),
  MainBranchProtectionError: class MainBranchProtectionError extends Error {
    name = 'MainBranchProtectionError';
    constructor(public operation: string) {
      super(`Cannot ${operation} the main branch`);
    }
  },
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

      vi.mocked(services.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-1',
          branchId: 'main-branch-id',
          name: 'Auto-created for branching',
          type: 'auto',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 0,
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

      vi.mocked(services.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-1',
          branchId: 'main-branch-id',
          name: 'Auto-created for branching',
          type: 'auto',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 0,
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

      vi.mocked(services.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-2',
          branchId: 'feature-branch-id',
          name: 'Auto-created for branching',
          type: 'auto',
          createdAt: '2026-01-24T10:30:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 0,
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

      vi.mocked(services.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-1',
          branchId: 'main-branch-id',
          name: 'Auto-created for branching',
          type: 'auto',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 0,
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
    it('should archive a branch (soft delete)', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.archiveBranch).mockResolvedValueOnce(true);

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

      vi.mocked(services.archiveBranch).mockResolvedValueOnce(false);

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

    it('should check canView permission for GET single branch', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

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

      await handleBranchRoutes(request, {
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

    it('should check canCreateBranch permission for POST create branch', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
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

      vi.mocked(services.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'cp-1',
          branchId: 'main-branch-id',
          name: 'Auto-created for branching',
          checkpointType: 'auto',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 0,
      });

      vi.mocked(services.createBranch).mockResolvedValueOnce({
        id: 'new-branch-id',
        siteId: 'site-1',
        name: 'feature-branch',
        isMain: false,
        status: 'active',
        sourceBranchId: 'main-branch-id',
        createdFromCheckpointId: 'cp-1',
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
            sourceBranch: 'main',
          }),
        },
      );

      await handleBranchRoutes(request, {
        siteId: 'site-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'main-branch-id',
        'canCreateBranch',
      );
    });

    it('should return 403 when principal lacks permission', async () => {
      const { handleBranchRoutes } = await import(
        '../../src/routes/branch-api'
      );
      const services = await import('../../src/services');
      const { assertPermission, AuthorizationError } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'feature-branch',
        isMain: false,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(assertPermission).mockRejectedValueOnce(
        new AuthorizationError(
          'Missing permission: canView',
          'canView',
          'viewer',
        ),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1',
        { method: 'GET' },
      );

      const response = await handleBranchRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: authPrincipal,
      });

      expect(response.status).toBe(403);
    });
  });

  // ===========================================================================
  // PCC-3211: Soft delete — DELETE → archive, POST restore, GET ?archived
  // ===========================================================================

  describe('DELETE /api/sites/{siteId}/branches/{branchId} — soft delete (PCC-3211)', () => {
    it('should archive the branch and return 204', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveBranch).mockResolvedValueOnce(true);

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/branch-1', { method: 'DELETE' }),
        { siteId: 'site-1', branchId: 'branch-1', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(204);
      expect(services.archiveBranch).toHaveBeenCalledWith('branch-1');
    });

    it('should return 400 when archiving the main branch', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveBranch).mockRejectedValueOnce(
        new services.MainBranchProtectionError('archive'),
      );

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/main-id', { method: 'DELETE' }),
        { siteId: 'site-1', branchId: 'main-id', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(400);
    });

    it('should return 409 when branch is already archived', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      vi.mocked(services.archiveBranch).mockResolvedValueOnce('already_archived');

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/branch-1', { method: 'DELETE' }),
        { siteId: 'site-1', branchId: 'branch-1', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(409);
    });
  });

  describe('POST /api/sites/{siteId}/branches/{branchId}/restore (PCC-3211)', () => {
    it('should restore an archived branch and return 200 with branch JSON', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      const restoredBranch = {
        id: 'branch-1',
        siteId: 'site-1',
        name: 'feature',
        isMain: false,
        status: 'active' as const,
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user' as const,
        archivedAt: null,
      };
      vi.mocked(services.restoreBranch).mockResolvedValueOnce(restoredBranch);

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/branch-1/restore', { method: 'POST' }),
        { siteId: 'site-1', branchId: 'branch-1', action: 'restore', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('branch-1');
    });

    it('should return 404 when restoreBranch returns null', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      vi.mocked(services.restoreBranch).mockResolvedValueOnce(null);

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/nonexistent/restore', { method: 'POST' }),
        { siteId: 'site-1', branchId: 'nonexistent', action: 'restore', principal: { id: 'user-1', type: 'user' } },
      );

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/sites/{siteId}/branches?archived=true (PCC-3211)', () => {
    it('should pass archived=true to listBranches', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      vi.mocked(services.listBranches).mockResolvedValueOnce([]);

      await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches?archived=true'),
        { siteId: 'site-1', principal: { id: 'user-1', type: 'user' } },
      );

      expect(services.listBranches).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ archived: true }),
      );
    });
  });

  // ===========================================================================
  // write:registry scope guard (§0 Phase 2)
  //
  // The CI registry sync script needs to list branches (to match the pushed
  // git branch's name to a CSS branch), so write:registry's coarse SCOPE_RULES
  // entry grants it GET on the 'branches' handler. That coarse grant can't by
  // itself distinguish "list branches" from "fetch/create/restore a specific
  // branch" — all of which share the same handler name — so this deny-by-
  // default guard narrows it to exactly the list operation.
  // ===========================================================================

  describe('write:registry scope guard (§0 Phase 2)', () => {
    function registryServicePrincipal(scopes: string[] = ['write:registry']): AuthenticatedPrincipal {
      return {
        id: 'token-uuid',
        type: 'service' as const,
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
        scopes,
        siteId: 'site-1',
        authProvider: 'site_token' as const,
      };
    }

    it('allows GET on the branches collection (list) for a write:registry-scoped token', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
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

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches', { method: 'GET' }),
        { siteId: 'site-1', principal: registryServicePrincipal() },
      );

      expect(response.status).toBe(200);
    });

    it('denies GET on a single branch by ID', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/branch-1', { method: 'GET' }),
        { siteId: 'site-1', branchId: 'branch-1', principal: registryServicePrincipal() },
      );

      expect(response.status).toBe(403);
      expect(services.getBranch).not.toHaveBeenCalled();
    });

    it('denies POST branch creation', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches', {
          method: 'POST',
          body: JSON.stringify({ name: 'malicious-branch' }),
        }),
        { siteId: 'site-1', principal: registryServicePrincipal() },
      );

      expect(response.status).toBe(403);
      expect(services.createBranch).not.toHaveBeenCalled();
    });

    it('denies POST branch restore', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/branch-1/restore', { method: 'POST' }),
        { siteId: 'site-1', branchId: 'branch-1', action: 'restore', principal: registryServicePrincipal() },
      );

      expect(response.status).toBe(403);
      expect(services.restoreBranch).not.toHaveBeenCalled();
    });

    it('denies PATCH on a single branch', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/branch-1', {
          method: 'PATCH',
          body: JSON.stringify({ name: 'renamed' }),
        }),
        { siteId: 'site-1', branchId: 'branch-1', principal: registryServicePrincipal() },
      );

      expect(response.status).toBe(403);
      expect(services.updateBranch).not.toHaveBeenCalled();
    });

    it('denies DELETE on a single branch', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/branch-1', { method: 'DELETE' }),
        { siteId: 'site-1', branchId: 'branch-1', principal: registryServicePrincipal() },
      );

      expect(response.status).toBe(403);
      expect(services.archiveBranch).not.toHaveBeenCalled();
    });

    it('does not restrict a service principal that lacks write:registry (e.g. read:draft only)', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'feature',
        isMain: false,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/branch-1', { method: 'GET' }),
        { siteId: 'site-1', branchId: 'branch-1', principal: registryServicePrincipal(['read:draft']) },
      );

      expect(response.status).toBe(200);
    });

    it('does not block a GET on a single branch when the token also holds read:draft alongside write:registry', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'feature',
        isMain: false,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches/branch-1', { method: 'GET' }),
        {
          siteId: 'site-1',
          branchId: 'branch-1',
          principal: registryServicePrincipal(['write:registry', 'read:draft']),
        },
      );

      expect(response.status).toBe(200);
    });

    it('still denies POST branch creation when the token also holds read:draft (read:draft grants no write)', async () => {
      const { handleBranchRoutes } = await import('../../src/routes/branch-api');
      const services = await import('../../src/services');

      const response = await handleBranchRoutes(
        new Request('https://api.example.com/api/sites/site-1/branches', {
          method: 'POST',
          body: JSON.stringify({ name: 'malicious-branch' }),
        }),
        { siteId: 'site-1', principal: registryServicePrincipal(['write:registry', 'read:draft']) },
      );

      expect(response.status).toBe(403);
      expect(services.createBranch).not.toHaveBeenCalled();
    });
  });
});
