/**
 * Phase 6.1: Structure Service Tests (TDD)
 *
 * Tests for site structure and node management.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { branchStructureState, siteStructures } from '../../src/db/schema';
import {
  DuplicateStructureSlugError,
  SiteNotFoundError,
  StructureNotFoundError,
  createStructure,
  deleteBranchStructure,
  getBranchStructure,
  getBranchStructureBySlug,
  listBranchStructures,
  updateBranchStructure,
} from '../../src/services/structure-service';

// The node tests below reach node-service through structure-service's re-exports,
// and take their rows from this mock.
vi.mock('../../src/db', () => ({
}));

/** A Postgres rejection as the driver raises it, carrying only its SQLSTATE. */
function driverError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('Phase 6.1: Structure Service', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = stubDatabase();
  });

  // ===========================================================================
  // Branch-Scoped Structure CRUD (Updated from Phase 6.1 to Phase 7.1.1a)
  // ===========================================================================

  describe('createStructure', () => {
    it('should create a new structure with branch-scoped identity', async () => {
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
    });

    it('should create a collection structure type', async () => {
      stub.on(siteStructures).insert.returns([
        {
          id: 'struct-2',
          siteId: 'site-1',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);
      stub.on(branchStructureState).insert.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-2',
          name: 'Blog Posts',
          slug: 'blog',
          structureType: 'collection',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
        },
      ]);

      const structure = await createStructure({
        siteId: 'site-1',
        branchId: 'branch-1',
        name: 'Blog Posts',
        slug: 'blog',
        structureType: 'collection',
      });

      expect(structure.structureType).toBe('collection');
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
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
        }),
      ).rejects.toThrow(DuplicateStructureSlugError);
    });

    it('should throw SiteNotFoundError when site does not exist', async () => {
      stub
        .on(siteStructures)
        .insert.rejects(driverError('23503', 'foreign key violation'));

      await expect(
        createStructure({
          siteId: 'nonexistent',
          branchId: 'branch-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
        }),
      ).rejects.toThrow(SiteNotFoundError);
    });

    it('should normalize slug to lowercase on creation', async () => {
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
          structureType: 'hierarchy',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
        },
      ]);

      const structure = await createStructure({
        siteId: 'site-1',
        branchId: 'branch-1',
        name: 'Main Navigation',
        slug: 'Main-Nav',
        structureType: 'hierarchy',
      });

      expect(stub.calls(branchStructureState).insert[0]?.params).toContain('main-nav');
      expect(structure.slug).toBe('main-nav');
    });
  });

  describe('getBranchStructure', () => {
    it('should return structure by branch ID and structure ID', async () => {
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          description: 'Primary navigation',
          structureType: 'hierarchy',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);

      const structure = await getBranchStructure('branch-1', 'struct-1');

      expect(structure).not.toBeNull();
      expect(structure?.id).toBe('struct-1');
      expect(structure?.branchId).toBe('branch-1');
      expect(structure?.name).toBe('Main Navigation');
    });

    it('should return null when structure does not exist on branch', async () => {
      const structure = await getBranchStructure('branch-1', 'nonexistent');

      expect(structure).toBeNull();
    });
  });

  describe('getBranchStructureBySlug', () => {
    it('should return structure by branch ID and slug', async () => {
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);

      const structure = await getBranchStructureBySlug('branch-1', 'main-nav');

      expect(structure).not.toBeNull();
      expect(structure?.slug).toBe('main-nav');
      expect(structure?.branchId).toBe('branch-1');
    });

    it('should find structure with case-insensitive slug lookup', async () => {
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);

      const structure = await getBranchStructureBySlug('branch-1', 'Main-Nav');

      expect(structure).not.toBeNull();
      expect(structure?.slug).toBe('main-nav');
      // The lookup normalizes the slug before it reaches the database.
      expect(stub.calls(branchStructureState).select[0]?.params).toEqual([
        'branch-1',
        'main-nav',
      ]);
    });
  });

  describe('listBranchStructures', () => {
    it('should list structures for a branch', async () => {
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
        {
          structureId: 'struct-2',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Blog',
          slug: 'blog',
          structureType: 'collection',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
          createdAt: new Date('2026-01-24T11:00:00.000Z'),
        },
      ]);

      const structures = await listBranchStructures('branch-1');

      expect(structures).toHaveLength(2);
      expect(structures[0].name).toBe('Main Navigation');
      expect(structures[1].name).toBe('Blog');
    });

    it('should filter by structure type', async () => {
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);

      const structures = await listBranchStructures('branch-1', {
        structureType: 'hierarchy',
      });

      expect(structures).toHaveLength(1);
      const { sql, params } = stub.calls(branchStructureState).select[0] ?? {};
      expect(sql).toContain('"structure_type"');
      expect(params).toEqual(['branch-1', 'hierarchy']);
    });
  });

  describe('updateBranchStructure', () => {
    it('should update structure name and description on branch', async () => {
      stub.on(branchStructureState).update.returns([{ structureId: 'struct-1' }]);
      stub.on(branchStructureState).select.returnsRaw([
        {
          structureId: 'struct-1',
          siteId: 'site-1',
          branchId: 'branch-1',
          name: 'Updated Navigation',
          slug: 'main-nav',
          description: 'Updated description',
          structureType: 'hierarchy',
          structureTree: [],
          metadataSchema: {},
          schemaEnforcement: 'warn',
          createdAt: new Date('2026-01-24T10:00:00.000Z'),
        },
      ]);

      const structure = await updateBranchStructure('branch-1', 'struct-1', {
        name: 'Updated Navigation',
        description: 'Updated description',
      });

      expect(structure.name).toBe('Updated Navigation');
      expect(structure.description).toBe('Updated description');
    });

    it('should throw StructureNotFoundError when structure does not exist on branch', async () => {
      await expect(
        updateBranchStructure('branch-1', 'nonexistent', { name: 'Updated' }),
      ).rejects.toThrow(StructureNotFoundError);
    });
  });

  describe('deleteBranchStructure', () => {
    it('should delete a structure from branch', async () => {
      stub.on(branchStructureState).delete.returns([{ structureId: 'struct-1' }]);
      stub.on(branchStructureState).select.returnsRaw([{ count: 0 }]);

      await deleteBranchStructure('branch-1', 'struct-1');

      expect(stub.calls(branchStructureState).delete[0]?.params).toEqual([
        'branch-1',
        'struct-1',
      ]);
    });

    it('should throw StructureNotFoundError when structure does not exist on branch', async () => {
      await expect(
        deleteBranchStructure('branch-1', 'nonexistent'),
      ).rejects.toThrow(StructureNotFoundError);
    });
  });

  // ===========================================================================
  // Error Classes
  // ===========================================================================

  describe('Error Classes', () => {
    it('should export StructureNotFoundError with correct properties', async () => {
      const { StructureNotFoundError } = await import('../../src/services/structure-service');

      const error = new StructureNotFoundError('struct-123');

      expect(error.name).toBe('StructureNotFoundError');
      expect(error.structureId).toBe('struct-123');
      expect(error.message).toContain('struct-123');
    });

    it('should export DuplicateStructureSlugError with correct properties', async () => {
      const { DuplicateStructureSlugError } = await import(
        '../../src/services/structure-service'
      );

      const error = new DuplicateStructureSlugError('site-1', 'main-nav');

      expect(error.name).toBe('DuplicateStructureSlugError');
      expect(error.siteId).toBe('site-1');
      expect(error.slug).toBe('main-nav');
    });

    it('should export SiteNotFoundError with correct properties', async () => {
      const { SiteNotFoundError } = await import('../../src/services/structure-service');

      const error = new SiteNotFoundError('site-123');

      expect(error.name).toBe('SiteNotFoundError');
      expect(error.siteId).toBe('site-123');
    });
  });
});
