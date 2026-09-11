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

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { branchStructureState, siteStructures } from '../../src/db/schema';
import {
  DuplicateStructureSlugError,
  StructureNotFoundError,
  copyStructureStateForBranch,
  createStructure,
  deleteBranchStructure,
  getBranchStructure,
  getBranchStructureBySlug,
  listBranchStructures,
  updateBranchStructure,
} from '../../src/services/structure-service';

/** A Postgres rejection as the driver raises it, carrying only its SQLSTATE. */
function driverError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('Phase 7.1.1a: Branch-Scoped Structure Service', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
  });

  // ===========================================================================
  // Branch-Scoped Structure Creation
  // ===========================================================================

  describe('createStructure (branch-scoped)', () => {
    it('should create structure definition and branch state atomically', async () => {
      stub.on(siteStructures).insert.returns([
        {
          id: 'struct-1',
          siteId: 'site-1',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);
      stub.on(branchStructureState).insert.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          description: 'Primary site navigation',
          structureType: 'hierarchy',
          structureTree: [],
          metadataSchema: { type: 'object', properties: {} },
          schemaEnforcement: 'warn',
        },
      ]);

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
      // The definition is written first, so the branch row can reference it.
      expect(stub.calls(siteStructures).insert).toHaveLength(1);
      expect(stub.calls(branchStructureState).insert[0]?.params).toContain('struct-1');
    });

    it('should allow same slug on different branches', async () => {
      stub.on(siteStructures).insert.returns([
        {
          id: 'struct-1',
          siteId: 'site-1',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);
      stub.on(branchStructureState).insert.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          name: 'Navigation',
          slug: 'nav',
          structureType: 'hierarchy',
        },
      ]);

      const struct1 = await createStructure({
        siteId: 'site-1',
        branchId: 'branch-1',
        name: 'Navigation',
        slug: 'nav',
        structureType: 'hierarchy',
      });

      stub.on(siteStructures).insert.returns([
        {
          id: 'struct-2',
          siteId: 'site-1',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);
      stub.on(branchStructureState).insert.returns([
        {
          branchId: 'branch-2',
          structureId: 'struct-2',
          name: 'Navigation',
          slug: 'nav',
          structureType: 'hierarchy',
        },
      ]);

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
      stub.on(siteStructures).insert.returns([
        {
          id: 'struct-1',
          siteId: 'site-1',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);
      stub
        .on(branchStructureState)
        .insert.rejects(
          driverError('23505', 'duplicate key value violates unique constraint'),
        );

      await expect(
        createStructure({
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Navigation',
          slug: 'nav',
          structureType: 'hierarchy',
        }),
      ).rejects.toThrow(DuplicateStructureSlugError);
    });
  });

  // ===========================================================================
  // Branch-Scoped Structure Retrieval
  // ===========================================================================

  describe('getBranchStructure', () => {
    it('should return structure with branch-scoped identity', async () => {
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          description: 'Primary site navigation',
          structureType: 'hierarchy',
          structureTree: [{ id: 'node-1', name: 'Home' }],
          metadataSchema: { type: 'object' },
          schemaEnforcement: 'warn',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);

      const structure = await getBranchStructure('branch-1', 'struct-1');

      expect(structure).not.toBeNull();
      expect(structure?.id).toBe('struct-1');
      expect(structure?.branchId).toBe('branch-1');
      expect(structure?.name).toBe('Main Navigation');
      expect(structure?.slug).toBe('main-nav');
    });

    it('should return null when structure does not exist on branch', async () => {
      const structure = await getBranchStructure('branch-1', 'nonexistent');

      expect(structure).toBeNull();
    });
  });

  describe('getBranchStructureBySlug', () => {
    it('should find structure by slug within branch scope', async () => {
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Blog',
          slug: 'blog',
          structureType: 'collection',
        },
      ]);

      const structure = await getBranchStructureBySlug('branch-1', 'blog');

      expect(structure).not.toBeNull();
      expect(structure?.slug).toBe('blog');
      expect(structure?.branchId).toBe('branch-1');
    });

    it('should return null when slug does not exist on branch', async () => {
      const structure = await getBranchStructureBySlug('branch-1',
        'nonexistent',
      );

      expect(structure).toBeNull();
    });
  });

  describe('listBranchStructures', () => {
    it('should list all structures on a branch', async () => {
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          branchId: 'branch-1',
          name: 'Navigation',
          slug: 'nav',
          structureType: 'hierarchy',
        },
        {
          structureId: 'struct-2',
          branchId: 'branch-1',
          name: 'Blog',
          slug: 'blog',
          structureType: 'collection',
        },
      ]);

      const structures = await listBranchStructures('branch-1');

      expect(structures).toHaveLength(2);
      expect(structures[0].name).toBe('Navigation');
      expect(structures[1].name).toBe('Blog');
    });

    it('should filter by structure type', async () => {
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          branchId: 'branch-1',
          name: 'Navigation',
          slug: 'nav',
          structureType: 'hierarchy',
        },
      ]);

      const structures = await listBranchStructures('branch-1', {
        structureType: 'hierarchy',
      });

      expect(structures).toHaveLength(1);
      expect(structures[0].structureType).toBe('hierarchy');
      expect(stub.calls(branchStructureState).select[0]?.params).toEqual([
        'branch-1',
        'hierarchy',
      ]);
    });
  });

  // ===========================================================================
  // Branch-Scoped Structure Updates
  // ===========================================================================

  describe('updateBranchStructure', () => {
    it('should update structure name on branch', async () => {
      stub.on(branchStructureState).update.returns([{ structureId: 'struct-1' }]);
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'stuff-i-write',
          slug: 'stuff-i-write',
          description: 'My blog posts',
          structureType: 'collection',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);

      const updated = await updateBranchStructure('branch-1', 'struct-1', {
        name: 'stuff-i-write',
        slug: 'stuff-i-write',
        description: 'My blog posts',
      });

      expect(updated.name).toBe('stuff-i-write');
      expect(updated.slug).toBe('stuff-i-write');
    });

    it('should throw StructureNotFoundError when structure does not exist on branch', async () => {
      await expect(
        updateBranchStructure('branch-1', 'nonexistent', { name: 'New Name' }),
      ).rejects.toThrow(StructureNotFoundError);
    });

    it('should throw DuplicateStructureSlugError when changing to existing slug', async () => {
      stub
        .on(branchStructureState)
        .update.rejects(driverError('23505', 'duplicate key value'));

      await expect(
        updateBranchStructure('branch-1', 'struct-1', {
          slug: 'existing-slug',
        }),
      ).rejects.toThrow(DuplicateStructureSlugError);
    });
  });

  // ===========================================================================
  // Structure Deletion with Cascade
  // ===========================================================================

  describe('deleteBranchStructure', () => {
    it('should delete structure from branch', async () => {
      stub.on(branchStructureState).delete.returns([{ structureId: 'struct-1' }]);
      stub.on(branchStructureState).select.returnsRaw([{ count: 0 }]);

      await deleteBranchStructure('branch-1', 'struct-1');

      expect(stub.calls(siteStructures).delete[0]?.params).toEqual(['struct-1']);
    });

    it('should not delete definition when other branches reference it', async () => {
      stub.on(branchStructureState).delete.returns([{ structureId: 'struct-1' }]);
      stub.on(branchStructureState).select.returnsRaw([{ count: 2 }]);

      await deleteBranchStructure('branch-1', 'struct-1');

      expect(stub.calls(siteStructures).delete).toHaveLength(0);
    });

    it('should throw StructureNotFoundError when structure does not exist on branch', async () => {
      await expect(
        deleteBranchStructure('branch-1', 'nonexistent'),
      ).rejects.toThrow(StructureNotFoundError);
    });
  });

  // ===========================================================================
  // Copy Structure State (for branch creation)
  // ===========================================================================

  describe('copyStructureStateForBranch', () => {
    it('should copy all structure state from source branch to new branch', async () => {
      await copyStructureStateForBranch('source-branch', 'new-branch');

      expect(stub.calls(branchStructureState).insert[0]?.params).toEqual([
        'new-branch',
        'source-branch',
      ]);
    });

    it('should handle empty source branch (no structures to copy)', async () => {
      await copyStructureStateForBranch('source-branch', 'new-branch');

      expect(stub.calls(branchStructureState).insert).toHaveLength(1);
    });
  });
});
