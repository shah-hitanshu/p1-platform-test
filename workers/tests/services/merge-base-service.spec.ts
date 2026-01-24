/**
 * Phase 5.1b: Merge Base Service Tests (TDD)
 *
 * Tests for finding the common ancestor checkpoint between branches.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 5.1b: Merge Base Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('findMergeBase', () => {
    it('should find merge base when source branch was created from target branch', async () => {
      const { findMergeBase } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // Source branch was created from target branch at checkpoint-123
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'source-branch',
              source_branch_id: 'target-branch',
              source_checkpoint_id: 'checkpoint-123',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'checkpoint-123',
              branch_id: 'target-branch',
              created_at: '2026-01-20T10:00:00.000Z',
            },
          ],
        });

      const result = await findMergeBase('source-branch', 'target-branch');

      expect(result).toBeDefined();
      expect(result?.checkpointId).toBe('checkpoint-123');
    });

    it('should find merge base when branches share common ancestor through branch lineage', async () => {
      const { findMergeBase } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // Both branches were created from main at different checkpoints
      // Branch A: created from main at checkpoint-1
      // Branch B: created from main at checkpoint-2
      // Merge base is checkpoint-1 (earlier one)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            merge_base_checkpoint_id: 'checkpoint-1',
            merge_base_branch_id: 'main-branch',
            created_at: '2026-01-15T10:00:00.000Z',
          },
        ],
      });

      const result = await findMergeBase('branch-a', 'branch-b');

      expect(result).toBeDefined();
      expect(result?.checkpointId).toBe('checkpoint-1');
    });

    it('should return null when branches have no common ancestor', async () => {
      const { findMergeBase } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // No common ancestor found
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const result = await findMergeBase('branch-a', 'branch-b');

      expect(result).toBeNull();
    });

    it('should return null when source branch equals target branch', async () => {
      const { findMergeBase } = await import('../../src/services/merge-base-service');

      const result = await findMergeBase('same-branch', 'same-branch');

      expect(result).toBeNull();
    });

    it('should throw SourceBranchNotFoundError when source branch does not exist', async () => {
      const { findMergeBase, SourceBranchNotFoundError } = await import(
        '../../src/services/merge-base-service'
      );
      const db = await import('../../src/db');

      // First query for source branch returns empty
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(findMergeBase('nonexistent', 'target-branch')).rejects.toThrow(
        SourceBranchNotFoundError,
      );
    });

    it('should throw TargetBranchNotFoundError when target branch does not exist', async () => {
      const { findMergeBase, TargetBranchNotFoundError } = await import(
        '../../src/services/merge-base-service'
      );
      const db = await import('../../src/db');

      // First query returns source branch, second returns empty for target
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'source-branch', source_branch_id: null }],
        })
        .mockResolvedValueOnce({ rows: [] });

      await expect(findMergeBase('source-branch', 'nonexistent')).rejects.toThrow(
        TargetBranchNotFoundError,
      );
    });

    it('should include checkpoint metadata in result', async () => {
      const { findMergeBase } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            merge_base_checkpoint_id: 'checkpoint-123',
            merge_base_branch_id: 'main-branch',
            created_at: '2026-01-20T10:00:00.000Z',
            name: 'Release v1.0',
            message: 'Initial release checkpoint',
          },
        ],
      });

      const result = await findMergeBase('feature-branch', 'main-branch');

      expect(result).toEqual({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: '2026-01-20T10:00:00.000Z',
        name: 'Release v1.0',
        message: 'Initial release checkpoint',
      });
    });
  });

  describe('getModifiedDocumentsSince', () => {
    it('should return documents modified on branch since checkpoint', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-1',
            document_path: 'pages/home',
            latest_version_id: 'version-1',
            latest_version_number: 3,
            base_version_id: 'version-base-1',
            base_version_number: 1,
          },
          {
            document_id: 'doc-2',
            document_path: 'pages/about',
            latest_version_id: 'version-2',
            latest_version_number: 2,
            base_version_id: 'version-base-2',
            base_version_number: 1,
          },
        ],
      });

      const result = await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      expect(result).toHaveLength(2);
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].documentPath).toBe('pages/home');
      expect(result[0].latestVersionNumber).toBe(3);
      expect(result[0].baseVersionNumber).toBe(1);
    });

    it('should return empty array when no documents modified', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const result = await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      expect(result).toEqual([]);
    });

    it('should include deleted documents', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-deleted',
            document_path: 'pages/old-page',
            latest_version_id: null,
            latest_version_number: null,
            base_version_id: 'version-base',
            base_version_number: 2,
            is_deleted: true,
          },
        ],
      });

      const result = await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      expect(result).toHaveLength(1);
      expect(result[0].isDeleted).toBe(true);
    });
  });

  describe('getDocumentsAtCheckpoint', () => {
    it('should return all document versions at checkpoint', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-1',
            document_path: 'pages/home',
            version_id: 'version-1',
            version_number: 2,
            snapshot: { title: 'Home Page' },
          },
          {
            document_id: 'doc-2',
            document_path: 'pages/about',
            version_id: 'version-2',
            version_number: 1,
            snapshot: { title: 'About Us' },
          },
        ],
      });

      const result = await getDocumentsAtCheckpoint('checkpoint-id');

      expect(result).toHaveLength(2);
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].snapshot).toEqual({ title: 'Home Page' });
    });

    it('should return empty array for checkpoint with no documents', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const result = await getDocumentsAtCheckpoint('checkpoint-id');

      expect(result).toEqual([]);
    });
  });

  describe('getBranchLineage', () => {
    it('should return branch lineage from current to root', async () => {
      const { getBranchLineage } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // Branch created from main, main is root (no source)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          { id: 'feature-branch', source_branch_id: 'main-branch', depth: 1 },
          { id: 'main-branch', source_branch_id: null, depth: 0 },
        ],
      });

      const result = await getBranchLineage('feature-branch');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('feature-branch');
      expect(result[1].id).toBe('main-branch');
    });

    it('should return single branch for root branch (main)', async () => {
      const { getBranchLineage } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'main-branch', source_branch_id: null, depth: 0 }],
      });

      const result = await getBranchLineage('main-branch');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('main-branch');
    });

    it('should handle deep branch hierarchies', async () => {
      const { getBranchLineage } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          { id: 'feature-sub-branch', source_branch_id: 'feature-branch', depth: 2 },
          { id: 'feature-branch', source_branch_id: 'main-branch', depth: 1 },
          { id: 'main-branch', source_branch_id: null, depth: 0 },
        ],
      });

      const result = await getBranchLineage('feature-sub-branch');

      expect(result).toHaveLength(3);
    });
  });

  describe('Error Classes', () => {
    it('should export SourceBranchNotFoundError with correct properties', async () => {
      const { SourceBranchNotFoundError } = await import('../../src/services/merge-base-service');

      const error = new SourceBranchNotFoundError('branch-uuid');

      expect(error.name).toBe('SourceBranchNotFoundError');
      expect(error.branchId).toBe('branch-uuid');
    });

    it('should export TargetBranchNotFoundError with correct properties', async () => {
      const { TargetBranchNotFoundError } = await import('../../src/services/merge-base-service');

      const error = new TargetBranchNotFoundError('branch-uuid');

      expect(error.name).toBe('TargetBranchNotFoundError');
      expect(error.branchId).toBe('branch-uuid');
    });
  });

  describe('MergeBase type', () => {
    it('should have correct structure', async () => {
      const { findMergeBase } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            merge_base_checkpoint_id: 'cp-123',
            merge_base_branch_id: 'branch-456',
            created_at: '2026-01-20T10:00:00.000Z',
            name: null,
            message: null,
          },
        ],
      });

      const result = await findMergeBase('source', 'target');

      expect(result).toHaveProperty('checkpointId');
      expect(result).toHaveProperty('branchId');
      expect(result).toHaveProperty('createdAt');
    });
  });
});
