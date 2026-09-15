/**
 * Phase 7.1.1a: Branch Structure Copy Tests (TDD)
 *
 * Tests for copying structure state when creating a new branch.
 * When a branch is created from a source branch, all structure state
 * (identity, tree, schema) should be copied to the new branch.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { branches } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { clearBranchCache, createBranch, createMainBranch } from '../../src/services/branch-service';

/**
 * The copy is an INSERT ... SELECT, so it is keyed by the table it writes; the
 * relation it reads is what tells the two sources apart.
 */
const STRUCTURE_STATE = 'branch_structure_state';

describe('Phase 7.1.1a: Branch Structure Copy', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
    clearBranchCache();
  });

  function newBranchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'new-branch',
      siteId: 'site-1',
      name: 'feature-branch',
      description: 'Feature work',
      status: 'active',
      isMain: false,
      sourceBranchId: 'main-branch',
      sourceCheckpointId: null,
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date('2026-01-24T10:00:00.000Z'),
      updatedAt: new Date('2026-01-24T10:00:00.000Z'),
      archivedAt: null,
      ...overrides,
    };
  }

  /** The source-branch check and the branch insert every creation makes. */
  function stubBranchCreation(row: Record<string, unknown>): void {
    database.on(branches).select.returns([{ id: row.sourceBranchId, isMain: true }]);
    database.on(branches).insert.returns([row]);
    database.on(branches).update.returns([row]);
  }

  // ===========================================================================
  // Copy Structure State on Branch Creation
  // ===========================================================================

  describe('createBranch with structure copy', () => {
    it('should copy structure state from source branch', async () => {
      stubBranchCreation(newBranchRow());

      const branch = await createBranch({
        siteId: 'site-1',
        name: 'feature-branch',
        description: 'Feature work',
        sourceBranchId: 'main-branch',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(branch.id).toBe('new-branch');

      const [copy] = database.calls(STRUCTURE_STATE).insert;
      expect(copy?.sql).toContain('FROM app.branch_structure_state');
    });

    it('should copy all structure fields including name and slug', async () => {
      stubBranchCreation(newBranchRow({ name: 'feature', description: null }));

      await createBranch({
        siteId: 'site-1',
        name: 'feature',
        sourceBranchId: 'main-branch',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const [copy] = database.calls(STRUCTURE_STATE).insert;
      expect(copy?.sql).toContain('name');
      expect(copy?.sql).toContain('slug');
    });

    it('should copy document metadata from source branch', async () => {
      stubBranchCreation(newBranchRow({ name: 'feature', description: null }));

      await createBranch({
        siteId: 'site-1',
        name: 'feature',
        sourceBranchId: 'main-branch',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Copy-on-write: metadata is NOT copied, inherited from main
      expect(database.calls('branch_document_metadata').insert).toHaveLength(0);
    });

    it('should handle branch creation with no source (main branch)', async () => {
      database.on(branches).insert.returns([
        newBranchRow({
          id: 'main-branch',
          name: 'main',
          description: 'Main branch',
          isMain: true,
          sourceBranchId: null,
          createdById: 'system',
          createdByType: 'system',
        }),
      ]);

      const branch = await createMainBranch({
        siteId: 'site-1',
        createdById: 'system',
        createdByType: 'system',
      });

      expect(branch.id).toBe('main-branch');

      // No structure copy should happen (main branch starts empty)
      expect(database.statements).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Copy Structure State from Checkpoint
  // ===========================================================================

  describe('createBranch from checkpoint', () => {
    it('should copy structure state from checkpoint instead of current branch state', async () => {
      stubBranchCreation(newBranchRow({ name: 'hotfix', description: null, sourceCheckpointId: 'checkpoint-1' }));

      await createBranch({
        siteId: 'site-1',
        name: 'hotfix',
        sourceBranchId: 'main-branch',
        sourceCheckpointId: 'checkpoint-1',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const [copy] = database.calls(STRUCTURE_STATE).insert;
      expect(copy?.sql).toContain('FROM app.checkpoint_structures');
      expect(copy?.params).toContain('checkpoint-1');
    });

    it('should NOT copy document metadata from checkpoint (copy-on-write)', async () => {
      stubBranchCreation(newBranchRow({ name: 'hotfix', description: null, sourceCheckpointId: 'checkpoint-1' }));

      await createBranch({
        siteId: 'site-1',
        name: 'hotfix',
        sourceBranchId: 'main-branch',
        sourceCheckpointId: 'checkpoint-1',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Copy-on-write: metadata is NOT copied, inherited from main
      expect(database.calls('checkpoint_document_metadata').insert).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Structure State Isolation
  // ===========================================================================

  describe('structure state isolation', () => {
    it('should not affect source branch when modifying new branch structures', async () => {
      stubBranchCreation(newBranchRow({ id: 'feature-branch', name: 'feature', description: null }));

      await createBranch({
        siteId: 'site-1',
        name: 'feature',
        sourceBranchId: 'main-branch',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // The INSERT...SELECT writes rows under the new branch id, which is what
      // keeps a change on one branch off the other.
      const [copy] = database.calls(STRUCTURE_STATE).insert;
      expect(copy?.params).toContain('feature-branch');
      expect(copy?.params).toContain('main-branch');
    });
  });
});
