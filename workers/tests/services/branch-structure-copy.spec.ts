/**
 * Phase 7.1.1a: Branch Structure Copy Tests (TDD)
 *
 * Tests for copying structure state when creating a new branch.
 * When a branch is created from a source branch, all structure state
 * (identity, tree, schema) should be copied to the new branch.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 7.1.1a: Branch Structure Copy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Copy Structure State on Branch Creation
  // ===========================================================================

  describe('createBranch with structure copy', () => {
    /**
     * Helper to set up mocks for createBranch.
     * The function now uses a transaction with structure and metadata copy.
     */
    function setupBranchMocks(
      db: { query: ReturnType<typeof vi.fn> },
      branchRow: Record<string, unknown>,
    ): void {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [branchRow] }) // INSERT branch
        .mockResolvedValueOnce({ rows: [] }) // structure copy
        .mockResolvedValueOnce({ rows: [] }) // metadata copy
        .mockResolvedValueOnce({ rows: [] }); // COMMIT
    }

    it('should copy structure state from source branch', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      setupBranchMocks(db, {
        id: 'new-branch',
        site_id: 'site-1',
        name: 'feature-branch',
        description: 'Feature work',
        status: 'active',
        is_main: false,
        source_branch_id: 'main-branch',
        source_checkpoint_id: null,
        created_by_id: 'user-1',
        created_by_type: 'user',
        created_at: '2026-01-24T10:00:00.000Z',
        updated_at: '2026-01-24T10:00:00.000Z',
      });

      const branch = await createBranch({
        siteId: 'site-1',
        name: 'feature-branch',
        description: 'Feature work',
        sourceBranchId: 'main-branch',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(branch.id).toBe('new-branch');

      // Verify structure copy was called
      const structureCopyCall = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('branch_structure_state') &&
          call[0].includes('INSERT') &&
          call[0].includes('SELECT'),
      );
      expect(structureCopyCall).toBeDefined();
    });

    it('should copy all structure fields including name and slug', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      setupBranchMocks(db, {
        id: 'new-branch',
        site_id: 'site-1',
        name: 'feature',
        description: null,
        status: 'active',
        is_main: false,
        source_branch_id: 'main-branch',
        source_checkpoint_id: null,
        created_by_id: 'user-1',
        created_by_type: 'user',
        created_at: '2026-01-24T10:00:00.000Z',
        updated_at: '2026-01-24T10:00:00.000Z',
      });

      await createBranch({
        siteId: 'site-1',
        name: 'feature',
        sourceBranchId: 'main-branch',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Verify the INSERT...SELECT includes name and slug columns
      const copyQuery = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('branch_structure_state') &&
          call[0].includes('name') &&
          call[0].includes('slug'),
      );
      expect(copyQuery).toBeDefined();
    });

    it('should copy document metadata from source branch', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      setupBranchMocks(db, {
        id: 'new-branch',
        site_id: 'site-1',
        name: 'feature',
        description: null,
        status: 'active',
        is_main: false,
        source_branch_id: 'main-branch',
        source_checkpoint_id: null,
        created_by_id: 'user-1',
        created_by_type: 'user',
        created_at: '2026-01-24T10:00:00.000Z',
        updated_at: '2026-01-24T10:00:00.000Z',
      });

      await createBranch({
        siteId: 'site-1',
        name: 'feature',
        sourceBranchId: 'main-branch',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Verify metadata copy was called
      const metadataCopyCall = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('branch_document_metadata') &&
          call[0].includes('INSERT'),
      );
      expect(metadataCopyCall).toBeDefined();
    });

    it('should handle branch creation with no source (main branch)', async () => {
      const { createMainBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'main-branch',
            site_id: 'site-1',
            name: 'main',
            description: 'Main branch',
            status: 'active',
            is_main: true,
            source_branch_id: null,
            source_checkpoint_id: null,
            created_by_id: 'system',
            created_by_type: 'system',
            created_at: '2026-01-24T10:00:00.000Z',
            updated_at: '2026-01-24T10:00:00.000Z',
          },
        ],
      });

      const branch = await createMainBranch({
        siteId: 'site-1',
        createdById: 'system',
        createdByType: 'system',
      });

      expect(branch.id).toBe('main-branch');

      // No structure copy should happen (main branch starts empty)
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Copy Structure State from Checkpoint
  // ===========================================================================

  describe('createBranch from checkpoint', () => {
    /**
     * Helper for checkpoint-based branch creation mocks.
     */
    function setupCheckpointBranchMocks(
      db: { query: ReturnType<typeof vi.fn> },
      branchRow: Record<string, unknown>,
    ): void {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [branchRow] }) // INSERT branch
        .mockResolvedValueOnce({ rows: [] }) // structure copy from checkpoint
        .mockResolvedValueOnce({ rows: [] }) // metadata copy from checkpoint
        .mockResolvedValueOnce({ rows: [] }); // COMMIT
    }

    it('should copy structure state from checkpoint instead of current branch state', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      setupCheckpointBranchMocks(db, {
        id: 'new-branch',
        site_id: 'site-1',
        name: 'hotfix',
        description: null,
        status: 'active',
        is_main: false,
        source_branch_id: 'main-branch',
        source_checkpoint_id: 'checkpoint-1',
        created_by_id: 'user-1',
        created_by_type: 'user',
        created_at: '2026-01-24T10:00:00.000Z',
        updated_at: '2026-01-24T10:00:00.000Z',
      });

      await createBranch({
        siteId: 'site-1',
        name: 'hotfix',
        sourceBranchId: 'main-branch',
        sourceCheckpointId: 'checkpoint-1',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Verify structure copy references checkpoint_structures, not branch_structure_state
      const copyQuery = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('checkpoint_structures') &&
          call[0].includes('SELECT'),
      );
      expect(copyQuery).toBeDefined();
    });

    it('should copy document metadata from checkpoint', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      setupCheckpointBranchMocks(db, {
        id: 'new-branch',
        site_id: 'site-1',
        name: 'hotfix',
        description: null,
        status: 'active',
        is_main: false,
        source_branch_id: 'main-branch',
        source_checkpoint_id: 'checkpoint-1',
        created_by_id: 'user-1',
        created_by_type: 'user',
        created_at: '2026-01-24T10:00:00.000Z',
        updated_at: '2026-01-24T10:00:00.000Z',
      });

      await createBranch({
        siteId: 'site-1',
        name: 'hotfix',
        sourceBranchId: 'main-branch',
        sourceCheckpointId: 'checkpoint-1',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Verify metadata copy references checkpoint_document_metadata
      const metadataCopyQuery = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('checkpoint_document_metadata') &&
          call[0].includes('SELECT'),
      );
      expect(metadataCopyQuery).toBeDefined();
    });
  });

  // ===========================================================================
  // Structure State Isolation
  // ===========================================================================

  describe('structure state isolation', () => {
    it('should not affect source branch when modifying new branch structures', async () => {
      // This is a conceptual test - the copy creates independent rows
      // Modifying new branch's branch_structure_state should not affect source

      const db = await import('../../src/db');
      const { createBranch } = await import('../../src/services/branch-service');

      // Create branch with proper mocks
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'feature-branch',
              site_id: 'site-1',
              name: 'feature',
              description: null,
              status: 'active',
              is_main: false,
              source_branch_id: 'main-branch',
              source_checkpoint_id: null,
              created_by_id: 'user-1',
              created_by_type: 'user',
              created_at: '2026-01-24T10:00:00.000Z',
              updated_at: '2026-01-24T10:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // structure copy
        .mockResolvedValueOnce({ rows: [] }) // metadata copy
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await createBranch({
        siteId: 'site-1',
        name: 'feature',
        sourceBranchId: 'main-branch',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // The INSERT...SELECT creates new rows with the new branch_id
      // This ensures isolation - changes to feature-branch rows don't affect main-branch rows
      const copyCall = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT') &&
          call[0].includes('branch_structure_state'),
      );

      expect(copyCall).toBeDefined();
      // The query should substitute the new branch ID, not keep the source branch ID
      expect(copyCall?.[1]).toContain('feature-branch');
    });
  });
});
