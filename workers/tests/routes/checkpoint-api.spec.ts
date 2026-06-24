/**
 * Phase 7.1b: Checkpoint API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for checkpoint operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  createCheckpoint: vi.fn(),
  getCheckpoint: vi.fn(),
  listCheckpoints: vi.fn(),
  getDocumentsAtCheckpoint: vi.fn(),
  getDocumentAtCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
  deleteCheckpoint: vi.fn(),
  getLatestCheckpoint: vi.fn(),
  getBranch: vi.fn().mockResolvedValue({ id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true }),
  CheckpointNotFoundError: class CheckpointNotFoundError extends Error {
    name = 'CheckpointNotFoundError';
    constructor(public checkpointId: string) {
      super(`Checkpoint not found: ${checkpointId}`);
    }
  },
  BranchNotFoundError: class BranchNotFoundError extends Error {
    name = 'BranchNotFoundError';
    constructor(public branchId: string) {
      super(`Branch not found: ${branchId}`);
    }
  },
  DocumentNotFoundError: class DocumentNotFoundError extends Error {
    name = 'DocumentNotFoundError';
    constructor(public documentId: string) {
      super(`Document not found: ${documentId}`);
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

describe('Phase 7.1b: Checkpoint API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/branches/{branchId}/checkpoints - Create Checkpoint
  // ===========================================================================

  describe('POST /api/sites/{siteId}/branches/{branchId}/checkpoints', () => {
    it('should create a new checkpoint', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
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
          branchId: 'branch-1',
          name: 'Feature complete',
          type: 'manual',
          createdAt: '2026-01-24T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentVersionIds: ['doc-version-1', 'doc-version-2'],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Feature complete',
          }),
        },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.checkpoint.id).toBe('checkpoint-1');
      expect(body.checkpoint.name).toBe('Feature complete');
    });

    it('should create a checkpoint without a name (name is optional)', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
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
          branchId: 'branch-1',
          name: null,
          type: 'manual',
          createdAt: '2026-01-24T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentVersionIds: [],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.checkpoint.id).toBe('checkpoint-1');
      expect(body.checkpoint.name).toBeNull();
    });

    it('should return 404 for non-existent branch', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/nonexistent/checkpoints',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Feature complete',
          }),
        },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/branches/{branchId}/checkpoints - List Checkpoints
  // ===========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}/checkpoints', () => {
    it('should list all checkpoints for a branch', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.listCheckpoints).mockResolvedValueOnce([
        {
          id: 'checkpoint-1',
          branchId: 'branch-1',
          name: 'Initial checkpoint',
          type: 'manual',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        {
          id: 'checkpoint-2',
          branchId: 'branch-1',
          name: 'Feature complete',
          type: 'manual',
          createdAt: '2026-01-24T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints',
        { method: 'GET' },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.checkpoints).toHaveLength(2);
      expect(body.checkpoints[0].name).toBe('Initial checkpoint');
    });

    it('should paginate checkpoints with limit and offset', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.listCheckpoints).mockResolvedValueOnce([
        {
          id: 'checkpoint-2',
          branchId: 'branch-1',
          name: 'Second checkpoint',
          type: 'manual',
          createdAt: '2026-01-24T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints?limit=1&offset=1',
        { method: 'GET' },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.listCheckpoints).toHaveBeenCalledWith(
        'branch-1',
        expect.objectContaining({ limit: 1, offset: 1 }),
      );
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/checkpoints/{checkpointId} - Get Checkpoint
  // ===========================================================================

  describe('GET /api/sites/{siteId}/checkpoints/{checkpointId}', () => {
    it('should return checkpoint details', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getCheckpoint).mockResolvedValueOnce({
        id: 'checkpoint-1',
        branchId: 'branch-1',
        name: 'Feature complete',
        type: 'manual',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/checkpoints/checkpoint-1',
        { method: 'GET' },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        checkpointId: 'checkpoint-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('checkpoint-1');
      expect(body.name).toBe('Feature complete');
    });

    it('should return 404 for non-existent checkpoint', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getCheckpoint).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/checkpoints/nonexistent',
        { method: 'GET' },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        checkpointId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/checkpoints/{checkpointId}/documents - Get Documents at Checkpoint
  // ===========================================================================

  describe('GET /api/sites/{siteId}/checkpoints/{checkpointId}/documents', () => {
    it('should return documents at checkpoint', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getDocumentsAtCheckpoint).mockResolvedValueOnce([
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          versionId: 'version-1',
          versionNumber: 1,
        },
        {
          documentId: 'doc-2',
          documentPath: 'pages/about',
          versionId: 'version-2',
          versionNumber: 1,
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/checkpoints/checkpoint-1/documents',
        { method: 'GET' },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        checkpointId: 'checkpoint-1',
        documentsPath: true,
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.documents).toHaveLength(2);
      expect(body.documents[0].documentPath).toBe('pages/home');
    });
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/branches/{branchId}/checkpoints/{checkpointId}/revert
  // ===========================================================================

  describe('POST /api/sites/{siteId}/branches/{branchId}/checkpoints/{checkpointId}/revert', () => {
    it('should revert to checkpoint', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.revertToCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'new-checkpoint-id',
          branchId: 'branch-1',
          name: 'Reverted to: Feature complete',
          type: 'revert',
          createdAt: '2026-01-24T12:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        restoredDocumentVersionIds: ['doc-version-1', 'doc-version-2'],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints/checkpoint-1/revert',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Reverted to: Feature complete',
          }),
        },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        checkpointId: 'checkpoint-1',
        revert: true,
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.checkpoint.type).toBe('revert');
    });

    it('should return 404 for non-existent checkpoint', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.revertToCheckpoint).mockRejectedValueOnce(
        new services.CheckpointNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints/nonexistent/revert',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Reverted',
          }),
        },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        checkpointId: 'nonexistent',
        revert: true,
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // DELETE /api/sites/{siteId}/checkpoints/{checkpointId} - Delete Checkpoint
  // ===========================================================================

  describe('DELETE /api/sites/{siteId}/checkpoints/{checkpointId}', () => {
    it('should delete a checkpoint', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.deleteCheckpoint).mockResolvedValueOnce(true);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/checkpoints/checkpoint-1',
        { method: 'DELETE' },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        checkpointId: 'checkpoint-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 for non-existent checkpoint', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.deleteCheckpoint).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/checkpoints/nonexistent',
        { method: 'DELETE' },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        checkpointId: 'nonexistent',
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
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints',
        { method: 'PUT' },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
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

    it('should check canView permission for GET list checkpoints', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.listCheckpoints).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints',
        { method: 'GET' },
      );

      await handleCheckpointRoutes(request, {
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

    it('should check canCreateCheckpoint permission for POST create checkpoint', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
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
          branchId: 'branch-1',
          name: 'Feature complete',
          type: 'manual',
          createdAt: '2026-01-24T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentVersionIds: [],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Feature complete',
          }),
        },
      );

      await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canCreateCheckpoint',
      );
    });

    it('should return 403 when principal lacks permission', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
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
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints',
        { method: 'GET' },
      );

      const response = await handleCheckpointRoutes(request, {
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
    it('rejects checkpoint creation when branch belongs to a different site', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-OTHER',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'v1.0' }),
        },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
      expect(services.createCheckpoint).not.toHaveBeenCalled();
    });

    it('rejects checkpoint listing when branch belongs to a different site', async () => {
      const { handleCheckpointRoutes } = await import(
        '../../src/routes/checkpoint-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-OTHER',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/checkpoints',
        { method: 'GET' },
      );

      const response = await handleCheckpointRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
      expect(services.listCheckpoints).not.toHaveBeenCalled();
    });
  });
});
