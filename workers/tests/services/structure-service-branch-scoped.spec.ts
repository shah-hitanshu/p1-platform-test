/**
 * Phase 7.1.1a: Branch-Scoped Structure Service Tests (TDD)
 *
 * Tests for branch-scoped structure identity (name, slug moved from site_structures
 * to branch_structure_state for versioning consistency with documents).
 *
 * These tests are written BEFORE implementation following TDD methodology.
 *
 * Key changes from Phase 6.1:
 * - createStructure now requires branchId (atomic creation of definition + branch state)
 * - Structure identity (name, slug) is branch-scoped
 * - Slug uniqueness is per-branch, not per-site
 * - Delete cascade: when last branch reference is removed, definition is deleted
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 7.1.1a: Branch-Scoped Structure Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Branch-Scoped Structure Creation
  // ===========================================================================

  describe('createStructure (branch-scoped)', () => {
    it('should create structure definition and branch state atomically', async () => {
      const { createStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      // First query: insert into site_structures (definition only)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'struct-1',
            site_id: 'site-1',
            created_at: '2026-01-24T10:00:00.000Z',
          },
        ],
      });

      // Second query: insert into branch_structure_state (identity + state)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            name: 'Main Navigation',
            slug: 'main-nav',
            description: 'Primary site navigation',
            structure_type: 'hierarchy',
            structure_tree: [],
            metadata_schema: { type: 'object', properties: {} },
            schema_enforcement: 'warn',
          },
        ],
      });

      const structure = await createStructure({
        siteId: 'site-1',
        branchId: 'branch-1',
        name: 'Main Navigation',
        slug: 'main-nav',
        description: 'Primary site navigation',
        structureType: 'hierarchy',
      });

      expect(structure.id).toBe('struct-1');
      expect(structure.branchId).toBe('branch-1');
      expect(structure.name).toBe('Main Navigation');
      expect(structure.slug).toBe('main-nav');
      expect(structure.structureType).toBe('hierarchy');
    });

    it('should allow same slug on different branches', async () => {
      const { createStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      // Create on branch-1
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'struct-1', site_id: 'site-1', created_at: '2026-01-24T10:00:00.000Z' }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              branch_id: 'branch-1',
              structure_id: 'struct-1',
              name: 'Navigation',
              slug: 'nav',
              structure_type: 'hierarchy',
            },
          ],
        });

      const struct1 = await createStructure({
        siteId: 'site-1',
        branchId: 'branch-1',
        name: 'Navigation',
        slug: 'nav',
        structureType: 'hierarchy',
      });

      // Create on branch-2 with same slug (should succeed - different branch)
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'struct-2', site_id: 'site-1', created_at: '2026-01-24T10:00:00.000Z' }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              branch_id: 'branch-2',
              structure_id: 'struct-2',
              name: 'Navigation',
              slug: 'nav',
              structure_type: 'hierarchy',
            },
          ],
        });

      const struct2 = await createStructure({
        siteId: 'site-1',
        branchId: 'branch-2',
        name: 'Navigation',
        slug: 'nav',
        structureType: 'hierarchy',
      });

      expect(struct1.slug).toBe('nav');
      expect(struct2.slug).toBe('nav');
      expect(struct1.branchId).not.toBe(struct2.branchId);
    });

    it('should throw DuplicateStructureSlugError when slug exists on same branch', async () => {
      const { createStructure, DuplicateStructureSlugError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      // First insert succeeds
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'struct-1', site_id: 'site-1', created_at: '2026-01-24T10:00:00.000Z' }],
      });

      // Second insert fails due to unique constraint on (branch_id, slug)
      const error = new Error('duplicate key value violates unique constraint');
      (error as Error & { code: string }).code = '23505';
      vi.mocked(db.query).mockRejectedValueOnce(error);

      await expect(
        createStructure({
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Navigation',
          slug: 'nav',
          structureType: 'hierarchy',
        })
      ).rejects.toThrow(DuplicateStructureSlugError);
    });
  });

  // ===========================================================================
  // Branch-Scoped Structure Retrieval
  // ===========================================================================

  describe('getBranchStructure', () => {
    it('should return structure with branch-scoped identity', async () => {
      const { getBranchStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            structure_id: 'struct-1',
            site_id: 'site-1',
            branch_id: 'branch-1',
            name: 'Main Navigation',
            slug: 'main-nav',
            description: 'Primary site navigation',
            structure_type: 'hierarchy',
            structure_tree: [{ id: 'node-1', name: 'Home' }],
            metadata_schema: { type: 'object' },
            schema_enforcement: 'warn',
            created_at: '2026-01-24T10:00:00.000Z',
          },
        ],
      });

      const structure = await getBranchStructure('branch-1', 'struct-1');

      expect(structure).not.toBeNull();
      expect(structure!.id).toBe('struct-1');
      expect(structure!.branchId).toBe('branch-1');
      expect(structure!.name).toBe('Main Navigation');
      expect(structure!.slug).toBe('main-nav');
    });

    it('should return null when structure does not exist on branch', async () => {
      const { getBranchStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const structure = await getBranchStructure('branch-1', 'nonexistent');

      expect(structure).toBeNull();
    });
  });

  describe('getBranchStructureBySlug', () => {
    it('should find structure by slug within branch scope', async () => {
      const { getBranchStructureBySlug } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            structure_id: 'struct-1',
            site_id: 'site-1',
            branch_id: 'branch-1',
            name: 'Blog',
            slug: 'blog',
            structure_type: 'collection',
          },
        ],
      });

      const structure = await getBranchStructureBySlug('branch-1', 'blog');

      expect(structure).not.toBeNull();
      expect(structure!.slug).toBe('blog');
      expect(structure!.branchId).toBe('branch-1');
    });

    it('should return null when slug does not exist on branch', async () => {
      const { getBranchStructureBySlug } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const structure = await getBranchStructureBySlug('branch-1', 'nonexistent');

      expect(structure).toBeNull();
    });
  });

  describe('listBranchStructures', () => {
    it('should list all structures on a branch', async () => {
      const { listBranchStructures } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            structure_id: 'struct-1',
            branch_id: 'branch-1',
            name: 'Navigation',
            slug: 'nav',
            structure_type: 'hierarchy',
          },
          {
            structure_id: 'struct-2',
            branch_id: 'branch-1',
            name: 'Blog',
            slug: 'blog',
            structure_type: 'collection',
          },
        ],
      });

      const structures = await listBranchStructures('branch-1');

      expect(structures).toHaveLength(2);
      expect(structures[0].name).toBe('Navigation');
      expect(structures[1].name).toBe('Blog');
    });

    it('should filter by structure type', async () => {
      const { listBranchStructures } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            structure_id: 'struct-1',
            branch_id: 'branch-1',
            name: 'Navigation',
            slug: 'nav',
            structure_type: 'hierarchy',
          },
        ],
      });

      const structures = await listBranchStructures('branch-1', { structureType: 'hierarchy' });

      expect(structures).toHaveLength(1);
      expect(structures[0].structureType).toBe('hierarchy');
    });
  });

  // ===========================================================================
  // Branch-Scoped Structure Updates
  // ===========================================================================

  describe('updateBranchStructure', () => {
    it('should update structure name on branch', async () => {
      const { updateBranchStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            structure_id: 'struct-1',
            branch_id: 'branch-1',
            name: 'stuff-i-write',
            slug: 'stuff-i-write',
            description: 'My blog posts',
            structure_type: 'collection',
          },
        ],
      });

      const updated = await updateBranchStructure('branch-1', 'struct-1', {
        name: 'stuff-i-write',
        slug: 'stuff-i-write',
        description: 'My blog posts',
      });

      expect(updated.name).toBe('stuff-i-write');
      expect(updated.slug).toBe('stuff-i-write');
    });

    it('should throw StructureNotFoundError when structure does not exist on branch', async () => {
      const { updateBranchStructure, StructureNotFoundError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(
        updateBranchStructure('branch-1', 'nonexistent', { name: 'New Name' })
      ).rejects.toThrow(StructureNotFoundError);
    });

    it('should throw DuplicateStructureSlugError when changing to existing slug', async () => {
      const { updateBranchStructure, DuplicateStructureSlugError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      const error = new Error('duplicate key value');
      (error as Error & { code: string }).code = '23505';
      vi.mocked(db.query).mockRejectedValueOnce(error);

      await expect(
        updateBranchStructure('branch-1', 'struct-1', { slug: 'existing-slug' })
      ).rejects.toThrow(DuplicateStructureSlugError);
    });
  });

  // ===========================================================================
  // Structure Deletion with Cascade
  // ===========================================================================

  describe('deleteBranchStructure', () => {
    it('should delete structure from branch', async () => {
      const { deleteBranchStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      // Delete from branch_structure_state
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ structure_id: 'struct-1' }] });

      // Check remaining references
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Cascade delete from site_structures (no more references)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await deleteBranchStructure('branch-1', 'struct-1');

      // Verify cascade delete was called
      expect(db.query).toHaveBeenCalledTimes(3);
    });

    it('should not delete definition when other branches reference it', async () => {
      const { deleteBranchStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      // Delete from branch_structure_state
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ structure_id: 'struct-1' }] });

      // Check remaining references - other branches still have it
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '2' }] });

      await deleteBranchStructure('branch-1', 'struct-1');

      // Only 2 queries: delete branch state + check references (no cascade)
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('should throw StructureNotFoundError when structure does not exist on branch', async () => {
      const { deleteBranchStructure, StructureNotFoundError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(deleteBranchStructure('branch-1', 'nonexistent')).rejects.toThrow(
        StructureNotFoundError
      );
    });
  });

  // ===========================================================================
  // Copy Structure State (for branch creation)
  // ===========================================================================

  describe('copyStructureStateForBranch', () => {
    it('should copy all structure state from source branch to new branch', async () => {
      const { copyStructureStateForBranch } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          { structure_id: 'struct-1', name: 'Nav', slug: 'nav' },
          { structure_id: 'struct-2', name: 'Blog', slug: 'blog' },
        ],
      });

      await copyStructureStateForBranch('source-branch', 'new-branch');

      // Verify INSERT...SELECT query was executed
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['source-branch', 'new-branch'])
      );
    });

    it('should handle empty source branch (no structures to copy)', async () => {
      const { copyStructureStateForBranch } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await copyStructureStateForBranch('source-branch', 'new-branch');

      expect(db.query).toHaveBeenCalled();
    });
  });
});
