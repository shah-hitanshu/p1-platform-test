/**
 * Phase 5.2b: Conflict Resolution Service Tests (TDD)
 *
 * Tests for resolving document conflicts using take-source and take-target strategies.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock document version service
vi.mock('../../src/services/document-version-service', () => ({
  getDocumentVersion: vi.fn(),
  createDocumentVersion: vi.fn(),
}));

describe('Phase 5.2b: Conflict Resolution Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('resolveConflict', () => {
    it('should apply take-source strategy by copying source version to target branch', async () => {
      const { resolveConflict } = await import('../../src/services/conflict-resolution-service');
      const docVersionService = await import('../../src/services/document-version-service');

      // Mock source version
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'source-version-id',
        documentId: 'doc-1',
        branchId: 'source-branch',
        versionNumber: 3,
        snapshot: { title: 'Source Title', content: 'Source content' },
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      // Mock version creation
      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'new-version-id',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 4,
        snapshot: { title: 'Source Title', content: 'Source content' },
        createdAt: '2026-01-20T11:00:00.000Z',
        createdById: 'resolver-user',
        createdByType: 'user',
        source: 'merge',
      });

      const result = await resolveConflict({
        documentId: 'doc-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        sourceVersionId: 'source-version-id',
        targetVersionId: 'target-version-id',
        strategy: 'take-source',
        resolvedById: 'resolver-user',
        resolvedByType: 'user',
      });

      expect(result.resolved).toBe(true);
      expect(result.resultVersionId).toBe('new-version-id');
      expect(result.strategy).toBe('take-source');

      // Verify source version was fetched
      expect(docVersionService.getDocumentVersion).toHaveBeenCalledWith('source-version-id');

      // Verify new version was created on target branch with source snapshot
      expect(docVersionService.createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          branchId: 'target-branch',
          snapshot: { title: 'Source Title', content: 'Source content' },
          source: 'merge',
        }),
      );
    });

    it('should apply take-target strategy by keeping target version unchanged', async () => {
      const { resolveConflict } = await import('../../src/services/conflict-resolution-service');
      const docVersionService = await import('../../src/services/document-version-service');

      // Mock target version
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'target-version-id',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 2,
        snapshot: { title: 'Target Title', content: 'Target content' },
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-2',
        createdByType: 'user',
        source: 'edit',
      });

      const result = await resolveConflict({
        documentId: 'doc-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        sourceVersionId: 'source-version-id',
        targetVersionId: 'target-version-id',
        strategy: 'take-target',
        resolvedById: 'resolver-user',
        resolvedByType: 'user',
      });

      expect(result.resolved).toBe(true);
      expect(result.resultVersionId).toBe('target-version-id');
      expect(result.strategy).toBe('take-target');

      // For take-target, no new version is created - we keep existing
      expect(docVersionService.createDocumentVersion).not.toHaveBeenCalled();
    });

    it('should throw VersionNotFoundError when source version does not exist', async () => {
      const { resolveConflict, VersionNotFoundError } = await import(
        '../../src/services/conflict-resolution-service'
      );
      const docVersionService = await import('../../src/services/document-version-service');

      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce(null);

      await expect(
        resolveConflict({
          documentId: 'doc-1',
          sourceBranchId: 'source-branch',
          targetBranchId: 'target-branch',
          sourceVersionId: 'nonexistent-version',
          targetVersionId: 'target-version-id',
          strategy: 'take-source',
          resolvedById: 'resolver-user',
          resolvedByType: 'user',
        }),
      ).rejects.toThrow(VersionNotFoundError);
    });

    it('should throw VersionNotFoundError when target version does not exist for take-target', async () => {
      const { resolveConflict, VersionNotFoundError } = await import(
        '../../src/services/conflict-resolution-service'
      );
      const docVersionService = await import('../../src/services/document-version-service');

      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce(null);

      await expect(
        resolveConflict({
          documentId: 'doc-1',
          sourceBranchId: 'source-branch',
          targetBranchId: 'target-branch',
          sourceVersionId: 'source-version-id',
          targetVersionId: 'nonexistent-version',
          strategy: 'take-target',
          resolvedById: 'resolver-user',
          resolvedByType: 'user',
        }),
      ).rejects.toThrow(VersionNotFoundError);
    });

    it('should throw ManualResolutionError for manual strategy without resolvedSnapshot', async () => {
      const { resolveConflict, ManualResolutionError } = await import(
        '../../src/services/conflict-resolution-service'
      );

      await expect(
        resolveConflict({
          documentId: 'doc-1',
          sourceBranchId: 'source-branch',
          targetBranchId: 'target-branch',
          sourceVersionId: 'source-version-id',
          targetVersionId: 'target-version-id',
          strategy: 'manual',
          resolvedById: 'resolver-user',
          resolvedByType: 'user',
        }),
      ).rejects.toThrow(ManualResolutionError);
    });

    it('should include resolution metadata in result', async () => {
      const { resolveConflict } = await import('../../src/services/conflict-resolution-service');
      const docVersionService = await import('../../src/services/document-version-service');

      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'source-version-id',
        documentId: 'doc-1',
        branchId: 'source-branch',
        versionNumber: 3,
        snapshot: { title: 'Source' },
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'new-version-id',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 4,
        snapshot: { title: 'Source' },
        createdAt: '2026-01-20T11:00:00.000Z',
        createdById: 'resolver-user',
        createdByType: 'user',
        source: 'merge',
      });

      const result = await resolveConflict({
        documentId: 'doc-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        sourceVersionId: 'source-version-id',
        targetVersionId: 'target-version-id',
        strategy: 'take-source',
        resolvedById: 'resolver-user',
        resolvedByType: 'user',
      });

      expect(result.resolvedById).toBe('resolver-user');
      expect(result.resolvedByType).toBe('user');
      expect(result.documentId).toBe('doc-1');
    });
  });

  describe('resolveAllConflicts', () => {
    it('should resolve multiple conflicts with same strategy', async () => {
      const { resolveAllConflicts } = await import('../../src/services/conflict-resolution-service');
      const docVersionService = await import('../../src/services/document-version-service');

      // Mock source versions for two documents
      vi.mocked(docVersionService.getDocumentVersion)
        .mockResolvedValueOnce({
          id: 'source-v1',
          documentId: 'doc-1',
          branchId: 'source-branch',
          versionNumber: 2,
          snapshot: { title: 'Doc 1 Source' },
          createdAt: '2026-01-20T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
          source: 'edit',
        })
        .mockResolvedValueOnce({
          id: 'source-v2',
          documentId: 'doc-2',
          branchId: 'source-branch',
          versionNumber: 3,
          snapshot: { title: 'Doc 2 Source' },
          createdAt: '2026-01-20T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
          source: 'edit',
        });

      // Mock version creations
      vi.mocked(docVersionService.createDocumentVersion)
        .mockResolvedValueOnce({
          id: 'new-v1',
          documentId: 'doc-1',
          branchId: 'target-branch',
          versionNumber: 3,
          snapshot: { title: 'Doc 1 Source' },
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'resolver',
          createdByType: 'user',
          source: 'merge',
        })
        .mockResolvedValueOnce({
          id: 'new-v2',
          documentId: 'doc-2',
          branchId: 'target-branch',
          versionNumber: 4,
          snapshot: { title: 'Doc 2 Source' },
          createdAt: '2026-01-20T11:00:00.000Z',
          createdById: 'resolver',
          createdByType: 'user',
          source: 'merge',
        });

      const conflicts = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          conflictType: 'both-modified' as const,
          sourceVersionId: 'source-v1',
          targetVersionId: 'target-v1',
        },
        {
          documentId: 'doc-2',
          documentPath: 'pages/about',
          conflictType: 'both-modified' as const,
          sourceVersionId: 'source-v2',
          targetVersionId: 'target-v2',
        },
      ];

      const result = await resolveAllConflicts({
        conflicts,
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        strategy: 'take-source',
        resolvedById: 'resolver',
        resolvedByType: 'user',
      });

      expect(result.resolvedCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.resolutions).toHaveLength(2);
      expect(result.resolutions[0].resolved).toBe(true);
      expect(result.resolutions[1].resolved).toBe(true);
    });

    it('should continue resolving after individual failures', async () => {
      const { resolveAllConflicts } = await import('../../src/services/conflict-resolution-service');
      const docVersionService = await import('../../src/services/document-version-service');

      // First document fails (version not found), second succeeds
      vi.mocked(docVersionService.getDocumentVersion)
        .mockResolvedValueOnce(null) // First fails
        .mockResolvedValueOnce({
          id: 'source-v2',
          documentId: 'doc-2',
          branchId: 'source-branch',
          versionNumber: 3,
          snapshot: { title: 'Doc 2 Source' },
          createdAt: '2026-01-20T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
          source: 'edit',
        });

      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'new-v2',
        documentId: 'doc-2',
        branchId: 'target-branch',
        versionNumber: 4,
        snapshot: { title: 'Doc 2 Source' },
        createdAt: '2026-01-20T11:00:00.000Z',
        createdById: 'resolver',
        createdByType: 'user',
        source: 'merge',
      });

      const conflicts = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          conflictType: 'both-modified' as const,
          sourceVersionId: 'source-v1',
          targetVersionId: 'target-v1',
        },
        {
          documentId: 'doc-2',
          documentPath: 'pages/about',
          conflictType: 'both-modified' as const,
          sourceVersionId: 'source-v2',
          targetVersionId: 'target-v2',
        },
      ];

      const result = await resolveAllConflicts({
        conflicts,
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        strategy: 'take-source',
        resolvedById: 'resolver',
        resolvedByType: 'user',
      });

      expect(result.resolvedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.resolutions[0].resolved).toBe(false);
      expect(result.resolutions[0].error).toBeDefined();
      expect(result.resolutions[1].resolved).toBe(true);
    });

    it('should return empty results for empty conflicts array', async () => {
      const { resolveAllConflicts } = await import('../../src/services/conflict-resolution-service');

      const result = await resolveAllConflicts({
        conflicts: [],
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        strategy: 'take-source',
        resolvedById: 'resolver',
        resolvedByType: 'user',
      });

      expect(result.resolvedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.resolutions).toHaveLength(0);
    });
  });

  describe('resolveDeletedConflict', () => {
    it('should handle deleted-in-source by deleting document on target when take-source', async () => {
      const { resolveDeletedConflict } = await import(
        '../../src/services/conflict-resolution-service'
      );
      const db = await import('../../src/db');

      // Mock soft delete (mark latest version as deleted)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ id: 'deleted-marker' }] });

      const result = await resolveDeletedConflict({
        documentId: 'doc-1',
        targetBranchId: 'target-branch',
        conflictType: 'deleted-in-source',
        strategy: 'take-source',
        resolvedById: 'resolver',
        resolvedByType: 'user',
      });

      expect(result.resolved).toBe(true);
      expect(result.action).toBe('deleted');
    });

    it('should handle deleted-in-source by keeping target when take-target', async () => {
      const { resolveDeletedConflict } = await import(
        '../../src/services/conflict-resolution-service'
      );

      const result = await resolveDeletedConflict({
        documentId: 'doc-1',
        targetBranchId: 'target-branch',
        conflictType: 'deleted-in-source',
        strategy: 'take-target',
        resolvedById: 'resolver',
        resolvedByType: 'user',
      });

      expect(result.resolved).toBe(true);
      expect(result.action).toBe('kept');
    });

    it('should handle deleted-in-target by restoring from source when take-source', async () => {
      const { resolveDeletedConflict } = await import(
        '../../src/services/conflict-resolution-service'
      );
      const docVersionService = await import('../../src/services/document-version-service');

      // Mock source version to restore
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'source-version',
        documentId: 'doc-1',
        branchId: 'source-branch',
        versionNumber: 3,
        snapshot: { title: 'Restored' },
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'restored-version',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 1,
        snapshot: { title: 'Restored' },
        createdAt: '2026-01-20T11:00:00.000Z',
        createdById: 'resolver',
        createdByType: 'user',
        source: 'merge',
      });

      const result = await resolveDeletedConflict({
        documentId: 'doc-1',
        targetBranchId: 'target-branch',
        sourceBranchId: 'source-branch',
        sourceVersionId: 'source-version',
        conflictType: 'deleted-in-target',
        strategy: 'take-source',
        resolvedById: 'resolver',
        resolvedByType: 'user',
      });

      expect(result.resolved).toBe(true);
      expect(result.action).toBe('restored');
    });

    it('should handle deleted-in-target by keeping deleted when take-target', async () => {
      const { resolveDeletedConflict } = await import(
        '../../src/services/conflict-resolution-service'
      );

      const result = await resolveDeletedConflict({
        documentId: 'doc-1',
        targetBranchId: 'target-branch',
        conflictType: 'deleted-in-target',
        strategy: 'take-target',
        resolvedById: 'resolver',
        resolvedByType: 'user',
      });

      expect(result.resolved).toBe(true);
      expect(result.action).toBe('kept-deleted');
    });
  });

  describe('resolveConflict with manual strategy', () => {
    it('should create a version with the provided resolvedSnapshot', async () => {
      const { resolveConflict } = await import('../../src/services/conflict-resolution-service');
      const docVersionService = await import('../../src/services/document-version-service');

      const resolvedSnapshot = { title: 'Manually Merged Title', body: 'Custom content' };

      // Mock version creation
      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'manual-version-id',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 5,
        snapshot: resolvedSnapshot,
        createdAt: '2026-01-20T12:00:00.000Z',
        createdById: 'resolver-user',
        createdByType: 'user',
        source: 'merge',
      });

      const result = await resolveConflict({
        documentId: 'doc-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        sourceVersionId: 'source-version-id',
        targetVersionId: 'target-version-id',
        strategy: 'manual',
        resolvedById: 'resolver-user',
        resolvedByType: 'user',
        resolvedSnapshot,
      });

      expect(result.resolved).toBe(true);
      expect(result.resultVersionId).toBe('manual-version-id');
      expect(result.strategy).toBe('manual');

      // Should NOT fetch source or target version - uses provided snapshot directly
      expect(docVersionService.getDocumentVersion).not.toHaveBeenCalled();

      // Should create new version on target branch with the provided snapshot
      expect(docVersionService.createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          branchId: 'target-branch',
          snapshot: resolvedSnapshot,
          source: 'merge',
        }),
      );
    });

    it('should reject manual strategy without resolvedSnapshot', async () => {
      const { resolveConflict, ManualResolutionError } = await import(
        '../../src/services/conflict-resolution-service'
      );

      await expect(
        resolveConflict({
          documentId: 'doc-1',
          sourceBranchId: 'source-branch',
          targetBranchId: 'target-branch',
          sourceVersionId: 'source-version-id',
          targetVersionId: 'target-version-id',
          strategy: 'manual',
          resolvedById: 'resolver-user',
          resolvedByType: 'user',
          // No resolvedSnapshot provided
        }),
      ).rejects.toThrow(ManualResolutionError);
    });

    it('should include resolution metadata in manual result', async () => {
      const { resolveConflict } = await import('../../src/services/conflict-resolution-service');
      const docVersionService = await import('../../src/services/document-version-service');

      const resolvedSnapshot = { title: 'Resolved' };

      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'new-version-id',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 4,
        snapshot: resolvedSnapshot,
        createdAt: '2026-01-20T12:00:00.000Z',
        createdById: 'resolver-agent',
        createdByType: 'agent',
        source: 'merge',
      });

      const result = await resolveConflict({
        documentId: 'doc-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        sourceVersionId: 'source-version-id',
        targetVersionId: 'target-version-id',
        strategy: 'manual',
        resolvedById: 'resolver-agent',
        resolvedByType: 'agent',
        resolvedSnapshot,
      });

      expect(result.resolvedById).toBe('resolver-agent');
      expect(result.resolvedByType).toBe('agent');
      expect(result.documentId).toBe('doc-1');
    });
  });

  describe('Error Classes', () => {
    it('should export VersionNotFoundError with correct properties', async () => {
      const { VersionNotFoundError } = await import(
        '../../src/services/conflict-resolution-service'
      );

      const error = new VersionNotFoundError('version-123');

      expect(error.name).toBe('VersionNotFoundError');
      expect(error.versionId).toBe('version-123');
      expect(error.message).toContain('version-123');
    });

    it('should export UnsupportedStrategyError with correct properties', async () => {
      const { UnsupportedStrategyError } = await import(
        '../../src/services/conflict-resolution-service'
      );

      const error = new UnsupportedStrategyError('manual');

      expect(error.name).toBe('UnsupportedStrategyError');
      expect(error.strategy).toBe('manual');
      expect(error.message).toContain('manual');
    });
  });
});
