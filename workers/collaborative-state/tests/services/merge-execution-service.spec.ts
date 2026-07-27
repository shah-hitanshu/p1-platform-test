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
  getLatestDocumentVersion: vi.fn(),
}));

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
}));

vi.mock('../../src/services/document-diff-service', () => ({
  computeDocumentDiffs: vi.fn(),
}));

vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
  getMainBranch: vi.fn(),
  updateBranchStatus: vi.fn(),
}));

// merge-publish is exercised by its own spec file; mock here so tests for
// executeMerge don't try to publish through the real helper.
vi.mock('../../src/services/merge-publish', () => ({
  publishMergedVersions: vi.fn(),
}));

vi.mock('../../src/services/migration-service', () => ({
  triggerMigration: vi.fn(),
  processMigration: vi.fn(),
}));

describe('Phase 5.3: Merge Execution Service', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    // Default: no main branch resolved → auto-publish is skipped for all
    // existing tests (their targets are non-main feature branches).
    const branchService = await import('../../src/services/branch-service');
    vi.mocked(branchService.getMainBranch).mockResolvedValue(null);
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
        'source-branch',
        'target-branch',
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

    it('should exclude documents matching excludePathPrefixes', async () => {
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
            {
              documentId: 'doc-reg',
              documentPath: '_registry/components/Hero',
              conflictType: 'both-modified',
              sourceVersion: 3,
              targetVersion: 3,
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
            documentId: 'doc-reg',
            documentPath: '_registry/components/Hero',
            latestVersionId: 'v-reg',
            latestVersionNumber: 3,
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
          {
            documentId: 'doc-reg',
            documentPath: '_registry/components/Hero',
            latestVersionId: 'v-reg-target',
            latestVersionNumber: 3,
            baseVersionId: null,
            baseVersionNumber: null,
          },
        ],
      });

      vi.mocked(documentDiffService.computeDocumentDiffs).mockResolvedValueOnce([]);

      const preview = await previewMerge('source-branch', 'target-branch', {
        includeContent: true,
        excludePathPrefixes: ['_registry/'],
      });

      // hasConflicts uses unfiltered detection result
      expect(preview.hasConflicts).toBe(true);
      // Filtered results exclude _registry docs
      expect(preview.conflicts.documentConflicts).toHaveLength(1);
      expect(preview.conflicts.documentConflicts[0]?.documentPath).toBe('pages/home');
      expect(preview.sourceChanges).toHaveLength(1);
      expect(preview.targetChanges).toHaveLength(1);
      // computeDocumentDiffs receives only the filtered arrays
      expect(documentDiffService.computeDocumentDiffs).toHaveBeenCalledWith(
        [expect.objectContaining({ documentPath: 'pages/home' })],
        [expect.objectContaining({ documentPath: 'pages/home' })],
        [expect.objectContaining({ documentPath: 'pages/home' })],
        'source-branch',
        'target-branch',
      );
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

  // =========================================================================
  // triggerPostMergeTemplateMigrations (via executeMerge)
  // =========================================================================

  describe('post-merge template migration', () => {
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async function setupSuccessfulMergeWithTemplateChange(
      templateDocId = 'tmpl-doc-1',
      staleCount = 3,
    ) {
      const { executeMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const checkpointService = await import('../../src/services/checkpoint-service');
      const docVersionService = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');
      const migrationService = await import('../../src/services/migration-service');

      // Mock merge request
      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-tmpl',
        siteId: 'site-1',
        sourceBranchId: 'feature-branch',
        targetBranchId: 'main-branch',
        title: 'Template update merge',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
        updatedAt: '2026-06-18T10:00:00.000Z',
      });

      // Conflict detection returns a template document in sourceChanges
      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: false,
        conflicts: { documentConflicts: [], structureConflicts: [] },
        mergeBase: {
          checkpointId: 'cp-base',
          branchId: 'main-branch',
          createdAt: '2026-06-17T10:00:00.000Z',
        },
        sourceChanges: [
          {
            documentId: templateDocId,
            documentPath: '_registry/templates/blog-post',
            latestVersionId: 'tv-2',
            latestVersionNumber: 2,
            baseVersionId: 'tv-1',
            baseVersionNumber: 1,
          },
        ],
        targetChanges: [],
      });

      // getDocumentVersion for copying source version to target
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'tv-2',
        documentId: templateDocId,
        branchId: 'feature-branch',
        versionNumber: 2,
        snapshot: {
          name: 'blog-post',
          components: [{ type: 'Hero' }, { type: 'CTA' }],
        },
        createdAt: '2026-06-18T09:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      // createDocumentVersion for the merge copy
      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'tv-2-target',
        documentId: templateDocId,
        branchId: 'main-branch',
        versionNumber: 2,
        snapshot: {
          name: 'blog-post',
          components: [{ type: 'Hero' }, { type: 'CTA' }],
        },
        createdAt: '2026-06-18T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'merge',
      });

      // Checkpoint creation
      vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'cp-merged',
          branchId: 'main-branch',
          name: 'Post-merge',
          checkpointType: 'post_merge',
          createdAt: '2026-06-18T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 1,
      });

      // updateMergeRequestStatus
      vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
        id: 'mr-tmpl',
        siteId: 'site-1',
        sourceBranchId: 'feature-branch',
        targetBranchId: 'main-branch',
        title: 'Template update merge',
        status: 'merged',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
        updatedAt: '2026-06-18T11:00:00.000Z',
        mergedAt: '2026-06-18T11:00:00.000Z',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      // getLatestDocumentVersion — called first during source-change copy
      // (line 711 of merge-execution-service.ts) to detect no-op merges.
      // Return null to indicate no pre-existing version on target.
      vi.mocked(docVersionService.getLatestDocumentVersion).mockResolvedValueOnce(null);

      // getLatestDocumentVersion — called second by triggerPostMergeTemplateMigrations
      // (line 839) to get the template's latest version on the target branch.
      vi.mocked(docVersionService.getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'tv-2-target',
        documentId: templateDocId,
        branchId: 'main-branch',
        versionNumber: 2,
        snapshot: {
          name: 'blog-post',
          components: [{ type: 'Hero' }, { type: 'CTA' }],
        },
        createdAt: '2026-06-18T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'merge',
      });

      // Stale document count query
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: String(staleCount) }],
        rowCount: 1,
      });

      // triggerMigration mock
      vi.mocked(migrationService.triggerMigration).mockResolvedValueOnce({
        id: 'job-post-merge',
        siteId: 'site-1',
        branchId: 'main-branch',
        templateId: templateDocId,
        fromVersion: 1,
        toVersion: 2,
        checkpointId: null,
        status: 'pending',
        totalDocuments: staleCount,
        processedDocuments: 0,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: new Date('2026-06-18T11:00:00.000Z'),
        completedAt: null,
      });

      // processMigration mock
      vi.mocked(migrationService.processMigration).mockResolvedValueOnce({
        processedDocuments: staleCount,
        conflictedDocuments: 0,
        conflicts: [],
      });

      return {
        executeMerge,
        migrationService,
        docVersionService,
        db,
      };
    }

    it('should trigger migration when template documents are merged', async () => {
      const { executeMerge, migrationService } = await setupSuccessfulMergeWithTemplateChange();

      const result = await executeMerge({
        mergeRequestId: 'mr-tmpl',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      expect(result.success).toBe(true);
      // TODO: asserts internal call shapes rather than observable merge behaviour;
      // rework to assert on the persisted migration job / target-branch state.
      const triggerArgs = vi.mocked(migrationService.triggerMigration).mock.calls[0];
      expect(triggerArgs?.slice(0, 6)).toEqual(['site-1', 'main-branch', 'tmpl-doc-1', 1, 2, { id: 'user-1', type: 'user' }]);
      expect(vi.mocked(migrationService.processMigration).mock.calls[0]?.[0]).toBe('job-post-merge');
    });

    it('should skip migration when no stale documents exist', async () => {
      const { executeMerge, migrationService } =
        await setupSuccessfulMergeWithTemplateChange('tmpl-doc-2', 0);

      const result = await executeMerge({
        mergeRequestId: 'mr-tmpl',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      expect(result.success).toBe(true);
      expect(migrationService.triggerMigration).not.toHaveBeenCalled();
      expect(migrationService.processMigration).not.toHaveBeenCalled();
    });

    it('should not fail the merge when migration throws', async () => {
      const { executeMerge } = await setupSuccessfulMergeWithTemplateChange();
      const migrationService = await import('../../src/services/migration-service');

      // Override triggerMigration to throw
      vi.mocked(migrationService.triggerMigration).mockReset();
      vi.mocked(migrationService.triggerMigration).mockRejectedValueOnce(
        new Error('Migration failed'),
      );

      // Should not throw — post-merge migration is best-effort
      const result = await executeMerge({
        mergeRequestId: 'mr-tmpl',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      expect(result.success).toBe(true);
    });

    it('should skip migration for non-template source changes', async () => {
      const { executeMerge } = await import('../../src/services/merge-execution-service');
      const conflictDetection = await import('../../src/services/conflict-detection-service');
      const mergeRequestService = await import('../../src/services/merge-request-service');
      const checkpointService = await import('../../src/services/checkpoint-service');
      const docVersionService = await import('../../src/services/document-version-service');
      const migrationService = await import('../../src/services/migration-service');

      vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
        id: 'mr-page',
        siteId: 'site-1',
        sourceBranchId: 'feature-branch',
        targetBranchId: 'main-branch',
        title: 'Page update merge',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
        updatedAt: '2026-06-18T10:00:00.000Z',
      });

      // Only regular page documents, no templates
      vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
        hasConflicts: false,
        conflicts: { documentConflicts: [], structureConflicts: [] },
        mergeBase: {
          checkpointId: 'cp-base',
          branchId: 'main-branch',
          createdAt: '2026-06-17T10:00:00.000Z',
        },
        sourceChanges: [
          {
            documentId: 'page-doc-1',
            documentPath: 'pages/about',
            latestVersionId: 'pv-1',
            latestVersionNumber: 1,
            baseVersionId: null,
            baseVersionNumber: null,
          },
        ],
        targetChanges: [],
      });

      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'pv-1',
        documentId: 'page-doc-1',
        branchId: 'feature-branch',
        versionNumber: 1,
        snapshot: { content: [{ type: 'Hero' }] },
        createdAt: '2026-06-18T09:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'pv-1-target',
        documentId: 'page-doc-1',
        branchId: 'main-branch',
        versionNumber: 1,
        snapshot: { content: [{ type: 'Hero' }] },
        createdAt: '2026-06-18T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'merge',
      });

      vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'cp-merged',
          branchId: 'main-branch',
          name: 'Post-merge',
          checkpointType: 'post_merge',
          createdAt: '2026-06-18T11:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 1,
      });

      vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
        id: 'mr-page',
        siteId: 'site-1',
        sourceBranchId: 'feature-branch',
        targetBranchId: 'main-branch',
        title: 'Page update merge',
        status: 'merged',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
        updatedAt: '2026-06-18T11:00:00.000Z',
        mergedAt: '2026-06-18T11:00:00.000Z',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      const result = await executeMerge({
        mergeRequestId: 'mr-page',
        mergedById: 'user-1',
        mergedByType: 'user',
      });

      expect(result.success).toBe(true);
      expect(migrationService.triggerMigration).not.toHaveBeenCalled();
    });
  });
});
