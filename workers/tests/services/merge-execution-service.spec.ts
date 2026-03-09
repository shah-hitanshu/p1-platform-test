/**
 * Phase 5.3: Merge Execution Service Tests (TDD)
 *
 * Tests for orchestrating the full merge workflow.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock dependent services
vi.mock('../../src/services/conflict-detection-service', () => ({
  detectConflicts: vi.fn(),
}));

vi.mock('../../src/services/conflict-resolution-service', () => ({
  resolveConflict: vi.fn(),
  resolveAllConflicts: vi.fn(),
  resolveDeletedConflict: vi.fn(),
}));

vi.mock('../../src/services/crdt-merge-service', () => ({
  resolveWithCrdtMerge: vi.fn(),
}));

vi.mock('../../src/services/merge-request-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/merge-request-service')>();
  return {
    ...actual,
    getMergeRequest: vi.fn(),
    updateMergeRequestStatus: vi.fn(),
    updateMergeRequestConflicts: vi.fn(),
  };
});

vi.mock('../../src/services/document-version-service', () => ({
  createDocumentVersion: vi.fn(),
  getDocumentVersion: vi.fn(),
}));

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
}));

vi.mock('../../src/services/document-diff-service', () => ({
  computeDocumentDiffs: vi.fn(),
}));

vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
  updateBranchStatus: vi.fn(),
}));

describe('Phase 5.3: Merge Execution Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('executeMerge', () => {
    it('should execute merge successfully when no conflicts exist', async () => {
      const { executeMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const checkpointService = await import('../../src/services/checkpoint-service');
      const docVersionService = await import('../../src/services/document-version-service');

      // Mock merge request
      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      // Mock no conflicts
      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: false,
        conflicts: { documentConflicts: [], structureConflicts: [] },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/new-page',
            latestVersionId: 'v1',
            latestVersionNumber: 1,
            baseVersionId: null,
            baseVersionNumber: null,
          },
        ],
        targetChanges: [],
      });

      // Mock getting source version
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'v1',
        documentId: 'doc-1',
        branchId: 'source-branch',
        versionNumber: 1,
        snapshot: { title: 'New Page' },
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      // Mock creating version on target
      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'new-v1',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 1,
        snapshot: { title: 'New Page' },
        createdAt: '2026-01-20T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'merge',
      });

      // Mock checkpoint creation
      vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-merged',
          branchId: 'target-branch',
          name: 'Post-merge checkpoint',
          checkpointType: 'post_merge',
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 1,
      });

      // Mock status update
      vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'merged',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T11:00:00.000Z',
        mergedAt: '2026-01-20T11:00:00.000Z',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      const result = await executeMerge({
        mergeRequestId: 'mr-1',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      expect(result.success).toBe(true);
      expect(result.mergeRequestId).toBe('mr-1');
      expect(result.checkpointId).toBe('checkpoint-merged');
      expect(result.documentsUpdated).toBe(1);
    });

    it('should fail when merge request is not in approved status', async () => {
      const { executeMerge, MergeNotAllowedError } = await import(
        '../../src/services/merge-execution-service'
      );
      const mergeRequestService = await import('../../src/services/merge-request-service');

      // Mock merge request in wrong status
      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'open', // Not approved
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      await expect(
        executeMerge({
          mergeRequestId: 'mr-1',
          mergedById: 'user-1',
          mergedByType: 'user',
        }),
      ).rejects.toThrow(MergeNotAllowedError);
    });

    it('should fail when conflicts are detected', async () => {
      const { executeMerge, MergeConflictsError } = await import(
        '../../src/services/merge-execution-service'
      );
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');

      // Mock approved merge request
      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      // Mock conflicts detected
      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: true,
        conflicts: {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: 'pages/home',
              conflictType: 'both-modified',
              sourceVersion: 3,
              targetVersion: 2,
            },
          ],
          structureConflicts: [],
        },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [],
        targetChanges: [],
      });

      // Mock conflict update on merge request
      vi.mocked(mergeRequestService.updateMergeRequestConflicts).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'conflicted',
        hasConflicts: true,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T11:00:00.000Z',
      });

      await expect(
        executeMerge({
          mergeRequestId: 'mr-1',
          mergedById: 'user-1',
          mergedByType: 'user',
        }),
      ).rejects.toThrow(MergeConflictsError);
    });

    it('should copy source changes to target branch', async () => {
      const { executeMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const docVersionService = await import('../../src/services/document-version-service');
      const checkpointService = await import('../../src/services/checkpoint-service');

      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      // Source has 2 new documents
      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: false,
        conflicts: { documentConflicts: [], structureConflicts: [] },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/new-1',
            latestVersionId: 'v1',
            latestVersionNumber: 1,
            baseVersionId: null,
            baseVersionNumber: null,
          },
          {
            documentId: 'doc-2',
            documentPath: 'pages/new-2',
            latestVersionId: 'v2',
            latestVersionNumber: 1,
            baseVersionId: null,
            baseVersionNumber: null,
          },
        ],
        targetChanges: [],
      });

      // Mock getting source versions
      vi.mocked(docVersionService.getDocumentVersion)
        .mockResolvedValueOnce({
          id: 'v1',
          documentId: 'doc-1',
          branchId: 'source-branch',
          versionNumber: 1,
          snapshot: { title: 'New Page 1' },
          createdAt: '2026-01-20T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
          source: 'edit',
        })
        .mockResolvedValueOnce({
          id: 'v2',
          documentId: 'doc-2',
          branchId: 'source-branch',
          versionNumber: 1,
          snapshot: { title: 'New Page 2' },
          createdAt: '2026-01-20T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
          source: 'edit',
        });

      // Mock creating versions on target
      vi.mocked(docVersionService.createDocumentVersion)
        .mockResolvedValueOnce({
          id: 'new-v1',
          documentId: 'doc-1',
          branchId: 'target-branch',
          versionNumber: 1,
          snapshot: { title: 'New Page 1' },
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
          source: 'merge',
        })
        .mockResolvedValueOnce({
          id: 'new-v2',
          documentId: 'doc-2',
          branchId: 'target-branch',
          versionNumber: 1,
          snapshot: { title: 'New Page 2' },
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
          source: 'merge',
        });

      vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-merged',
          branchId: 'target-branch',
          name: 'Post-merge checkpoint',
          checkpointType: 'post_merge',
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 2,
      });

      vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'merged',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T11:00:00.000Z',
        mergedAt: '2026-01-20T11:00:00.000Z',
        mergedById: 'user-1',
      });

      const result = await executeMerge({
        mergeRequestId: 'mr-1',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      expect(result.success).toBe(true);
      expect(result.documentsUpdated).toBe(2);

      // Verify versions were created on target
      expect(docVersionService.createDocumentVersion).toHaveBeenCalledTimes(2);
    });

    it('should create post-merge checkpoint with correct type', async () => {
      const { executeMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const checkpointService = await import('../../src/services/checkpoint-service');

      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: false,
        conflicts: { documentConflicts: [], structureConflicts: [] },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [],
        targetChanges: [],
      });

      vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-merged',
          branchId: 'target-branch',
          name: 'Merge: Feature merge',
          checkpointType: 'post_merge',
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 0,
      });

      vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'merged',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T11:00:00.000Z',
      });

      await executeMerge({
        mergeRequestId: 'mr-1',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      // Verify checkpoint was created with post_merge type
      expect(checkpointService.createCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          checkpointType: 'post_merge',
        }),
      );
    });

    it('should throw MergeRequestNotFoundError when merge request does not exist', async () => {
      const { executeMerge } = await import('../../src/services/merge-execution-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const { MergeRequestNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );

      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce(null);

      await expect(
        executeMerge({
          mergeRequestId: 'nonexistent',
          mergedById: 'user-1',
          mergedByType: 'user',
        }),
      ).rejects.toThrow(MergeRequestNotFoundError);
    });

    it('should copy tombstone versions to target during merge', async () => {
      const { executeMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const docVersionService = await import('../../src/services/document-version-service');
      const checkpointService = await import('../../src/services/checkpoint-service');

      // Mock approved merge request
      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge with deletion',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      // Source has a tombstoned document (deleted on branch via tombstone)
      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: false,
        conflicts: { documentConflicts: [], structureConflicts: [] },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [
          {
            documentId: 'doc-deleted',
            documentPath: 'pages/removed-page',
            latestVersionId: 'v-tombstone',
            latestVersionNumber: 2,
            baseVersionId: 'v-base',
            baseVersionNumber: 1,
            isDeleted: true,
          },
        ],
        targetChanges: [],
      });

      // Mock getting the tombstone version — snapshot has { _deleted: true }
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'v-tombstone',
        documentId: 'doc-deleted',
        branchId: 'source-branch',
        versionNumber: 2,
        snapshot: { _deleted: true },
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      // Mock creating tombstone version on target
      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'new-v-tombstone',
        documentId: 'doc-deleted',
        branchId: 'target-branch',
        versionNumber: 2,
        snapshot: { _deleted: true },
        createdAt: '2026-01-20T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'merge',
      });

      // Mock checkpoint creation
      vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-merged',
          branchId: 'target-branch',
          name: 'Post-merge checkpoint',
          checkpointType: 'post_merge',
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 0,
      });

      // Mock status update
      vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge with deletion',
        status: 'merged',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T11:00:00.000Z',
      });

      const result = await executeMerge({
        mergeRequestId: 'mr-1',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      expect(result.success).toBe(true);
      expect(result.documentsUpdated).toBe(1);

      // Verify createDocumentVersion was called with the tombstone snapshot
      expect(docVersionService.createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-deleted',
          branchId: 'target-branch',
          snapshot: { _deleted: true },
          source: 'merge',
        }),
      );
    });

    it('should only copy documents with local versions (COW: no inherited docs)', async () => {
      const { executeMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const docVersionService = await import('../../src/services/document-version-service');
      const checkpointService = await import('../../src/services/checkpoint-service');

      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'COW merge',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      // With COW, sourceChanges should ONLY contain locally modified documents,
      // not inherited ones. This test verifies that the merge only processes
      // documents that actually have local versions on the source branch.
      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: false,
        conflicts: { documentConflicts: [], structureConflicts: [] },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [
          // Only one locally edited document — inherited docs are NOT present
          {
            documentId: 'doc-edited',
            documentPath: 'pages/edited',
            latestVersionId: 'v-edited',
            latestVersionNumber: 3,
            baseVersionId: 'v-base',
            baseVersionNumber: 1,
          },
        ],
        targetChanges: [],
      });

      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'v-edited',
        documentId: 'doc-edited',
        branchId: 'source-branch',
        versionNumber: 3,
        snapshot: { title: 'Edited Page' },
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'new-v-edited',
        documentId: 'doc-edited',
        branchId: 'target-branch',
        versionNumber: 3,
        snapshot: { title: 'Edited Page' },
        createdAt: '2026-01-20T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'merge',
      });

      vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-merged',
          branchId: 'target-branch',
          name: 'Post-merge checkpoint',
          checkpointType: 'post_merge',
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 1,
      });

      vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'COW merge',
        status: 'merged',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T11:00:00.000Z',
      });

      const result = await executeMerge({
        mergeRequestId: 'mr-1',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      // Only the locally edited document should be copied, not inherited docs
      expect(result.documentsUpdated).toBe(1);
      expect(docVersionService.createDocumentVersion).toHaveBeenCalledTimes(1);
      expect(docVersionService.createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-edited',
          source: 'merge',
        }),
      );
    });
  });

  describe('executeMergeWithResolution', () => {
    it('should execute merge with take-source resolution strategy', async () => {
      const { executeMergeWithResolution } = await import(
        '../../src/services/merge-execution-service'
      );
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const conflictResolution = await import('../../src/services/conflict-resolution-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const checkpointService = await import('../../src/services/checkpoint-service');

      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'approved',
        hasConflicts: true,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
        conflictDetails: {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: 'pages/home',
              conflictType: 'both-modified',
            },
          ],
          structureConflicts: [],
        },
      });

      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: true,
        conflicts: {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: 'pages/home',
              conflictType: 'both-modified',
              sourceVersion: 3,
              targetVersion: 2,
            },
          ],
          structureConflicts: [],
        },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-source',
            latestVersionNumber: 3,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ],
        targetChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-target',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ],
      });

      // Mock conflict resolution
      vi.mocked(conflictResolution.resolveAllConflicts).mockResolvedValueOnce({
        resolvedCount: 1,
        failedCount: 0,
        resolutions: [
          {
            resolved: true,
            documentId: 'doc-1',
            strategy: 'take-source',
            resultVersionId: 'resolved-v1',
            resolvedById: 'user-1',
            resolvedByType: 'user',
          },
        ],
      });

      vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-merged',
          branchId: 'target-branch',
          name: 'Post-merge checkpoint',
          checkpointType: 'post_merge',
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 1,
      });

      vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'merged',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T11:00:00.000Z',
      });

      const result = await executeMergeWithResolution({
        mergeRequestId: 'mr-1',
        resolutionStrategy: 'take-source',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      expect(result.success).toBe(true);
      expect(result.conflictsResolved).toBe(1);
    });

    it('should execute merge with merge-crdt resolution strategy', async () => {
      const { executeMergeWithResolution } = await import(
        '../../src/services/merge-execution-service'
      );
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const crdtMerge = await import('../../src/services/crdt-merge-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const checkpointService = await import('../../src/services/checkpoint-service');

      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'approved',
        hasConflicts: true,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: true,
        conflicts: {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: 'pages/home',
              conflictType: 'both-modified',
              sourceVersion: 3,
              targetVersion: 2,
            },
          ],
          structureConflicts: [],
        },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-source',
            latestVersionNumber: 3,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ],
        targetChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-target',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ],
      });

      // Mock CRDT merge resolution
      vi.mocked(crdtMerge.resolveWithCrdtMerge).mockResolvedValueOnce({
        resolved: true,
        documentId: 'doc-1',
        strategy: 'merge-crdt',
        resultVersionId: 'merged-v1',
        resolvedById: 'user-1',
        resolvedByType: 'user',
      });

      vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-merged',
          branchId: 'target-branch',
          name: 'Post-merge checkpoint',
          checkpointType: 'post_merge',
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 1,
      });

      vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'merged',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T11:00:00.000Z',
      });

      const result = await executeMergeWithResolution({
        mergeRequestId: 'mr-1',
        resolutionStrategy: 'merge-crdt',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      expect(result.success).toBe(true);
      expect(crdtMerge.resolveWithCrdtMerge).toHaveBeenCalled();
    });
  });

  describe('previewMerge', () => {
    it('should return merge preview with changes and conflicts', async () => {
      const { previewMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');

      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'open',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: true,
        conflicts: {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: 'pages/home',
              conflictType: 'both-modified',
              sourceVersion: 3,
              targetVersion: 2,
            },
          ],
          structureConflicts: [],
        },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1',
            latestVersionNumber: 3,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
          {
            documentId: 'doc-2',
            documentPath: 'pages/new',
            latestVersionId: 'v2',
            latestVersionNumber: 1,
            baseVersionId: null,
            baseVersionNumber: null,
          },
        ],
        targetChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-target',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ],
      });

      const preview = await previewMerge('mr-1');

      expect(preview.canMerge).toBe(false);
      expect(preview.hasConflicts).toBe(true);
      expect(preview.conflicts.documentConflicts).toHaveLength(1);
      expect(preview.sourceChanges).toHaveLength(2);
      expect(preview.targetChanges).toHaveLength(1);
      expect(preview.mergeBase).toBeDefined();
    });

    it('should indicate merge is possible when no conflicts', async () => {
      const { previewMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');

      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-1',
        siteId: 'site-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        title: 'Feature merge',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:00:00.000Z',
      });

      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: false,
        conflicts: { documentConflicts: [], structureConflicts: [] },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [],
        targetChanges: [],
      });

      const preview = await previewMerge('mr-1');

      expect(preview.canMerge).toBe(true);
      expect(preview.hasConflicts).toBe(false);
    });

    it('should include document diffs when includeContent option is true', async () => {
      const { previewMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const documentDiffService = await import('../../src/services/document-diff-service');

      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: true,
        conflicts: {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: 'pages/home',
              conflictType: 'both-modified',
              sourceVersion: 3,
              targetVersion: 2,
            },
          ],
          structureConflicts: [],
        },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-source',
            latestVersionNumber: 3,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ],
        targetChanges: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-target',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ],
      });

      vi.mocked(documentDiffService.computeDocumentDiffs).mockResolvedValueOnce([
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          sourceSnapshot: { title: 'Source Title' },
          targetSnapshot: { title: 'Target Title' },
          diffOperations: [
            { op: 'replace', path: '/title', value: 'Target Title' },
          ],
        },
      ]);

      const preview = await previewMerge('source-branch', 'target-branch', {
        includeContent: true,
      });

      expect(preview.hasConflicts).toBe(true);
      expect(preview.documentDiffs).toBeDefined();
      expect(preview.documentDiffs).toHaveLength(1);
      expect(preview.documentDiffs?.[0].sourceSnapshot).toEqual({ title: 'Source Title' });
      expect(preview.documentDiffs?.[0].targetSnapshot).toEqual({ title: 'Target Title' });
      expect(preview.documentDiffs?.[0].diffOperations).toHaveLength(1);
      expect(documentDiffService.computeDocumentDiffs).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        expect.any(Array),
      );
    });

    it('should not include document diffs when includeContent option is false', async () => {
      const { previewMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const documentDiffService = await import('../../src/services/document-diff-service');

      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: true,
        conflicts: {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: 'pages/home',
              conflictType: 'both-modified',
              sourceVersion: 3,
              targetVersion: 2,
            },
          ],
          structureConflicts: [],
        },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [],
        targetChanges: [],
      });

      const preview = await previewMerge('source-branch', 'target-branch', {
        includeContent: false,
      });

      expect(preview.documentDiffs).toBeUndefined();
      expect(documentDiffService.computeDocumentDiffs).not.toHaveBeenCalled();
    });

    it('should not include document diffs when includeContent option is omitted', async () => {
      const { previewMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const documentDiffService = await import('../../src/services/document-diff-service');

      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: false,
        conflicts: { documentConflicts: [], structureConflicts: [] },
        mergeBase: {
          checkpointId: 'checkpoint-base',
          branchId: 'target-branch',
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        sourceChanges: [],
        targetChanges: [],
      });

      const preview = await previewMerge('source-branch', 'target-branch');

      expect(preview.documentDiffs).toBeUndefined();
      expect(documentDiffService.computeDocumentDiffs).not.toHaveBeenCalled();
    });
  });

  describe('Error Classes', () => {
    it('should export MergeNotAllowedError with correct properties', async () => {
      const { MergeNotAllowedError } = await import('../../src/services/merge-execution-service');

      const error = new MergeNotAllowedError('mr-1', 'open', 'Merge request must be approved');

      expect(error.name).toBe('MergeNotAllowedError');
      expect(error.mergeRequestId).toBe('mr-1');
      expect(error.currentStatus).toBe('open');
      expect(error.message).toContain('approved');
    });

    it('should export MergeConflictsError with correct properties', async () => {
      const { MergeConflictsError } = await import('../../src/services/merge-execution-service');

      const error = new MergeConflictsError('mr-1', 2);

      expect(error.name).toBe('MergeConflictsError');
      expect(error.mergeRequestId).toBe('mr-1');
      expect(error.conflictCount).toBe(2);
    });

    it('should export MergeExecutionError with correct properties', async () => {
      const { MergeExecutionError } = await import('../../src/services/merge-execution-service');

      const error = new MergeExecutionError('mr-1', 'Failed to copy documents');

      expect(error.name).toBe('MergeExecutionError');
      expect(error.mergeRequestId).toBe('mr-1');
      expect(error.message).toContain('Failed to copy documents');
    });
  });
});
