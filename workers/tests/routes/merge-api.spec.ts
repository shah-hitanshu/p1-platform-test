/**
 * Phase 7.1c: Merge API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for merge operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
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
  MergeRequestNotFoundError: class MergeRequestNotFoundError extends Error {
    name = 'MergeRequestNotFoundError';
    constructor(public requestId: string) {
      super(`Merge request not found: ${requestId}`);
    }
  },
  BranchNotFoundError: class BranchNotFoundError extends Error {
    name = 'BranchNotFoundError';
    constructor(public branchId: string) {
      super(`Branch not found: ${branchId}`);
    }
  },
  SourceBranchNotFoundError: class SourceBranchNotFoundError extends Error {
    name = 'SourceBranchNotFoundError';
    constructor(public branchId: string) {
      super(`Source branch not found: ${branchId}`);
    }
  },
  TargetBranchNotFoundError: class TargetBranchNotFoundError extends Error {
    name = 'TargetBranchNotFoundError';
    constructor(public branchId: string) {
      super(`Target branch not found: ${branchId}`);
    }
  },
  MergeConflictsError: class MergeConflictsError extends Error {
    name = 'MergeConflictsError';
    constructor(public conflicts: unknown[]) {
      super('Merge has unresolved conflicts');
    }
  },
}));

// Mock authorization
vi.mock('../../src/auth/middleware', () => ({
  requirePermission: vi.fn(() => vi.fn()),
}));

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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('should return 409 for unresolved conflicts', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.executeMerge).mockRejectedValueOnce(
        new services.MergeConflictsError([{ documentId: 'doc-1' }]),
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('mr-1');
    });
  });

  describe('GET /api/sites/{siteId}/merge-requests', () => {
    it('should list merge requests', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.mergeRequests).toHaveLength(1);
    });
  });

  describe('GET /api/sites/{siteId}/merge-requests/{requestId}', () => {
    it('should get merge request details', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('mr-1');
    });

    it('should return 404 for non-existent merge request', async () => {
      const { handleMergeRoutes } = await import('../../src/routes/merge-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMergeRequest).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/merge-requests/nonexistent',
        { method: 'GET' },
      );

      const response = await handleMergeRoutes(request, {
        siteId: 'site-1',
        mergeRequests: true,
        mergeRequestId: 'nonexistent',
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(405);
    });
  });
});
