/**
 * Phase 7.1c: Merge API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for merge operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';

// Mock the services
vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    checkMergeability: vi.fn(),
    executeMerge: vi.fn(),
    executeMergeWithResolution: vi.fn(),
    previewMerge: vi.fn(),
    createMergeRequest: vi.fn(),
    getMergeRequest: vi.fn(),
    listMergeRequests: vi.fn(),
    updateMergeRequest: vi.fn(),
    updateMergeRequestStatus: vi.fn(),
    deleteMergeRequest: vi.fn(),
    getBranch: vi.fn(),
    getMainBranch: vi.fn(),
  };
});

// Mock authorization
vi.mock('../../src/auth/authorization', async () => {
  const actual = await vi.importActual('../../src/auth/authorization');
  return {
    ...actual,
    assertPermission: vi.fn(),
  };
});

describe('Phase 7.1c: Merge API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/merge/check - Check Mergeability
  // ===========================================================================

  describe('POST /api/sites/{siteId}/merge/check', () => {
    it('should return mergeability status with no conflicts', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.checkMergeability).mockResolvedValueOnce({
        canMerge: true,
        conflicts: [],
        mergeBase: {
          checkpointId: 'checkpoint-1',
          branchId: 'target-branch',
          type: 'common_ancestor',
        },
        sourceModifications: [
          { documentId: 'doc-1', documentPath: 'pages/home', isDeleted: false },
        ],
        targetModifications: [],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'feature-branch',
            targetBranchId: 'main-branch',
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'check',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.canMerge).toBe(true);
      expect(body.conflicts).toHaveLength(0);
    });

    it('should return conflicts when present', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.checkMergeability).mockResolvedValueOnce({
        canMerge: false,
        conflicts: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            type: 'content',
          },
        ],
        mergeBase: {
          checkpointId: 'checkpoint-1',
          branchId: 'target-branch',
          type: 'common_ancestor',
        },
        sourceModifications: [
          { documentId: 'doc-1', documentPath: 'pages/home', isDeleted: false },
        ],
        targetModifications: [
          { documentId: 'doc-1', documentPath: 'pages/home', isDeleted: false },
        ],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'feature-branch',
            targetBranchId: 'main-branch',
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'check',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.canMerge).toBe(false);
      expect(body.conflicts).toHaveLength(1);
    });

    it('should return 400 for missing branch IDs', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'feature-branch',
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'check',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
    });
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/merge/execute - Execute Merge
  // ===========================================================================

  describe('POST /api/sites/{siteId}/merge/execute', () => {
    it('should execute merge without conflicts', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.executeMerge).mockResolvedValueOnce({
        success: true,
        mergeCheckpointId: 'merge-checkpoint-1',
        documentsUpdated: ['doc-1', 'doc-2'],
        sourceBranchStatus: 'merged',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/execute',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'feature-branch',
            targetBranchId: 'main-branch',
            message: 'Merge feature into main',
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'execute',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.success).toBe(true);
      expect(body.mergeCheckpointId).toBe('merge-checkpoint-1');
    });

    it('should execute merge with conflict resolutions', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.executeMergeWithResolution).mockResolvedValueOnce({
        success: true,
        mergeCheckpointId: 'merge-checkpoint-1',
        documentsUpdated: ['doc-1'],
        conflictsResolved: 1,
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/execute',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'feature-branch',
            targetBranchId: 'main-branch',
            message: 'Merge with resolutions',
            conflictResolutions: [
              {
                documentId: 'doc-1',
                strategy: 'take-source',
              },
            ],
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'execute',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.success).toBe(true);
    });

    it('should return 409 for unresolved conflicts', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.executeMerge).mockRejectedValueOnce(
        new services.MergeConflictsError('mr-1', 1),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/execute',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'feature-branch',
            targetBranchId: 'main-branch',
            message: 'Merge feature into main',
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'execute',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(409);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/merge/preview - Preview Merge
  // ===========================================================================

  describe('POST /api/sites/{siteId}/merge/preview', () => {
    it('should return merge preview', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.previewMerge).mockResolvedValueOnce({
        canMerge: true,
        conflicts: [],
        documentsToUpdate: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            action: 'update',
          },
        ],
        sourceChanges: 1,
        targetChanges: 0,
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/preview',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'feature-branch',
            targetBranchId: 'main-branch',
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'preview',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.canMerge).toBe(true);
      expect(body.documentsToUpdate).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Merge Requests CRUD
  // ===========================================================================

  describe('POST /api/sites/{siteId}/merge-requests', () => {
    it('should create a merge request', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.createMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'feature-branch',
        targetBranchId: 'main-branch',
        title: 'Feature merge',
        description: 'Merging feature into main',
        status: 'open',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'feature-branch',
            targetBranchId: 'main-branch',
            title: 'Feature merge',
            description: 'Merging feature into main',
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.id).toBe('mr-1');
    });

    it('should use dbUserId instead of principal.id when creating a merge request', async () => {
      // Auth0 principals have an `id` like "google-oauth2|123" (not a UUID).
      // The merge_requests.created_by_id column is UUID NOT NULL, so passing
      // principal.id directly causes a PostgreSQL UUID cast error → 500.
      // The fix uses principal.dbUserId ?? principal.id, where dbUserId is the
      // UUID from app.users assigned during request enrichment.
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.createMergeRequest).mockResolvedValueOnce({
        id: 'mr-2',
        siteId: 'site-1',
        sourceBranchId: 'feature-branch',
        targetBranchId: 'main-branch',
        title: 'Feature merge',
        status: 'open',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-uuid-for-user',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'feature-branch',
            targetBranchId: 'main-branch',
            title: 'Feature merge',
          }),
        },
      );

      await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        principal: makePrincipal({
          id: 'google-oauth2|107221644627712432289',
          dbUserId: 'db-uuid-for-user',
          type: 'user',
        }),
      });

      expect(vi.mocked(services.createMergeRequest)).toHaveBeenCalledWith(
        expect.objectContaining({ createdById: 'db-uuid-for-user' }),
      );
    });

    it('should return 400 when TargetBranchNotMainError is thrown', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.createMergeRequest).mockRejectedValueOnce(
        new services.TargetBranchNotMainError('non-main-branch'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceBranchId: 'src', targetBranchId: 'non-main-branch', title: 'Test' }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 when InvalidMergeRequestParamsError is thrown', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.createMergeRequest).mockRejectedValueOnce(
        new services.InvalidMergeRequestParamsError('Source and target branches must be different.'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceBranchId: 'same', targetBranchId: 'same', title: 'Test' }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Error handling — remaining service errors return proper status codes', () => {
    it('should return 400 when InvalidMergeRequestStatusTransitionError is thrown', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(makeBranch({
        id: 'main-id', siteId: 'site-1', name: 'main', isMain: true,
        status: 'active', createdAt: '2026-01-01', createdById: 'u', createdByType: 'user',
      }));
      // The PATCH handler reads the MR first (merging is execution-owned in
      // both directions [PCC-3737]); a non-merging status falls through to
      // the service call.
      vi.mocked(services.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1', siteId: 'site-1', sourceBranchId: 's', targetBranchId: 'main-id',
        title: 't', status: 'open', hasConflicts: false,
        createdById: 'u', createdByType: 'user',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      } as never);
      vi.mocked(services.updateMergeRequestStatus).mockRejectedValueOnce(
        new services.InvalidMergeRequestStatusTransitionError('open', 'merged'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests/mr-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'merged' }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        mergeRequestId: 'mr-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 when a client PATCHes status to merging — that status is owned by merge execution [PCC-3737]', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(makeBranch({
        id: 'main-id', siteId: 'site-1', name: 'main', isMain: true,
        status: 'active', createdAt: '2026-01-01', createdById: 'u', createdByType: 'user',
      }));

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests/mr-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'merging' }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        mergeRequestId: 'mr-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
      // The guard must reject before reaching the service, or a permitted
      // transition map edge would let clients strand an MR in merging.
      expect(services.updateMergeRequestStatus).not.toHaveBeenCalled();
    });

    it('should return 409 when a client PATCHes a mid-job MR out of merging [PCC-3737]', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(makeBranch({
        id: 'main-id', siteId: 'site-1', name: 'main', isMain: true,
        status: 'active', createdAt: '2026-01-01', createdById: 'u', createdByType: 'user',
      }));
      vi.mocked(services.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1', siteId: 'site-1', sourceBranchId: 's', targetBranchId: 'main-id',
        title: 't', status: 'merging', hasConflicts: false,
        createdById: 'u', createdByType: 'user',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      } as never);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests/mr-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          // A mid-flight flip out of merging would let the running job
          // publish while its merged stamp silently no-ops.
          body: JSON.stringify({ status: 'approved' }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        mergeRequestId: 'mr-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(409);
      expect(services.updateMergeRequestStatus).not.toHaveBeenCalled();
    });

    it('should return 409 when CannotDeleteMergedRequestError is thrown', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(makeBranch({
        id: 'main-id', siteId: 'site-1', name: 'main', isMain: true,
        status: 'active', createdAt: '2026-01-01', createdById: 'u', createdByType: 'user',
      }));
      vi.mocked(services.deleteMergeRequest).mockRejectedValueOnce(
        new services.CannotDeleteMergedRequestError('mr-1'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests/mr-1',
        { method: 'DELETE' },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        mergeRequestId: 'mr-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(409);
    });

    it('should return 422 when NoMergeBaseError is thrown', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.checkMergeability).mockRejectedValueOnce(
        new services.NoMergeBaseError('src-branch', 'target-branch'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceBranchId: 'src-branch', targetBranchId: 'target-branch' }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'check',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(422);
    });
  });

  describe('GET /api/sites/{siteId}/merge-requests', () => {
    it('should list merge requests', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(makeBranch({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      vi.mocked(services.listMergeRequests).mockResolvedValueOnce([
        {
          id: 'mr-1',
          siteId: 'site-1',
          sourceBranchId: 'feature-branch',
          targetBranchId: 'main-branch',
          title: 'Feature merge',
          status: 'open',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests',
        { method: 'GET' },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.mergeRequests).toHaveLength(1);
    });
  });

  describe('GET /api/sites/{siteId}/merge-requests/{requestId}', () => {
    it('should get merge request details', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(makeBranch({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      vi.mocked(services.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'feature-branch',
        targetBranchId: 'main-branch',
        title: 'Feature merge',
        status: 'open',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests/mr-1',
        { method: 'GET' },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        mergeRequestId: 'mr-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.id).toBe('mr-1');
    });

    it('should return 404 for non-existent merge request', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(makeBranch({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      vi.mocked(services.getMergeRequest).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests/nonexistent',
        { method: 'GET' },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        mergeRequestId: 'nonexistent',
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
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.checkMergeability).mockRejectedValueOnce(
        new services.SourceBranchNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'nonexistent',
            targetBranchId: 'main-branch',
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'check',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 405 for unsupported methods', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/check',
        { method: 'PUT' },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'check',
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

    it('should check canView permission for POST merge check', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.checkMergeability).mockResolvedValueOnce({
        canMerge: true,
        conflicts: [],
        mergeBase: {
          checkpointId: 'checkpoint-1',
          branchId: 'branch-2',
          type: 'common_ancestor',
        },
        sourceModifications: [],
        targetModifications: [],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge/check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'branch-1',
            targetBranchId: 'branch-2',
          }),
        },
      );

      await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'check',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canView',
      );
    });

    it('should check canProposeMerge permission for POST create merge request', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.createMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'branch-1',
        targetBranchId: 'branch-2',
        title: 'Test MR',
        status: 'open',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'branch-1',
            targetBranchId: 'branch-2',
            title: 'Test MR',
          }),
        },
      );

      await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canProposeMerge',
      );
    });

    it('should return 403 when principal lacks permission', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
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
        'https://api.example.com/api/sites/site-1/merge/check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBranchId: 'branch-1',
            targetBranchId: 'branch-2',
          }),
        },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        operation: 'check',
        principal: authPrincipal,
      });

      expect(response.status).toBe(403);
    });
  });
});
