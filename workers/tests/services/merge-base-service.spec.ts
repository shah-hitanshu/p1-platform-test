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

      // Mock: source branch exists, target branch exists, then merge base query
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
              id: 'target-branch',
              source_branch_id: null,
              source_checkpoint_id: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              merge_base_checkpoint_id: 'checkpoint-123',
              merge_base_branch_id: 'target-branch',
              created_at: '2026-01-20T10:00:00.000Z',
              name: null,
              message: null,
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

      // Mock: source branch exists, target branch exists, then merge base query
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'branch-a', source_branch_id: 'main-branch', source_checkpoint_id: 'checkpoint-1' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'branch-b', source_branch_id: 'main-branch', source_checkpoint_id: 'checkpoint-2' }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              merge_base_checkpoint_id: 'checkpoint-1',
              merge_base_branch_id: 'main-branch',
              created_at: '2026-01-15T10:00:00.000Z',
              name: null,
              message: null,
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

      // Mock: source branch exists, target branch exists, then no common ancestor
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'branch-a', source_branch_id: null, source_checkpoint_id: null }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'branch-b', source_branch_id: null, source_checkpoint_id: null }],
        })
        .mockResolvedValueOnce({ rows: [] });

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

      // Mock: source branch exists, target branch exists, then merge base query
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'feature-branch', source_branch_id: 'main-branch', source_checkpoint_id: 'checkpoint-123' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'main-branch', source_branch_id: null, source_checkpoint_id: null }],
        })
        .mockResolvedValueOnce({
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

    it('should exclude documents with only source=branch versions (unmodified copies)', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // The SQL should filter out branch-copy rows. We verify by checking
      // that the SQL includes the source column and exclusion filter.
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          // Only genuinely modified doc should be returned
          {
            document_id: 'doc-edited',
            document_path: 'pages/edited',
            latest_version_id: 'v-edited',
            latest_version_number: 2,
            base_version_id: 'v-base',
            base_version_number: 1,
            is_deleted: false,
          },
        ],
      });

      const result = await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      // Verify the SQL query includes source column and branch-copy exclusion
      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      expect(sqlArg).toContain('dv.source');
      expect(sqlArg).toContain('cv.source');

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-edited');
    });

    it('should include documents with source=edit versions (genuinely modified)', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-edited',
            document_path: 'pages/edited',
            latest_version_id: 'v-edited',
            latest_version_number: 3,
            base_version_id: 'v-base',
            base_version_number: 1,
            is_deleted: false,
          },
        ],
      });

      const result = await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-edited');
      expect(result[0].latestVersionNumber).toBe(3);
    });

    it('should mark archived documents as isDeleted true', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-archived',
            document_path: 'pages/archived-page',
            latest_version_id: 'v-latest',
            latest_version_number: 2,
            base_version_id: 'v-base',
            base_version_number: 1,
            is_deleted: true,
          },
        ],
      });

      const result = await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      expect(result).toHaveLength(1);
      expect(result[0].isDeleted).toBe(true);
      expect(result[0].documentPath).toBe('pages/archived-page');

      // Verify the SQL checks archived_at for deletion detection
      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      expect(sqlArg).toContain('archived_at');
    });

    it('should include documents in checkpoint but not on branch as deleted', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-missing',
            document_path: 'pages/removed',
            latest_version_id: null,
            latest_version_number: null,
            base_version_id: 'v-base',
            base_version_number: 1,
            is_deleted: true,
          },
        ],
      });

      const result = await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-missing');
      expect(result[0].isDeleted).toBe(true);
      expect(result[0].latestVersionId).toBeNull();
    });

    it('should use SQL that filters out unmodified branch copies', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      // Verify the SQL excludes branch copies that are not archived and exist in checkpoint
      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      expect(sqlArg).toMatch(/cv\.source\s*=\s*'branch'/);
      expect(sqlArg).toContain('archived_at');
    });

    it('should resolve full checkpoint state at merge base time for source branch queries (issue #34)', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // The checkpoint_docs CTE for non-publishedOnly queries also needs to
      // resolve the full state at the merge base time, not just the single
      // checkpoint's documents. Otherwise COW-copied documents on the source
      // branch appear as "new" when the merge base checkpoint is empty.
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getModifiedDocumentsSince('source-branch', 'merge-base-checkpoint-id');

      const sqlArg = vi.mocked(db.query).mock.calls[0][0];

      // checkpoint_docs must resolve the full state, not just checkpoint_id = $2
      expect(sqlArg).not.toMatch(/checkpoint_docs[\s\S]*?WHERE\s+cd\.checkpoint_id\s*=\s*\$2\s*\)/);
      expect(sqlArg).toContain('cp.created_at');
    });

    it('should exclude archived documents not in checkpoint (created then deleted, net-zero)', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // The SQL should filter out documents created after checkpoint and then archived
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      // Verify the SQL excludes net-zero archived documents
      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      expect(sqlArg).toMatch(/cd\.document_id IS NULL AND d\.archived_at IS NOT NULL/);
    });

    it('should NOT treat inherited documents as deleted on COW branches', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // With COW branching, inherited documents (in checkpoint but no local version
      // on the branch) should NOT appear as deleted. The query should NOT use
      // FULL OUTER JOIN which would surface inherited docs as "missing on branch."
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      // The SQL must NOT use FULL OUTER JOIN — inherited docs should be invisible
      expect(db.query).toHaveBeenCalledWith(
        expect.not.stringContaining('FULL OUTER JOIN'),
        expect.any(Array),
      );
      // It should start from current_versions (LEFT JOIN or INNER JOIN)
      expect(sqlArg).toContain('current_versions');
    });

    it('should detect tombstoned documents via is_tombstone column', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // With COW, tombstone detection uses snapshot->>'_deleted' = 'true'
      // instead of relying on cv.version_id IS NULL (which conflates
      // inherited-but-not-locally-versioned with actually-deleted).
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-tombstoned',
            document_path: 'pages/removed',
            latest_version_id: 'v-tombstone',
            latest_version_number: 3,
            base_version_id: 'v-base',
            base_version_number: 1,
            is_deleted: true,
          },
        ],
      });

      const result = await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      // The result should mark it as deleted
      expect(result).toHaveLength(1);
      expect(result[0].isDeleted).toBe(true);
      // The tombstoned doc has a version_id (it's a tombstone version, not absence)
      expect(result[0].latestVersionId).toBe('v-tombstone');

      // Verify the SQL uses snapshot-based tombstone detection
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('is_tombstone'),
        expect.any(Array),
      );
    });
  });

  describe('getModifiedDocumentsSince with publishedOnly option', () => {
    it('should use checkpoint_documents for current state when publishedOnly is true', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-1',
            document_path: 'pages/home',
            latest_version_id: 'published-v1',
            latest_version_number: 2,
            base_version_id: 'v-base',
            base_version_number: 1,
            is_deleted: false,
          },
        ],
      });

      const result = await getModifiedDocumentsSince('main-branch', 'checkpoint-id', {
        publishedOnly: true,
      });

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-1');

      // Verify the SQL uses checkpoint_documents to find published versions
      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      expect(sqlArg).toContain('checkpoint_documents');
      expect(sqlArg).toContain('checkpoints');
    });

    it('should not include unpublished edits when publishedOnly is true', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // When publishedOnly is true, the SQL should join on checkpoint_documents
      // so only published versions are considered as "current state"
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getModifiedDocumentsSince('main-branch', 'checkpoint-id', {
        publishedOnly: true,
      });

      // The SQL should reference checkpoint_documents for the current versions CTE
      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      expect(sqlArg).toContain('checkpoint_documents');
      // Should NOT use raw document_versions for current state
      // (the checkpoint_docs CTE still references document_versions for the base)
    });

    it('should use raw document_versions when publishedOnly is false', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getModifiedDocumentsSince('branch-id', 'checkpoint-id', {
        publishedOnly: false,
      });

      // Verify it uses the original query (no checkpoint_documents in current_versions)
      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      // The checkpoint_docs CTE always references checkpoint_documents for the base,
      // but the current_versions CTE should use document_versions directly
      expect(sqlArg).toContain('current_versions');
    });

    it('should default to publishedOnly false when no options provided', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      // Call without options (existing behavior)
      await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      // Should produce the same SQL as publishedOnly: false
      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      expect(sqlArg).toContain('current_versions');
    });

    it('should resolve full published state at merge base time, not just single checkpoint docs (issue #34)', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // When a merge base checkpoint is incremental/empty (has 0 documents),
      // the checkpoint_docs CTE must resolve ALL checkpoints on the branch
      // at or before the merge base time, not just the single checkpoint.
      // Otherwise, documents published before the merge base appear as "new"
      // on the target branch, causing false positive conflicts.
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getModifiedDocumentsSince('main-branch', 'merge-base-checkpoint-id', {
        publishedOnly: true,
      });

      const sqlArg = vi.mocked(db.query).mock.calls[0][0];

      // The checkpoint_docs CTE must NOT simply filter by checkpoint_id = $2
      // It must resolve the full published state at the merge base checkpoint time
      // by looking at all checkpoints on the branch at or before that time
      expect(sqlArg).not.toMatch(/checkpoint_docs[\s\S]*?WHERE\s+cd\.checkpoint_id\s*=\s*\$2\s*\)/);

      // It should reference the branch_id ($1) and use a time-based filter
      // to get the full published state at the merge base point
      expect(sqlArg).toContain('cp.created_at');
      expect(sqlArg).toContain('checkpoint_docs');
    });

    it('should not report document as modified when it was published before merge base and unchanged since (issue #34)', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // Scenario: document published at version 78 on main in an older checkpoint.
      // Merge base checkpoint (created when branch forked) is empty/incremental.
      // The publishedOnly query should NOT report this document as "new" on main.
      // With the fix, checkpoint_docs resolves the full state and finds version 78
      // matching current_versions version 78 → no difference → not returned.
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const result = await getModifiedDocumentsSince('main-branch', 'merge-base-checkpoint-id', {
        publishedOnly: true,
      });

      // The SQL must use DISTINCT ON with checkpoint ordering to get the latest
      // published version of each document at or before the merge base time
      const sqlArg = vi.mocked(db.query).mock.calls[0][0];
      expect(sqlArg).toMatch(/checkpoint_docs[\s\S]*?DISTINCT ON/);
      expect(sqlArg).toMatch(/checkpoint_docs[\s\S]*?cp\.created_at/);

      expect(result).toEqual([]);
    });

    it('should detect new published documents since checkpoint when publishedOnly is true', async () => {
      const { getModifiedDocumentsSince } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      // A document that was published on main after the merge base checkpoint
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-new',
            document_path: 'pages/new-page',
            latest_version_id: 'published-v1',
            latest_version_number: 1,
            base_version_id: null,
            base_version_number: null,
            is_deleted: false,
          },
        ],
      });

      const result = await getModifiedDocumentsSince('main-branch', 'checkpoint-id', {
        publishedOnly: true,
      });

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-new');
      expect(result[0].baseVersionId).toBeNull();
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

      // Mock: source branch exists, target branch exists, then merge base query
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'source', source_branch_id: 'target', source_checkpoint_id: 'cp-123' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'target', source_branch_id: null, source_checkpoint_id: null }],
        })
        .mockResolvedValueOnce({
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

  describe('Simplified Merge Base (Main-Only Branching)', () => {
    it('should find merge base using source branch source_checkpoint_id directly', async () => {
      const { findMergeBase } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'feature-branch', source_branch_id: 'main-branch', source_checkpoint_id: 'checkpoint-123', is_main: false }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'main-branch', source_branch_id: null, source_checkpoint_id: null, is_main: true }],
        })
        .mockResolvedValueOnce({
          rows: [{
            merge_base_checkpoint_id: 'checkpoint-123',
            merge_base_branch_id: 'main-branch',
            created_at: '2026-01-20T10:00:00.000Z',
            name: null,
            message: null,
          }],
        });

      const result = await findMergeBase('feature-branch', 'main-branch');

      expect(result).toBeDefined();
      expect(result?.checkpointId).toBe('checkpoint-123');
      expect(result?.branchId).toBe('main-branch');
    });

    it('should return null when source branch has no source_checkpoint_id', async () => {
      const { findMergeBase } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'feature-branch', source_branch_id: 'main-branch', source_checkpoint_id: null, is_main: false }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'main-branch', source_branch_id: null, source_checkpoint_id: null, is_main: true }],
        });

      const result = await findMergeBase('feature-branch', 'main-branch');

      expect(result).toBeNull();
    });

    it('should not use recursive CTE for merge base calculation', async () => {
      const { findMergeBase } = await import('../../src/services/merge-base-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'feature-branch', source_branch_id: 'main-branch', source_checkpoint_id: 'cp-1', is_main: false }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'main-branch', source_branch_id: null, source_checkpoint_id: null, is_main: true }],
        })
        .mockResolvedValueOnce({
          rows: [{
            merge_base_checkpoint_id: 'cp-1',
            merge_base_branch_id: 'main-branch',
            created_at: '2026-01-20T10:00:00.000Z',
            name: null,
            message: null,
          }],
        });

      await findMergeBase('feature-branch', 'main-branch');

      const allCalls = vi.mocked(db.query).mock.calls;
      for (const call of allCalls) {
        if (typeof call[0] === 'string') {
          expect(call[0]).not.toContain('WITH RECURSIVE');
        }
      }
    });
  });
});
