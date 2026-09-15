/**
 * Phase 7.1.1a: Checkpoint Structure Capture Tests (TDD)
 *
 * Tests for capturing and restoring structure state in checkpoints.
 * Structure identity (name, slug) is now captured alongside tree and schema.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  branchDocumentMetadata,
  branchStructureState,
  checkpointDocumentMetadata,
  checkpoints,
  checkpointStructures,
} from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

/** RETURNING * on the raw checkpoint INSERT, so the row is in column names. */
function checkpointRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'checkpoint-1',
    branch_id: 'branch-1',
    checkpoint_type: 'manual',
    created_by_id: 'user-1',
    created_by_type: 'user',
    created_at: '2026-01-24T10:00:00.000Z',
    ...overrides,
  };
}

describe('Phase 7.1.1a: Checkpoint Structure Capture', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    database = stubDatabase();
    database.on(checkpoints).insert.returnsRaw([checkpointRow()]);
  });

  // ===========================================================================
  // Capture Structure State in Checkpoint
  // ===========================================================================

  describe('createCheckpoint with structure capture', () => {
    it('should capture structure identity in checkpoint_structures', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      const result = await createCheckpoint({
        branchId: 'branch-1',
        name: 'v1.0',
        message: 'Release checkpoint',
        checkpointType: 'manual',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(result.checkpoint.id).toBe('checkpoint-1');
      expect(database.calls(checkpointStructures).insert).toHaveLength(1);
    });

    it('should capture structure name and slug in checkpoint', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      await createCheckpoint({
        branchId: 'branch-1',
        checkpointType: 'manual',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Identity travels with the tree: a revert that restored only the tree
      // would leave a renamed structure renamed.
      const [capture] = database.calls(checkpointStructures).insert;
      expect(capture.sql).toContain('name');
      expect(capture.sql).toContain('slug');
    });
  });

  // ===========================================================================
  // Retrieve Structure State from Checkpoint
  // ===========================================================================

  describe('getStructuresAtCheckpoint', () => {
    it('should return all structures captured at checkpoint', async () => {
      const { getStructuresAtCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpointStructures).select.returnsRaw([
        {
          checkpointId: 'checkpoint-1',
          structureId: 'struct-1',
          name: 'Navigation',
          slug: 'nav',
          description: null,
          structureType: 'hierarchy',
          structureTree: [{ id: 'node-1', name: 'Home' }],
          metadataSchema: { type: 'object' },
          schemaEnforcement: 'warn',
        },
        {
          checkpointId: 'checkpoint-1',
          structureId: 'struct-2',
          name: 'Blog',
          slug: 'blog',
          description: null,
          structureType: 'collection',
          structureTree: [],
          metadataSchema: { type: 'object' },
          schemaEnforcement: 'none',
        },
      ]);

      const structures = await getStructuresAtCheckpoint('checkpoint-1');

      expect(structures).toHaveLength(2);
      expect(structures[0].name).toBe('Navigation');
      expect(structures[0].slug).toBe('nav');
      expect(structures[1].name).toBe('Blog');
      expect(structures[1].slug).toBe('blog');
    });

    it('should return empty array when no structures in checkpoint', async () => {
      const { getStructuresAtCheckpoint } = await import('../../src/services/checkpoint-service');

      const structures = await getStructuresAtCheckpoint('checkpoint-1');

      expect(structures).toEqual([]);
    });
  });

  describe('getStructureAtCheckpoint', () => {
    it('should return specific structure state at checkpoint', async () => {
      const { getStructureAtCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpointStructures).select.returnsRaw([
        {
          checkpointId: 'checkpoint-1',
          structureId: 'struct-1',
          name: 'blogs',
          slug: 'blogs',
          description: null,
          structureType: 'collection',
          structureTree: [
            { id: 'node-1', name: 'Post 1' },
            { id: 'node-2', name: 'Post 2' },
          ],
          metadataSchema: { type: 'object', properties: { title: { type: 'string' } } },
          schemaEnforcement: 'strict',
        },
      ]);

      const structure = await getStructureAtCheckpoint('checkpoint-1', 'struct-1');

      expect(structure).not.toBeNull();
      expect(structure?.name).toBe('blogs');
      expect(structure?.slug).toBe('blogs');
      expect(structure?.structureTree).toHaveLength(2);
    });

    it('should return null when structure not in checkpoint', async () => {
      const { getStructureAtCheckpoint } = await import('../../src/services/checkpoint-service');

      const structure = await getStructureAtCheckpoint('checkpoint-1', 'nonexistent');

      expect(structure).toBeNull();
    });
  });

  // ===========================================================================
  // Revert to Checkpoint (including structure state)
  // ===========================================================================

  describe('revertToCheckpoint with structure restore', () => {
    beforeEach(() => {
      database.on(checkpoints).select.returnsRaw([
        { id: 'checkpoint-1', branchId: 'branch-1', checkpointType: 'manual' },
      ]);
      database.on(checkpointStructures).select.returnsRaw([
        {
          checkpointId: 'checkpoint-1',
          structureId: 'struct-1',
          name: 'blogs',
          slug: 'blogs',
          description: null,
          structureType: 'collection',
          structureTree: [{ id: 'node-1' }],
          metadataSchema: {},
          schemaEnforcement: 'warn',
        },
      ]);
    });

    it('should restore structure identity from checkpoint', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      await revertToCheckpoint({
        checkpointId: 'checkpoint-1',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(database.calls(branchStructureState).insert).toHaveLength(1);
    });

    it('should restore structure name and slug to checkpoint values', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      await revertToCheckpoint({
        checkpointId: 'checkpoint-1',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const [restore] = database.calls(branchStructureState).insert;
      expect(restore.sql).toContain('cs.name');
      expect(restore.sql).toContain('cs.slug');
    });

    it('should delete current structure state before restoring', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      await revertToCheckpoint({
        checkpointId: 'checkpoint-1',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Restoring over rows the branch still holds would merge two states, so
      // the order of these two is the invariant, not their presence.
      const deleteIndex = database.statements.findIndex(
        (call) => call.sql.includes('delete from') && call.sql.includes('branch_structure_state'),
      );
      const insertIndex = database.statements.findIndex(
        (call) => call.sql.includes('INSERT INTO app.branch_structure_state'),
      );

      expect(deleteIndex).toBeGreaterThanOrEqual(0);
      expect(deleteIndex).toBeLessThan(insertIndex);
    });
  });

  // ===========================================================================
  // Document Metadata Capture/Restore
  // ===========================================================================

  describe('checkpoint document metadata', () => {
    it('should capture document metadata in checkpoint', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      await createCheckpoint({
        branchId: 'branch-1',
        checkpointType: 'manual',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(database.calls(checkpointDocumentMetadata).insert).toHaveLength(1);
    });

    it('should restore document metadata on revert', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([
        { id: 'checkpoint-1', branchId: 'branch-1', checkpointType: 'manual' },
      ]);

      await revertToCheckpoint({
        checkpointId: 'checkpoint-1',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(database.calls(branchDocumentMetadata).insert).toHaveLength(1);
    });
  });
});
