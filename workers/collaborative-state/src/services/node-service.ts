/**
 * Node Service - Structure Node CRUD and Operations
 *
 * Manages structure nodes: create, read, update, delete, move, reorder,
 * and navigation tree building.
 */

import { query } from '../db';
import type { StructureNode, NodeType } from '../types';
import type {
  CreateNodeParams,
  UpdateNodeParams,
  ListNodesOptions,
  MoveNodeParams,
  NavigationTreeNode,
  NodeRow,
} from './structure-types';
import {
  mapNodeRow,
  normalizeSlug,
} from './structure-types';
import {
  StructureNotFoundError,
  NodeNotFoundError,
  DuplicateNodeSlugError,
  CircularReferenceError,
} from './errors';

// =============================================================================
// Node CRUD
// =============================================================================

/**
 * Create a new structure node.
 */
export async function createNode(params: CreateNodeParams): Promise<StructureNode> {
  const { structureId, parentNodeId, name, nodeType, documentId, externalUrl, position } =
    params;
  const slug = normalizeSlug(params.slug);

  try {
    const result = await query<NodeRow>(
      `INSERT INTO app.structure_nodes
       (structure_id, parent_node_id, name, slug, node_type, document_id, external_url, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        structureId,
        parentNodeId ?? null,
        name,
        slug,
        nodeType,
        documentId ?? null,
        externalUrl ?? null,
        position,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new StructureNotFoundError(structureId);
    }
    return mapNodeRow(row);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const pgError = error as Error & { code: string };
      if (pgError.code === '23505') {
        throw new DuplicateNodeSlugError(structureId, slug);
      }
      if (pgError.code === '23503') {
        throw new StructureNotFoundError(structureId);
      }
    }
    throw error;
  }
}

/**
 * Get a node by ID.
 */
export async function getNode(nodeId: string): Promise<StructureNode | null> {
  const result = await query<NodeRow>(
    'SELECT * FROM app.structure_nodes WHERE id = $1',
    [nodeId],
  );

  const nodeRow = result.rows[0];
  if (!nodeRow) {
    return null;
  }

  return mapNodeRow(nodeRow);
}

/**
 * List nodes in a structure.
 */
export async function listNodes(options: ListNodesOptions): Promise<StructureNode[]> {
  const { structureId, parentNodeId } = options;

  let sql = 'SELECT * FROM app.structure_nodes WHERE structure_id = $1';
  const params: (string | null)[] = [structureId];

  if (parentNodeId !== undefined) {
    if (parentNodeId === null) {
      sql += ' AND parent_node_id IS NULL';
    } else {
      sql += ' AND parent_node_id = $2';
      params.push(parentNodeId);
    }
  }

  sql += ' ORDER BY position ASC';

  const result = await query<NodeRow>(sql, params);
  return result.rows.map(mapNodeRow);
}

/**
 * Update a node.
 */
export async function updateNode(
  nodeId: string,
  updates: UpdateNodeParams,
): Promise<StructureNode> {
  const setClauses: string[] = [];
  const params: (string | null)[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${String(paramIndex)}`);
    params.push(updates.name);
    paramIndex++;
  }

  if (updates.slug !== undefined) {
    const normalizedSlug = normalizeSlug(updates.slug);
    setClauses.push(`slug = $${String(paramIndex)}`);
    params.push(normalizedSlug);
    paramIndex++;
  }

  if (updates.documentId !== undefined) {
    setClauses.push(`document_id = $${String(paramIndex)}`);
    params.push(updates.documentId);
    paramIndex++;
  }

  if (updates.externalUrl !== undefined) {
    setClauses.push(`external_url = $${String(paramIndex)}`);
    params.push(updates.externalUrl);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    const existing = await getNode(nodeId);
    if (existing === null) {
      throw new NodeNotFoundError(nodeId);
    }
    return existing;
  }

  params.push(nodeId);

  const result = await query<NodeRow>(
    `UPDATE app.structure_nodes SET ${setClauses.join(', ')} WHERE id = $${String(paramIndex)} RETURNING *`,
    params,
  );

  if (result.rows.length === 0) {
    throw new NodeNotFoundError(nodeId);
  }

  const updatedRow = result.rows[0];
  if (!updatedRow) {
    throw new NodeNotFoundError(nodeId);
  }
  return mapNodeRow(updatedRow);
}

/**
 * Delete a node.
 */
export async function deleteNode(nodeId: string): Promise<void> {
  const result = await query<{ id: string }>(
    'DELETE FROM app.structure_nodes WHERE id = $1 RETURNING id',
    [nodeId],
  );

  if (result.rows.length === 0) {
    throw new NodeNotFoundError(nodeId);
  }
}

// =============================================================================
// Node Operations
// =============================================================================

/**
 * Move a node to a new parent and/or position.
 */
export async function moveNode(
  nodeId: string,
  params: MoveNodeParams,
): Promise<StructureNode> {
  const { newParentId, newPosition } = params;

  // First, get the node to verify it exists
  const node = await getNode(nodeId);
  if (node === null) {
    throw new NodeNotFoundError(nodeId);
  }

  // Check for circular reference if moving to a new parent
  if (newParentId !== null) {
    const ancestorResult = await query<{ id: string }>(
      `WITH RECURSIVE ancestry AS (
        SELECT id, parent_node_id FROM app.structure_nodes WHERE id = $1
        UNION ALL
        SELECT n.id, n.parent_node_id
        FROM app.structure_nodes n
        JOIN ancestry a ON n.id = a.parent_node_id
      )
      SELECT id FROM ancestry WHERE id = $2`,
      [newParentId, nodeId],
    );

    if (ancestorResult.rows.length > 0) {
      throw new CircularReferenceError(nodeId, newParentId);
    }
  }

  // Update the node
  const result = await query<NodeRow>(
    `UPDATE app.structure_nodes
     SET parent_node_id = $1, position = $2
     WHERE id = $3
     RETURNING *`,
    [newParentId, newPosition, nodeId],
  );

  if (result.rows.length === 0) {
    throw new NodeNotFoundError(nodeId);
  }

  const movedRow = result.rows[0];
  if (!movedRow) {
    throw new NodeNotFoundError(nodeId);
  }
  return mapNodeRow(movedRow);
}

/**
 * Reorder nodes within a parent.
 */
export async function reorderNodes(
  structureId: string,
  parentNodeId: string | null,
  nodeIds: string[],
): Promise<void> {
  // Update each node's position
  for (let i = 0; i < nodeIds.length; i++) {
    await query(
      `UPDATE app.structure_nodes
       SET position = $1
       WHERE id = $2 AND structure_id = $3 AND
       ${parentNodeId === null ? 'parent_node_id IS NULL' : 'parent_node_id = $4'}
       RETURNING id`,
      parentNodeId === null
        ? [i, nodeIds[i], structureId]
        : [i, nodeIds[i], structureId, parentNodeId],
    );
  }
}

// =============================================================================
// Navigation Tree
// =============================================================================

/**
 * Build a navigation tree from structure nodes.
 */
export async function buildNavigationTree(structureId: string): Promise<NavigationTreeNode[]> {
  // Get all nodes in the structure
  const nodeResult = await query<NodeRow>(
    'SELECT * FROM app.structure_nodes WHERE structure_id = $1 ORDER BY position ASC',
    [structureId],
  );

  if (nodeResult.rows.length === 0) {
    return [];
  }

  const nodeRows = nodeResult.rows;

  // Get document paths for document nodes
  const documentIds = nodeRows
    .filter((row) => row.document_id !== null)
    .map((row) => row.document_id);

  const documentPaths = new Map<string, string>();
  if (documentIds.length > 0) {
    const docResult = await query<{ id: string; path: string }>(
      'SELECT id, path FROM app.documents WHERE id = ANY($1)',
      [documentIds],
    );
    for (const doc of docResult.rows) {
      documentPaths.set(doc.id, doc.path);
    }
  }

  // Build tree structure
  const nodesById = new Map<string, NavigationTreeNode>();
  const rootNodes: NavigationTreeNode[] = [];

  // First pass: create all nodes
  for (const row of nodeRows) {
    const treeNode: NavigationTreeNode = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      nodeType: row.node_type as NodeType,
      position: row.position,
      children: [],
    };

    if (row.document_id !== null) {
      treeNode.documentId = row.document_id;
      const path = documentPaths.get(row.document_id);
      if (path !== undefined) {
        treeNode.documentPath = path;
      }
    }

    if (row.external_url !== null) {
      treeNode.externalUrl = row.external_url;
    }

    nodesById.set(row.id, treeNode);
  }

  // Second pass: build hierarchy
  for (const row of nodeRows) {
    const node = nodesById.get(row.id);
    if (node === undefined) continue;

    if (row.parent_node_id === null) {
      rootNodes.push(node);
    } else {
      const parent = nodesById.get(row.parent_node_id);
      if (parent !== undefined) {
        parent.children.push(node);
      }
    }
  }

  // Sort children by position
  function sortChildren(nodes: NavigationTreeNode[]): void {
    nodes.sort((a, b) => a.position - b.position);
    for (const node of nodes) {
      sortChildren(node.children);
    }
  }

  sortChildren(rootNodes);

  return rootNodes;
}
