/**
 * Phase 5.2a: Conflict Detection Service Tests (TDD)
 *
 * Tests for detecting document-level conflicts between branches during merge.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock merge-base-service
vi.mock('../../src/services/merge-base-service', () => ({
  findMergeBase: vi.fn(),
  getModifiedDocumentsSince: vi.fn(),
}));

describe('Phase 5.2a: Conflict Detection Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('detectConflicts', () => {
    it('should return no conflicts when branches have no overlapping changes', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      // Mock merge base found
      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      // Source modified doc-1, target modified doc-2 (no overlap)
      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            documentId: 'doc-2',
            documentPath: 'pages/about',
            latestVersionId: 'v2',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ]);

      const result = await detectConflicts('source-branch', 'target-branch');

      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts.documentConflicts).toHaveLength(0);
      expect(result.mergeBase).toBeDefined();
      expect(result.mergeBase?.checkpointId).toBe('checkpoint-123');
    });

    it('should detect conflict when both branches modified same document', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      // Both branches modified the same document (doc-1)
      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-source',
            latestVersionNumber: 3,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-target',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ]);

      const result = await detectConflicts('source-branch', 'target-branch');

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.documentConflicts).toHaveLength(1);
      expect(result.conflicts.documentConflicts[0].documentId).toBe('doc-1');
      expect(result.conflicts.documentConflicts[0].conflictType).toBe('both-modified');
      expect(result.conflicts.documentConflicts[0].sourceVersion).toBe(3);
      expect(result.conflicts.documentConflicts[0].targetVersion).toBe(2);
    });

    it('should detect conflict when document deleted in source but modified in target', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      // Source deleted doc-1, target modified it
      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: null,
            latestVersionNumber: null,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
            isDeleted: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-target',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ]);

      const result = await detectConflicts('source-branch', 'target-branch');

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.documentConflicts).toHaveLength(1);
      expect(result.conflicts.documentConflicts[0].conflictType).toBe('deleted-in-source');
    });

    it('should detect conflict when document deleted in target but modified in source', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      // Source modified doc-1, target deleted it
      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-source',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: null,
            latestVersionNumber: null,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
            isDeleted: true,
          },
        ]);

      const result = await detectConflicts('source-branch', 'target-branch');

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.documentConflicts).toHaveLength(1);
      expect(result.conflicts.documentConflicts[0].conflictType).toBe('deleted-in-target');
    });

    it('should not conflict when both branches deleted same document', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      // Both branches deleted doc-1
      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: null,
            latestVersionNumber: null,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
            isDeleted: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: null,
            latestVersionNumber: null,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
            isDeleted: true,
          },
        ]);

      const result = await detectConflicts('source-branch', 'target-branch');

      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts.documentConflicts).toHaveLength(0);
    });

    it('should return multiple conflicts when multiple documents conflict', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      // Both branches modified doc-1 and doc-2
      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-source',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
          {
            documentId: 'doc-2',
            documentPath: 'pages/about',
            latestVersionId: 'v2-source',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-target',
            latestVersionNumber: 3,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
          {
            documentId: 'doc-2',
            documentPath: 'pages/about',
            latestVersionId: 'v2-target',
            latestVersionNumber: 4,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ]);

      const result = await detectConflicts('source-branch', 'target-branch');

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.documentConflicts).toHaveLength(2);
    });

    it('should throw NoMergeBaseError when no common ancestor found', async () => {
      const { detectConflicts, NoMergeBaseError } = await import(
        '../../src/services/conflict-detection-service'
      );
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce(null);

      await expect(detectConflicts('branch-a', 'branch-b')).rejects.toThrow(NoMergeBaseError);
    });

    it('should include source and target changes in result', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      const sourceChanges = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'v1',
          latestVersionNumber: 2,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
        },
      ];

      const targetChanges = [
        {
          documentId: 'doc-2',
          documentPath: 'pages/about',
          latestVersionId: 'v2',
          latestVersionNumber: 2,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
        },
      ];

      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce(sourceChanges)
        .mockResolvedValueOnce(targetChanges);

      const result = await detectConflicts('source-branch', 'target-branch');

      expect(result.sourceChanges).toHaveLength(1);
      expect(result.sourceChanges[0].documentId).toBe('doc-1');
      expect(result.targetChanges).toHaveLength(1);
      expect(result.targetChanges[0].documentId).toBe('doc-2');
    });
  });

  describe('detectConflicts - published state comparison', () => {
    it('should pass publishedOnly true for target branch changes', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await detectConflicts('source-branch', 'target-branch');

      // First call: source branch — no publishedOnly option (raw latest versions)
      expect(mergeBaseService.getModifiedDocumentsSince).toHaveBeenNthCalledWith(
        1,
        'source-branch',
        'checkpoint-123',
      );

      // Second call: target branch — publishedOnly: true (only published versions)
      expect(mergeBaseService.getModifiedDocumentsSince).toHaveBeenNthCalledWith(
        2,
        'target-branch',
        'checkpoint-123',
        { publishedOnly: true },
      );
    });

    it('should not show conflicts for unpublished edits on target', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      // Source branch edited doc-1
      // Target branch has NO published changes to doc-1
      // (unpublished edits should be invisible to conflict detection)
      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1-source',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ])
        .mockResolvedValueOnce([]); // publishedOnly returns nothing for target

      const result = await detectConflicts('source-branch', 'target-branch');

      expect(result.hasConflicts).toBe(false);
      expect(result.sourceChanges).toHaveLength(1);
      expect(result.targetChanges).toHaveLength(0);
    });

    it('should show new pages on source as additions when target has no published version', async () => {
      const { detectConflicts } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      // Source branch created a new page
      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-new',
            documentPath: 'pages/new-page',
            latestVersionId: 'v1-new',
            latestVersionNumber: 1,
            baseVersionId: null,
            baseVersionNumber: null,
          },
        ])
        .mockResolvedValueOnce([]); // No published changes on target

      const result = await detectConflicts('source-branch', 'target-branch');

      expect(result.hasConflicts).toBe(false);
      expect(result.sourceChanges).toHaveLength(1);
      expect(result.sourceChanges[0].documentId).toBe('doc-new');
    });
  });

  describe('checkMergeability', () => {
    it('should return canMerge true when no conflicts', async () => {
      const { checkMergeability } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await checkMergeability('source-branch', 'target-branch');

      expect(result.canMerge).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should return canMerge false when conflicts exist', async () => {
      const { checkMergeability } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      // Both modified same document
      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v2',
            latestVersionNumber: 3,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ]);

      const result = await checkMergeability('source-branch', 'target-branch');

      expect(result.canMerge).toBe(false);
      expect(result.conflicts).toHaveLength(1);
    });

    it('should include merge base in result', async () => {
      const { checkMergeability } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await checkMergeability('source-branch', 'target-branch');

      expect(result.mergeBase.checkpointId).toBe('checkpoint-123');
    });

    it('should include changes summary in result', async () => {
      const { checkMergeability } = await import('../../src/services/conflict-detection-service');
      const mergeBaseService = await import('../../src/services/merge-base-service');

      vi.mocked(mergeBaseService.findMergeBase).mockResolvedValueOnce({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      vi.mocked(mergeBaseService.getModifiedDocumentsSince)
        .mockResolvedValueOnce([
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            latestVersionId: 'v1',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            documentId: 'doc-2',
            documentPath: 'pages/about',
            latestVersionId: 'v2',
            latestVersionNumber: 2,
            baseVersionId: 'v0',
            baseVersionNumber: 1,
          },
        ]);

      const result = await checkMergeability('source-branch', 'target-branch');

      expect(result.changes.documentsModifiedInSource).toContain('pages/home');
      expect(result.changes.documentsModifiedInTarget).toContain('pages/about');
    });
  });

  describe('Error Classes', () => {
    it('should export NoMergeBaseError with correct properties', async () => {
      const { NoMergeBaseError } = await import('../../src/services/conflict-detection-service');

      const error = new NoMergeBaseError('source-id', 'target-id');

      expect(error.name).toBe('NoMergeBaseError');
      expect(error.sourceBranchId).toBe('source-id');
      expect(error.targetBranchId).toBe('target-id');
      expect(error.message).toContain('source-id');
      expect(error.message).toContain('target-id');
    });
  });
});
