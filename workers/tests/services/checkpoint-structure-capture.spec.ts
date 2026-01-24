/**
 * Phase 7.1.1a: Checkpoint Structure Capture Tests (TDD)
 *
 * Tests for capturing and restoring structure state in checkpoints.
 * Structure identity (name, slug) is now captured alongside tree and schema.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 7.1.1a: Checkpoint Structure Capture', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Capture Structure State in Checkpoint
  // ===========================================================================

  describe('createCheckpoint with structure capture', () => {
    it('should capture structure identity in checkpoint_structures', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      // Mock checkpoint creation
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'checkpoint-1',
            branch_id: 'branch-1',
            name: 'v1.0',
            checkpoint_type: 'manual',
            created_by_id: 'user-1',
            created_by_type: 'user',
            created_at: '2026-01-24T10:00:00.000Z',
          },
        ],
      });

      // Mock document version capture (existing behavior)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      // Mock structure state capture
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            structure_id: 'struct-1',
            name: 'Navigation',
            slug: 'nav',
            structure_type: 'hierarchy',
            structure_tree: [{ id: 'node-1', name: 'Home' }],
            metadata_schema: { type: 'object' },
            schema_enforcement: 'warn',
          },
        ],
      });

      const checkpoint = await createCheckpoint({
        branchId: 'branch-1',
        name: 'v1.0',
        message: 'Release checkpoint',
        checkpointType: 'manual',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(checkpoint.id).toBe('checkpoint-1');

      // Verify structure capture query was called
      const calls = vi.mocked(db.query).mock.calls;
      const structureCaptureCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('checkpoint_structures') &&
          call[0].includes('INSERT')
      );
      expect(structureCaptureCall).toBeDefined();
    });

    it('should capture structure name and slug in checkpoint', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      // Setup mocks
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'checkpoint-1',
              branch_id: 'branch-1',
              checkpoint_type: 'manual',
              created_by_id: 'user-1',
              created_by_type: 'user',
              created_at: '2026-01-24T10:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // document versions
        .mockResolvedValueOnce({ rows: [] }); // structure capture

      await createCheckpoint({
        branchId: 'branch-1',
        checkpointType: 'manual',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Verify the INSERT includes name and slug columns
      const insertCall = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('checkpoint_structures') &&
          call[0].includes('name') &&
          call[0].includes('slug')
      );
      expect(insertCall).toBeDefined();
    });
  });

  // ===========================================================================
  // Retrieve Structure State from Checkpoint
  // ===========================================================================

  describe('getStructuresAtCheckpoint', () => {
    it('should return all structures captured at checkpoint', async () => {
      const { getStructuresAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            checkpoint_id: 'checkpoint-1',
            structure_id: 'struct-1',
            name: 'Navigation',
            slug: 'nav',
            structure_type: 'hierarchy',
            structure_tree: [{ id: 'node-1', name: 'Home' }],
            metadata_schema: { type: 'object' },
            schema_enforcement: 'warn',
          },
          {
            checkpoint_id: 'checkpoint-1',
            structure_id: 'struct-2',
            name: 'Blog',
            slug: 'blog',
            structure_type: 'collection',
            structure_tree: [],
            metadata_schema: { type: 'object' },
            schema_enforcement: 'none',
          },
        ],
      });

      const structures = await getStructuresAtCheckpoint('checkpoint-1');

      expect(structures).toHaveLength(2);
      expect(structures[0].name).toBe('Navigation');
      expect(structures[0].slug).toBe('nav');
      expect(structures[1].name).toBe('Blog');
      expect(structures[1].slug).toBe('blog');
    });

    it('should return empty array when no structures in checkpoint', async () => {
      const { getStructuresAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const structures = await getStructuresAtCheckpoint('checkpoint-1');

      expect(structures).toEqual([]);
    });
  });

  describe('getStructureAtCheckpoint', () => {
    it('should return specific structure state at checkpoint', async () => {
      const { getStructureAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            checkpoint_id: 'checkpoint-1',
            structure_id: 'struct-1',
            name: 'blogs',
            slug: 'blogs',
            structure_type: 'collection',
            structure_tree: [
              { id: 'node-1', name: 'Post 1' },
              { id: 'node-2', name: 'Post 2' },
            ],
            metadata_schema: { type: 'object', properties: { title: { type: 'string' } } },
            schema_enforcement: 'strict',
          },
        ],
      });

      const structure = await getStructureAtCheckpoint('checkpoint-1', 'struct-1');

      expect(structure).not.toBeNull();
      expect(structure!.name).toBe('blogs');
      expect(structure!.slug).toBe('blogs');
      expect(structure!.structureTree).toHaveLength(2);
    });

    it('should return null when structure not in checkpoint', async () => {
      const { getStructureAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const structure = await getStructureAtCheckpoint('checkpoint-1', 'nonexistent');

      expect(structure).toBeNull();
    });
  });

  // ===========================================================================
  // Revert to Checkpoint (including structure state)
  // ===========================================================================

  describe('revertToCheckpoint with structure restore', () => {
    it('should restore structure identity from checkpoint', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      // Mock getting checkpoint
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'checkpoint-1',
            branch_id: 'branch-1',
            checkpoint_type: 'manual',
          },
        ],
      });

      // Mock getting documents at checkpoint
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      // Mock getting structures at checkpoint
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            structure_id: 'struct-1',
            name: 'blogs',
            slug: 'blogs',
            structure_type: 'collection',
            structure_tree: [{ id: 'node-1' }],
            metadata_schema: {},
            schema_enforcement: 'warn',
          },
        ],
      });

      // Mock delete current structure state
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      // Mock restore structure state
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await revertToCheckpoint({
        checkpointId: 'checkpoint-1',
        actorId: 'user-1',
        actorType: 'user',
      });

      // Verify structure restore query was called
      const calls = vi.mocked(db.query).mock.calls;
      const restoreCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('branch_structure_state') &&
          call[0].includes('INSERT')
      );
      expect(restoreCall).toBeDefined();
    });

    it('should restore structure name and slug to checkpoint values', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      // Current state: structure renamed to "stuff-i-write"
      // Checkpoint state: structure was named "blogs"
      // After revert: structure should be "blogs" again

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'checkpoint-1', branch_id: 'branch-1', checkpoint_type: 'manual' }],
        })
        .mockResolvedValueOnce({ rows: [] }) // documents
        .mockResolvedValueOnce({
          rows: [
            {
              structure_id: 'struct-1',
              name: 'blogs', // Original name at checkpoint
              slug: 'blogs',
              structure_type: 'collection',
              structure_tree: [],
              metadata_schema: {},
              schema_enforcement: 'warn',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // delete current
        .mockResolvedValueOnce({ rows: [] }); // insert from checkpoint

      await revertToCheckpoint({
        checkpointId: 'checkpoint-1',
        actorId: 'user-1',
        actorType: 'user',
      });

      // The INSERT should include the checkpoint's name/slug values
      const insertCall = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT') &&
          call[0].includes('branch_structure_state')
      );
      expect(insertCall).toBeDefined();
    });

    it('should delete current structure state before restoring', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'checkpoint-1', branch_id: 'branch-1', checkpoint_type: 'manual' }],
        })
        .mockResolvedValueOnce({ rows: [] }) // documents
        .mockResolvedValueOnce({
          rows: [{ structure_id: 'struct-1', name: 'Nav', slug: 'nav' }],
        })
        .mockResolvedValueOnce({ rows: [] }) // DELETE
        .mockResolvedValueOnce({ rows: [] }); // INSERT

      await revertToCheckpoint({
        checkpointId: 'checkpoint-1',
        actorId: 'user-1',
        actorType: 'user',
      });

      // Verify DELETE was called before INSERT
      const calls = vi.mocked(db.query).mock.calls;
      const deleteIndex = calls.findIndex(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('DELETE') &&
          call[0].includes('branch_structure_state')
      );
      const insertIndex = calls.findIndex(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT') &&
          call[0].includes('branch_structure_state')
      );

      expect(deleteIndex).toBeLessThan(insertIndex);
    });
  });

  // ===========================================================================
  // Document Metadata Capture/Restore
  // ===========================================================================

  describe('checkpoint document metadata', () => {
    it('should capture document metadata in checkpoint', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'checkpoint-1',
              branch_id: 'branch-1',
              checkpoint_type: 'manual',
              created_by_id: 'user-1',
              created_by_type: 'user',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // document versions
        .mockResolvedValueOnce({ rows: [] }) // structure state
        .mockResolvedValueOnce({ rows: [] }); // document metadata

      await createCheckpoint({
        branchId: 'branch-1',
        checkpointType: 'manual',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // Verify metadata capture query
      const metadataCall = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('checkpoint_document_metadata') &&
          call[0].includes('INSERT')
      );
      expect(metadataCall).toBeDefined();
    });

    it('should restore document metadata on revert', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'checkpoint-1', branch_id: 'branch-1', checkpoint_type: 'manual' }],
        })
        .mockResolvedValueOnce({ rows: [] }) // documents
        .mockResolvedValueOnce({ rows: [] }) // structures
        .mockResolvedValueOnce({ rows: [] }) // delete current structures
        .mockResolvedValueOnce({ rows: [] }) // restore structures
        .mockResolvedValueOnce({ rows: [] }) // delete current metadata
        .mockResolvedValueOnce({ rows: [] }); // restore metadata

      await revertToCheckpoint({
        checkpointId: 'checkpoint-1',
        actorId: 'user-1',
        actorType: 'user',
      });

      // Verify metadata restore
      const metadataRestoreCall = vi.mocked(db.query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('branch_document_metadata') &&
          call[0].includes('INSERT')
      );
      expect(metadataRestoreCall).toBeDefined();
    });
  });
});
