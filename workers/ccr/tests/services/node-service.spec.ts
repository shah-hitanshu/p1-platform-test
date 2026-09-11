/**
 * Structure node CRUD, move and reorder operations, and navigation tree assembly.
 *
 * Queries answer from the database stub: a test says what a table returns and
 * asserts on what the service did with it.
 */

import { describe, it, expect } from 'vitest';
import type { InferSelectModel } from 'drizzle-orm';
import { stubDatabase } from '../__stubs__/database';
import { documents, structureNodes } from '../../src/db/schema';
import {
  createNode,
  getNode,
  listNodes,
  updateNode,
  deleteNode,
  moveNode,
  reorderNodes,
  buildNavigationTree,
} from '../../src/services/node-service';
import {
  CircularReferenceError,
  DuplicateNodeSlugError,
  NodeNotFoundError,
  StructureNotFoundError,
} from '../../src/services/errors';

type NodeRow = InferSelectModel<typeof structureNodes>;

function nodeRow(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    id: 'node-1',
    structureId: 'struct-1',
    parentNodeId: null,
    position: 0,
    name: 'Products',
    slug: 'products',
    nodeType: 'section',
    documentId: null,
    externalUrl: null,
    createdAt: new Date('2026-01-24T10:00:00.000Z'),
    ...overrides,
  };
}

/** The predicate a statement filters on, without the projected column list. */
function whereClause(statement: string): string {
  const start = statement.indexOf(' where ');
  const end = statement.indexOf(' order by ');
  return statement.slice(start, end === -1 ? undefined : end);
}

/** The columns a statement assigns, without the predicate that follows. */
function setClause(statement: string): string {
  return statement.slice(statement.indexOf(' set '), statement.indexOf(' where '));
}

function driverError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('createNode', () => {
  it('should create a section node', async () => {
    const { on } = stubDatabase();
    on(structureNodes).insert.returns([nodeRow({ id: 'node-1', name: 'Products' })]);

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
    const { on } = stubDatabase();
    on(structureNodes).insert.returns([
      nodeRow({
        id: 'node-2',
        parentNodeId: 'node-1',
        name: 'Product Overview',
        slug: 'overview',
        nodeType: 'document',
        documentId: 'doc-1',
      }),
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
    const { on } = stubDatabase();
    on(structureNodes).insert.returns([
      nodeRow({
        id: 'node-3',
        position: 1,
        name: 'External Resources',
        slug: 'external',
        nodeType: 'external',
        externalUrl: 'https://example.com',
      }),
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
    const { on } = stubDatabase();
    on(structureNodes).insert.rejects(driverError('23503', 'foreign key violation'));

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
    const { on } = stubDatabase();
    on(structureNodes).insert.rejects(driverError('23505', 'duplicate key value'));

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

  it('should normalize node slug to lowercase on creation', async () => {
    const { on, calls } = stubDatabase();
    on(structureNodes).insert.returns([nodeRow()]);

    const node = await createNode({
      structureId: 'struct-1',
      name: 'Products',
      slug: 'Products',
      nodeType: 'section',
      position: 0,
    });

    expect(calls(structureNodes).insert[0].params).toContain('products');
    expect(node.slug).toBe('products');
  });
});

describe('getNode', () => {
  it('should return node by ID', async () => {
    const { on } = stubDatabase();
    on(structureNodes).select.returns([nodeRow()]);

    const node = await getNode('node-1');

    expect(node).not.toBeNull();
    expect(node?.id).toBe('node-1');
    expect(node?.name).toBe('Products');
  });

  it('should return null when node does not exist', async () => {
    stubDatabase();

    const node = await getNode('nonexistent');

    expect(node).toBeNull();
  });
});

describe('listNodes', () => {
  it('should list all nodes in a structure', async () => {
    const { on, statements } = stubDatabase();
    on(structureNodes).select.returns([
      nodeRow({ id: 'node-1' }),
      nodeRow({
        id: 'node-2',
        parentNodeId: 'node-1',
        name: 'Overview',
        slug: 'overview',
        nodeType: 'document',
        documentId: 'doc-1',
      }),
    ]);

    const nodes = await listNodes({ structureId: 'struct-1' });

    expect(nodes).toHaveLength(2);
    expect(whereClause(statements[0].sql)).not.toContain('parent_node_id');
    expect(statements[0].params).toEqual(['struct-1']);
  });

  it('should filter nodes by parent', async () => {
    const { on, statements } = stubDatabase();
    on(structureNodes).select.returns([
      nodeRow({
        id: 'node-2',
        parentNodeId: 'node-1',
        name: 'Overview',
        slug: 'overview',
        nodeType: 'document',
      }),
    ]);

    const nodes = await listNodes({
      structureId: 'struct-1',
      parentNodeId: 'node-1',
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0].parentNodeId).toBe('node-1');
    expect(whereClause(statements[0].sql)).toContain('"parent_node_id" = $2');
    expect(statements[0].params).toEqual(['struct-1', 'node-1']);
  });

  it('should list root nodes when parentNodeId is null', async () => {
    const { on, statements } = stubDatabase();
    on(structureNodes).select.returns([nodeRow({ id: 'node-1' })]);

    const nodes = await listNodes({
      structureId: 'struct-1',
      parentNodeId: null,
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0].parentNodeId).toBeUndefined();
    expect(whereClause(statements[0].sql)).toContain('"parent_node_id" is null');
    expect(statements[0].params).toEqual(['struct-1']);
  });
});

describe('updateNode', () => {
  it('should update node name and slug', async () => {
    const { on, calls } = stubDatabase();
    on(structureNodes).update.returns([
      nodeRow({ name: 'Updated Products', slug: 'updated-products' }),
    ]);

    const node = await updateNode('node-1', {
      name: 'Updated Products',
      slug: 'updated-products',
    });

    expect(node.name).toBe('Updated Products');
    expect(node.slug).toBe('updated-products');
    expect(setClause(calls(structureNodes).update[0].sql)).toContain('"name" = $1');
    expect(setClause(calls(structureNodes).update[0].sql)).toContain('"slug" = $2');
    expect(calls(structureNodes).update[0].params).toEqual([
      'Updated Products',
      'updated-products',
      'node-1',
    ]);
  });

  it('should update document reference', async () => {
    const { on, calls } = stubDatabase();
    on(structureNodes).update.returns([
      nodeRow({
        id: 'node-2',
        name: 'Document Node',
        slug: 'doc-node',
        nodeType: 'document',
        documentId: 'doc-2',
      }),
    ]);

    const node = await updateNode('node-2', {
      documentId: 'doc-2',
    });

    expect(node.documentId).toBe('doc-2');
    expect(setClause(calls(structureNodes).update[0].sql)).toBe(' set "document_id" = $1');
    expect(calls(structureNodes).update[0].params).toEqual(['doc-2', 'node-2']);
  });

  it('should throw NodeNotFoundError when node does not exist', async () => {
    stubDatabase();

    await expect(updateNode('nonexistent', { name: 'Updated' })).rejects.toThrow(
      NodeNotFoundError,
    );
  });
});

describe('deleteNode', () => {
  it('should delete a node', async () => {
    const { on, calls } = stubDatabase();
    on(structureNodes).delete.returns([nodeRow({ id: 'node-1' })]);

    await deleteNode('node-1');

    expect(calls(structureNodes).delete).toHaveLength(1);
    expect(calls(structureNodes).delete[0].params).toEqual(['node-1']);
  });

  it('should throw NodeNotFoundError when node does not exist', async () => {
    stubDatabase();

    await expect(deleteNode('nonexistent')).rejects.toThrow(NodeNotFoundError);
  });
});

describe('moveNode', () => {
  it('should move node to a new parent', async () => {
    const { on } = stubDatabase();
    on(structureNodes).select.returns([
      nodeRow({ id: 'node-2', parentNodeId: 'node-1', name: 'Moved Node', slug: 'moved' }),
    ]);
    on(structureNodes).update.returns([
      nodeRow({ id: 'node-2', parentNodeId: 'node-3', name: 'Moved Node', slug: 'moved' }),
    ]);

    const node = await moveNode('node-2', {
      newParentId: 'node-3',
      newPosition: 0,
    });

    expect(node.parentNodeId).toBe('node-3');
    expect(node.position).toBe(0);
  });

  it('should move node to root level', async () => {
    const { on, statements } = stubDatabase();
    on(structureNodes).select.returns([
      nodeRow({ id: 'node-2', parentNodeId: 'node-1', name: 'Moved Node', slug: 'moved' }),
    ]);
    on(structureNodes).update.returns([
      nodeRow({ id: 'node-2', position: 1, name: 'Moved Node', slug: 'moved' }),
    ]);

    const node = await moveNode('node-2', {
      newParentId: null,
      newPosition: 1,
    });

    expect(node.parentNodeId).toBeUndefined();
    expect(node.position).toBe(1);
    // A move to the root has no parent to descend from, so no ancestry query runs.
    expect(statements.some((statement) => statement.sql.includes('ancestry'))).toBe(false);
  });

  it('should throw NodeNotFoundError when node does not exist', async () => {
    stubDatabase();

    await expect(
      moveNode('nonexistent', { newParentId: 'node-1', newPosition: 0 }),
    ).rejects.toThrow(NodeNotFoundError);
  });

  it('should check the ancestry of the target parent before reparenting a node', async () => {
    const { on, statements } = stubDatabase();
    on(structureNodes).select.returns([nodeRow({ id: 'node-1', name: 'Parent', slug: 'parent' })]);
    on(structureNodes).update.returns([nodeRow({ id: 'node-1', parentNodeId: 'node-2' })]);

    await moveNode('node-1', { newParentId: 'node-2', newPosition: 0 });

    const ancestry = statements.find((statement) => statement.sql.includes('WITH RECURSIVE'));
    expect(ancestry).toBeDefined();
    // The target parent seeds the walk and the moved node is what it looks for:
    // finding it means the move would put the node under its own descendant.
    expect(ancestry?.params).toEqual(['node-2', 'node-1']);
  });
});

describe('reorderNodes', () => {
  it('should reorder sibling nodes', async () => {
    const { on, calls } = stubDatabase();
    on(structureNodes).update.returns([nodeRow({ id: 'node-1' })]);

    await reorderNodes('struct-1', null, ['node-2', 'node-1', 'node-3']);

    expect(calls(structureNodes).update).toHaveLength(3);
    expect(calls(structureNodes).update.map((call) => call.params)).toEqual(
      expect.arrayContaining([
        [0, 'node-2', 'struct-1'],
        [1, 'node-1', 'struct-1'],
        [2, 'node-3', 'struct-1'],
      ]),
    );
  });
});

describe('buildNavigationTree', () => {
  it('should build hierarchical tree from flat nodes', async () => {
    const { on } = stubDatabase();
    on(structureNodes).select.returns([
      nodeRow({ id: 'node-1' }),
      nodeRow({
        id: 'node-2',
        parentNodeId: 'node-1',
        name: 'Overview',
        slug: 'overview',
        nodeType: 'document',
        documentId: 'doc-1',
      }),
      nodeRow({
        id: 'node-3',
        parentNodeId: 'node-1',
        position: 1,
        name: 'Features',
        slug: 'features',
        nodeType: 'document',
        documentId: 'doc-2',
      }),
      nodeRow({
        id: 'node-4',
        position: 1,
        name: 'About',
        slug: 'about',
        nodeType: 'document',
        documentId: 'doc-3',
      }),
    ]);
    on(documents).select.returns([
      { id: 'doc-1', path: 'pages/overview' },
      { id: 'doc-2', path: 'pages/features' },
      { id: 'doc-3', path: 'pages/about' },
    ]);

    const tree = await buildNavigationTree('struct-1');

    expect(tree).toHaveLength(2); // Two root nodes
    expect(tree[0].name).toBe('Products');
    expect(tree[0].children).toHaveLength(2); // Two children
    expect(tree[0].children[0].name).toBe('Overview');
    expect(tree[0].children[1].name).toBe('Features');
    expect(tree[1].name).toBe('About');
    expect(tree[1].children).toHaveLength(0);
  });

  it('should sort nodes by position', async () => {
    const { on } = stubDatabase();
    on(structureNodes).select.returns([
      nodeRow({ id: 'node-2', position: 1, name: 'Second', slug: 'second' }),
      nodeRow({ id: 'node-1', position: 0, name: 'First', slug: 'first' }),
    ]);

    const tree = await buildNavigationTree('struct-1');

    expect(tree[0].name).toBe('First');
    expect(tree[1].name).toBe('Second');
  });

  it('should include document path for document nodes', async () => {
    const { on } = stubDatabase();
    on(structureNodes).select.returns([
      nodeRow({
        id: 'node-1',
        name: 'Page',
        slug: 'page',
        nodeType: 'document',
        documentId: 'doc-1',
      }),
    ]);
    on(documents).select.returns([{ id: 'doc-1', path: 'pages/home' }]);

    const tree = await buildNavigationTree('struct-1');

    expect(tree[0].documentPath).toBe('pages/home');
  });
});

describe('Error Classes', () => {
  it('should export NodeNotFoundError with correct properties', () => {
    const error = new NodeNotFoundError('node-123');

    expect(error.name).toBe('NodeNotFoundError');
    expect(error.nodeId).toBe('node-123');
    expect(error.message).toContain('node-123');
  });

  it('should export DuplicateNodeSlugError with correct properties', () => {
    const error = new DuplicateNodeSlugError('struct-1', 'products');

    expect(error.name).toBe('DuplicateNodeSlugError');
    expect(error.structureId).toBe('struct-1');
    expect(error.slug).toBe('products');
  });

  it('should export CircularReferenceError with correct properties', () => {
    const error = new CircularReferenceError('node-1', 'node-2');

    expect(error.name).toBe('CircularReferenceError');
    expect(error.nodeId).toBe('node-1');
    expect(error.targetParentId).toBe('node-2');
  });
});
