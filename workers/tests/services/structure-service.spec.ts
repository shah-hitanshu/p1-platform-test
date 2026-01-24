/**
 * Phase 6.1: Structure Service Tests (TDD)
 *
 * Tests for site structure and node management.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 6.1: Structure Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Site Structure CRUD
  // ===========================================================================

  describe('createStructure', () => {
    it('should create a new site structure', async () => {
      const { createStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'struct-1',
          site_id: 'site-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          description: 'Primary site navigation',
          structure_type: 'hierarchy',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const structure = await createStructure({
        siteId: 'site-1',
        name: 'Main Navigation',
        slug: 'main-nav',
        description: 'Primary site navigation',
        structureType: 'hierarchy',
      });

      expect(structure.id).toBe('struct-1');
      expect(structure.name).toBe('Main Navigation');
      expect(structure.slug).toBe('main-nav');
      expect(structure.structureType).toBe('hierarchy');
    });

    it('should create a collection structure type', async () => {
      const { createStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'struct-2',
          site_id: 'site-1',
          name: 'Blog Posts',
          slug: 'blog',
          structure_type: 'collection',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const structure = await createStructure({
        siteId: 'site-1',
        name: 'Blog Posts',
        slug: 'blog',
        structureType: 'collection',
      });

      expect(structure.structureType).toBe('collection');
    });

    it('should throw DuplicateStructureSlugError when slug exists', async () => {
      const { createStructure, DuplicateStructureSlugError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      const error = new Error('duplicate key value');
      (error as Error & { code: string }).code = '23505';
      vi.mocked(db.query).mockRejectedValueOnce(error);

      await expect(
        createStructure({
          siteId: 'site-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
        }),
      ).rejects.toThrow(DuplicateStructureSlugError);
    });

    it('should throw SiteNotFoundError when site does not exist', async () => {
      const { createStructure, SiteNotFoundError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      const error = new Error('foreign key violation');
      (error as Error & { code: string }).code = '23503';
      vi.mocked(db.query).mockRejectedValueOnce(error);

      await expect(
        createStructure({
          siteId: 'nonexistent',
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
        }),
      ).rejects.toThrow(SiteNotFoundError);
    });
  });

  describe('getStructure', () => {
    it('should return structure by ID', async () => {
      const { getStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'struct-1',
          site_id: 'site-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          description: 'Primary navigation',
          structure_type: 'hierarchy',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const structure = await getStructure('struct-1');

      expect(structure).not.toBeNull();
      expect(structure?.id).toBe('struct-1');
      expect(structure?.name).toBe('Main Navigation');
    });

    it('should return null when structure does not exist', async () => {
      const { getStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([]);

      const structure = await getStructure('nonexistent');

      expect(structure).toBeNull();
    });
  });

  describe('getStructureBySlug', () => {
    it('should return structure by site ID and slug', async () => {
      const { getStructureBySlug } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'struct-1',
          site_id: 'site-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structure_type: 'hierarchy',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const structure = await getStructureBySlug('site-1', 'main-nav');

      expect(structure).not.toBeNull();
      expect(structure?.slug).toBe('main-nav');
    });
  });

  describe('listStructures', () => {
    it('should list structures for a site', async () => {
      const { listStructures } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'struct-1',
          site_id: 'site-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structure_type: 'hierarchy',
          created_at: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'struct-2',
          site_id: 'site-1',
          name: 'Blog',
          slug: 'blog',
          structure_type: 'collection',
          created_at: '2026-01-24T11:00:00.000Z',
        },
      ]);

      const structures = await listStructures({ siteId: 'site-1' });

      expect(structures).toHaveLength(2);
      expect(structures[0].name).toBe('Main Navigation');
      expect(structures[1].name).toBe('Blog');
    });

    it('should filter by structure type', async () => {
      const { listStructures } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'struct-1',
          site_id: 'site-1',
          name: 'Main Navigation',
          slug: 'main-nav',
          structure_type: 'hierarchy',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const structures = await listStructures({
        siteId: 'site-1',
        structureType: 'hierarchy',
      });

      expect(structures).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('structure_type'),
        expect.arrayContaining(['hierarchy']),
      );
    });
  });

  describe('updateStructure', () => {
    it('should update structure name and description', async () => {
      const { updateStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'struct-1',
          site_id: 'site-1',
          name: 'Updated Navigation',
          slug: 'main-nav',
          description: 'Updated description',
          structure_type: 'hierarchy',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const structure = await updateStructure('struct-1', {
        name: 'Updated Navigation',
        description: 'Updated description',
      });

      expect(structure.name).toBe('Updated Navigation');
      expect(structure.description).toBe('Updated description');
    });

    it('should throw StructureNotFoundError when structure does not exist', async () => {
      const { updateStructure, StructureNotFoundError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([]);

      await expect(
        updateStructure('nonexistent', { name: 'Updated' }),
      ).rejects.toThrow(StructureNotFoundError);
    });
  });

  describe('deleteStructure', () => {
    it('should delete a structure', async () => {
      const { deleteStructure } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([{ id: 'struct-1' }]);

      await deleteStructure('struct-1');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.arrayContaining(['struct-1']),
      );
    });

    it('should throw StructureNotFoundError when structure does not exist', async () => {
      const { deleteStructure, StructureNotFoundError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([]);

      await expect(deleteStructure('nonexistent')).rejects.toThrow(StructureNotFoundError);
    });
  });

  // ===========================================================================
  // Structure Node CRUD
  // ===========================================================================

  describe('createNode', () => {
    it('should create a section node', async () => {
      const { createNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-1',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'Products',
          slug: 'products',
          node_type: 'section',
          document_id: null,
          external_url: null,
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const node = await createNode({
        structureId: 'struct-1',
        name: 'Products',
        slug: 'products',
        nodeType: 'section',
        position: 0,
      });

      expect(node.id).toBe('node-1');
      expect(node.name).toBe('Products');
      expect(node.nodeType).toBe('section');
    });

    it('should create a document node with reference', async () => {
      const { createNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-2',
          structure_id: 'struct-1',
          parent_node_id: 'node-1',
          position: 0,
          name: 'Product Overview',
          slug: 'overview',
          node_type: 'document',
          document_id: 'doc-1',
          external_url: null,
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const node = await createNode({
        structureId: 'struct-1',
        parentNodeId: 'node-1',
        name: 'Product Overview',
        slug: 'overview',
        nodeType: 'document',
        documentId: 'doc-1',
        position: 0,
      });

      expect(node.nodeType).toBe('document');
      expect(node.documentId).toBe('doc-1');
      expect(node.parentNodeId).toBe('node-1');
    });

    it('should create an external link node', async () => {
      const { createNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-3',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 1,
          name: 'External Resources',
          slug: 'external',
          node_type: 'external',
          document_id: null,
          external_url: 'https://example.com',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const node = await createNode({
        structureId: 'struct-1',
        name: 'External Resources',
        slug: 'external',
        nodeType: 'external',
        externalUrl: 'https://example.com',
        position: 1,
      });

      expect(node.nodeType).toBe('external');
      expect(node.externalUrl).toBe('https://example.com');
    });

    it('should throw StructureNotFoundError when structure does not exist', async () => {
      const { createNode, StructureNotFoundError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      const error = new Error('foreign key violation');
      (error as Error & { code: string }).code = '23503';
      vi.mocked(db.query).mockRejectedValueOnce(error);

      await expect(
        createNode({
          structureId: 'nonexistent',
          name: 'Node',
          slug: 'node',
          nodeType: 'section',
          position: 0,
        }),
      ).rejects.toThrow(StructureNotFoundError);
    });

    it('should throw DuplicateNodeSlugError when sibling slug exists', async () => {
      const { createNode, DuplicateNodeSlugError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      const error = new Error('duplicate key value');
      (error as Error & { code: string }).code = '23505';
      vi.mocked(db.query).mockRejectedValueOnce(error);

      await expect(
        createNode({
          structureId: 'struct-1',
          name: 'Products',
          slug: 'products',
          nodeType: 'section',
          position: 0,
        }),
      ).rejects.toThrow(DuplicateNodeSlugError);
    });
  });

  describe('getNode', () => {
    it('should return node by ID', async () => {
      const { getNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-1',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'Products',
          slug: 'products',
          node_type: 'section',
          document_id: null,
          external_url: null,
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const node = await getNode('node-1');

      expect(node).not.toBeNull();
      expect(node?.id).toBe('node-1');
      expect(node?.name).toBe('Products');
    });

    it('should return null when node does not exist', async () => {
      const { getNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([]);

      const node = await getNode('nonexistent');

      expect(node).toBeNull();
    });
  });

  describe('listNodes', () => {
    it('should list all nodes in a structure', async () => {
      const { listNodes } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-1',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'Products',
          slug: 'products',
          node_type: 'section',
          created_at: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'node-2',
          structure_id: 'struct-1',
          parent_node_id: 'node-1',
          position: 0,
          name: 'Overview',
          slug: 'overview',
          node_type: 'document',
          document_id: 'doc-1',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const nodes = await listNodes({ structureId: 'struct-1' });

      expect(nodes).toHaveLength(2);
    });

    it('should filter nodes by parent', async () => {
      const { listNodes } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-2',
          structure_id: 'struct-1',
          parent_node_id: 'node-1',
          position: 0,
          name: 'Overview',
          slug: 'overview',
          node_type: 'document',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const nodes = await listNodes({
        structureId: 'struct-1',
        parentNodeId: 'node-1',
      });

      expect(nodes).toHaveLength(1);
      expect(nodes[0].parentNodeId).toBe('node-1');
    });

    it('should list root nodes when parentNodeId is null', async () => {
      const { listNodes } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-1',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'Products',
          slug: 'products',
          node_type: 'section',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const nodes = await listNodes({
        structureId: 'struct-1',
        parentNodeId: null,
      });

      expect(nodes).toHaveLength(1);
      expect(nodes[0].parentNodeId).toBeUndefined();
    });
  });

  describe('updateNode', () => {
    it('should update node name and slug', async () => {
      const { updateNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-1',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'Updated Products',
          slug: 'updated-products',
          node_type: 'section',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const node = await updateNode('node-1', {
        name: 'Updated Products',
        slug: 'updated-products',
      });

      expect(node.name).toBe('Updated Products');
      expect(node.slug).toBe('updated-products');
    });

    it('should update document reference', async () => {
      const { updateNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-2',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'Document Node',
          slug: 'doc-node',
          node_type: 'document',
          document_id: 'doc-2',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const node = await updateNode('node-2', {
        documentId: 'doc-2',
      });

      expect(node.documentId).toBe('doc-2');
    });

    it('should throw NodeNotFoundError when node does not exist', async () => {
      const { updateNode, NodeNotFoundError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([]);

      await expect(
        updateNode('nonexistent', { name: 'Updated' }),
      ).rejects.toThrow(NodeNotFoundError);
    });
  });

  describe('deleteNode', () => {
    it('should delete a node', async () => {
      const { deleteNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([{ id: 'node-1' }]);

      await deleteNode('node-1');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.arrayContaining(['node-1']),
      );
    });

    it('should throw NodeNotFoundError when node does not exist', async () => {
      const { deleteNode, NodeNotFoundError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([]);

      await expect(deleteNode('nonexistent')).rejects.toThrow(NodeNotFoundError);
    });
  });

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  describe('moveNode', () => {
    it('should move node to a new parent', async () => {
      const { moveNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-2',
          structure_id: 'struct-1',
          parent_node_id: 'node-3',
          position: 0,
          name: 'Moved Node',
          slug: 'moved',
          node_type: 'section',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const node = await moveNode('node-2', {
        newParentId: 'node-3',
        newPosition: 0,
      });

      expect(node.parentNodeId).toBe('node-3');
      expect(node.position).toBe(0);
    });

    it('should move node to root level', async () => {
      const { moveNode } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-2',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 1,
          name: 'Moved Node',
          slug: 'moved',
          node_type: 'section',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const node = await moveNode('node-2', {
        newParentId: null,
        newPosition: 1,
      });

      expect(node.parentNodeId).toBeUndefined();
      expect(node.position).toBe(1);
    });

    it('should throw NodeNotFoundError when node does not exist', async () => {
      const { moveNode, NodeNotFoundError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([]);

      await expect(
        moveNode('nonexistent', { newParentId: 'node-1', newPosition: 0 }),
      ).rejects.toThrow(NodeNotFoundError);
    });

    it('should throw CircularReferenceError when creating cycle', async () => {
      const { moveNode, CircularReferenceError } = await import(
        '../../src/services/structure-service'
      );
      const db = await import('../../src/db');

      // First query returns the node being moved
      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-1',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'Parent',
          slug: 'parent',
          node_type: 'section',
        },
      ]);

      // Second query checks ancestry - returns the node itself as ancestor
      vi.mocked(db.query).mockResolvedValueOnce([
        { id: 'node-1' }, // Would create cycle
      ]);

      await expect(
        moveNode('node-1', { newParentId: 'node-2', newPosition: 0 }),
      ).rejects.toThrow(CircularReferenceError);
    });
  });

  describe('reorderNodes', () => {
    it('should reorder sibling nodes', async () => {
      const { reorderNodes } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      // Mock multiple update calls
      vi.mocked(db.query)
        .mockResolvedValueOnce([{ id: 'node-1' }])
        .mockResolvedValueOnce([{ id: 'node-2' }])
        .mockResolvedValueOnce([{ id: 'node-3' }]);

      await reorderNodes('struct-1', null, ['node-2', 'node-1', 'node-3']);

      expect(db.query).toHaveBeenCalledTimes(3);
    });
  });

  // ===========================================================================
  // Navigation Tree
  // ===========================================================================

  describe('buildNavigationTree', () => {
    it('should build hierarchical tree from flat nodes', async () => {
      const { buildNavigationTree } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-1',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'Products',
          slug: 'products',
          node_type: 'section',
          created_at: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'node-2',
          structure_id: 'struct-1',
          parent_node_id: 'node-1',
          position: 0,
          name: 'Overview',
          slug: 'overview',
          node_type: 'document',
          document_id: 'doc-1',
          created_at: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'node-3',
          structure_id: 'struct-1',
          parent_node_id: 'node-1',
          position: 1,
          name: 'Features',
          slug: 'features',
          node_type: 'document',
          document_id: 'doc-2',
          created_at: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'node-4',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 1,
          name: 'About',
          slug: 'about',
          node_type: 'document',
          document_id: 'doc-3',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const tree = await buildNavigationTree('struct-1');

      expect(tree).toHaveLength(2); // Two root nodes
      expect(tree[0].name).toBe('Products');
      expect(tree[0].children).toHaveLength(2); // Two children
      expect(tree[0].children?.[0].name).toBe('Overview');
      expect(tree[0].children?.[1].name).toBe('Features');
      expect(tree[1].name).toBe('About');
      expect(tree[1].children).toHaveLength(0);
    });

    it('should sort nodes by position', async () => {
      const { buildNavigationTree } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-2',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 1,
          name: 'Second',
          slug: 'second',
          node_type: 'section',
          created_at: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'node-1',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'First',
          slug: 'first',
          node_type: 'section',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      const tree = await buildNavigationTree('struct-1');

      expect(tree[0].name).toBe('First');
      expect(tree[1].name).toBe('Second');
    });

    it('should include document path for document nodes', async () => {
      const { buildNavigationTree } = await import('../../src/services/structure-service');
      const db = await import('../../src/db');

      // First query gets nodes
      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'node-1',
          structure_id: 'struct-1',
          parent_node_id: null,
          position: 0,
          name: 'Page',
          slug: 'page',
          node_type: 'document',
          document_id: 'doc-1',
          created_at: '2026-01-24T10:00:00.000Z',
        },
      ]);

      // Second query gets documents
      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 'doc-1',
          path: 'pages/home',
        },
      ]);

      const tree = await buildNavigationTree('struct-1');

      expect(tree[0].documentPath).toBe('pages/home');
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

    it('should export NodeNotFoundError with correct properties', async () => {
      const { NodeNotFoundError } = await import('../../src/services/structure-service');

      const error = new NodeNotFoundError('node-123');

      expect(error.name).toBe('NodeNotFoundError');
      expect(error.nodeId).toBe('node-123');
      expect(error.message).toContain('node-123');
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

    it('should export DuplicateNodeSlugError with correct properties', async () => {
      const { DuplicateNodeSlugError } = await import('../../src/services/structure-service');

      const error = new DuplicateNodeSlugError('struct-1', 'products');

      expect(error.name).toBe('DuplicateNodeSlugError');
      expect(error.structureId).toBe('struct-1');
      expect(error.slug).toBe('products');
    });

    it('should export CircularReferenceError with correct properties', async () => {
      const { CircularReferenceError } = await import('../../src/services/structure-service');

      const error = new CircularReferenceError('node-1', 'node-2');

      expect(error.name).toBe('CircularReferenceError');
      expect(error.nodeId).toBe('node-1');
      expect(error.targetParentId).toBe('node-2');
    });

    it('should export SiteNotFoundError with correct properties', async () => {
      const { SiteNotFoundError } = await import('../../src/services/structure-service');

      const error = new SiteNotFoundError('site-123');

      expect(error.name).toBe('SiteNotFoundError');
      expect(error.siteId).toBe('site-123');
    });
  });
});
