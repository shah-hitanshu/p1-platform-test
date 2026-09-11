/**
 * Node Service - Structure Node CRUD and Operations
 *
 * Manages structure nodes: create, read, update, delete, move, reorder,
 * and navigation tree building.
 */

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { driverErrorCode } from '../db/driver-error';
import { documents, structureNodes } from '../db/schema';
import { db } from '../db/scope';
import type { StructureNode, NodeType } from '../types';
import type {
  CreateNodeParams,
  UpdateNodeParams,
  ListNodesOptions,
  MoveNodeParams,
  NavigationTreeNode,
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
export async function createNode(
  params: CreateNodeParams,
): Promise<StructureNode> {
  const { structureId, parentNodeId, name, nodeType, documentId, externalUrl, position } =
    params;
  const slug = normalizeSlug(params.slug);

  try {
    const [row] = await db()
      .insert(structureNodes)
      .values({
        structureId,
        parentNodeId: parentNodeId ?? null,
        name,
        slug,
        nodeType,
        documentId: documentId ?? null,
        externalUrl: externalUrl ?? null,
        position,
      })
      .returning();

    if (!row) {
      throw new StructureNotFoundError(structureId);
    }
    return mapNodeRow(row);
  } catch (error) {
    const code = driverErrorCode(error);
    if (code === '23505') {
      throw new DuplicateNodeSlugError(structureId, slug);
    }
    if (code === '23503') {
      throw new StructureNotFoundError(structureId);
    }
    throw error;
  }
}

/**
 * Get a node by ID.
 */
export async function getNode(nodeId: string): Promise<StructureNode | null> {
  const [nodeRow] = await db()
    .select()
    .from(structureNodes)
    .where(eq(structureNodes.id, nodeId));

  if (nodeRow === undefined) {
    return null;
  }

  return mapNodeRow(nodeRow);
}

/**
 * List nodes in a structure.
 */
export async function listNodes(
  options: ListNodesOptions,
): Promise<StructureNode[]> {
  const { structureId, parentNodeId } = options;

  const conditions = [eq(structureNodes.structureId, structureId)];

  if (parentNodeId !== undefined) {
    conditions.push(
      parentNodeId === null
        ? isNull(structureNodes.parentNodeId)
        : eq(structureNodes.parentNodeId, parentNodeId),
    );
  }

  const rows = await db()
    .select()
    .from(structureNodes)
    .where(and(...conditions))
    .orderBy(asc(structureNodes.position));

  return rows.map(mapNodeRow);
}

/**
 * Update a node.
 */
export async function updateNode(
  nodeId: string,
  updates: UpdateNodeParams,
): Promise<StructureNode> {
  const values: PgUpdateSetSource<typeof structureNodes> = {};

  if (updates.name !== undefined) {
    values.name = updates.name;
  }

  if (updates.slug !== undefined) {
    values.slug = normalizeSlug(updates.slug);
  }

  if (updates.documentId !== undefined) {
    values.documentId = updates.documentId;
  }

  if (updates.externalUrl !== undefined) {
    values.externalUrl = updates.externalUrl;
  }

  if (Object.keys(values).length === 0) {
    const existing = await getNode(nodeId);
    if (existing === null) {
      throw new NodeNotFoundError(nodeId);
    }
    return existing;
  }

  const [updatedRow] = await db()
    .update(structureNodes)
    .set(values)
    .where(eq(structureNodes.id, nodeId))
    .returning();

  if (updatedRow === undefined) {
    throw new NodeNotFoundError(nodeId);
  }
  return mapNodeRow(updatedRow);
}

/**
 * Delete a node.
 */
export async function deleteNode(nodeId: string): Promise<void> {
  const deleted = await db()
    .delete(structureNodes)
    .where(eq(structureNodes.id, nodeId))
    .returning({ id: structureNodes.id });

  if (deleted.length === 0) {
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
    const ancestors = await db().execute<{ id: string }>(sql`
      WITH RECURSIVE ancestry AS (
        SELECT id, parent_node_id FROM app.structure_nodes WHERE id = ${newParentId}
        UNION ALL
        SELECT n.id, n.parent_node_id
        FROM app.structure_nodes n
        JOIN ancestry a ON n.id = a.parent_node_id
      )
      SELECT id FROM ancestry WHERE id = ${nodeId}`);

    if (ancestors.length > 0) {
      throw new CircularReferenceError(nodeId, newParentId);
    }
  }

  // Update the node
  const [movedRow] = await db()
    .update(structureNodes)
    .set({ parentNodeId: newParentId, position: newPosition })
    .where(eq(structureNodes.id, nodeId))
    .returning();

  if (movedRow === undefined) {
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
    await db()
      .update(structureNodes)
      .set({ position: i })
      .where(
        and(
          eq(structureNodes.id, nodeIds[i] ?? ''),
          eq(structureNodes.structureId, structureId),
          parentNodeId === null
            ? isNull(structureNodes.parentNodeId)
            : eq(structureNodes.parentNodeId, parentNodeId),
        ),
      )
      .returning({ id: structureNodes.id });
  }
}

// =============================================================================
// Navigation Tree
// =============================================================================

/**
 * Build a navigation tree from structure nodes.
 */
export async function buildNavigationTree(
  structureId: string,
): Promise<NavigationTreeNode[]> {
  // Get all nodes in the structure
  const nodeRows = await db()
    .select()
    .from(structureNodes)
    .where(eq(structureNodes.structureId, structureId))
    .orderBy(asc(structureNodes.position));

  if (nodeRows.length === 0) {
    return [];
  }

  // Get document paths for document nodes
  const documentIds = nodeRows
    .map((row) => row.documentId)
    .filter((id): id is string => id !== null);

  const documentPaths = new Map<string, string>();
  if (documentIds.length > 0) {
    const docRows = await db()
      .select({ id: documents.id, path: documents.path })
      .from(documents)
      .where(inArray(documents.id, documentIds));
    for (const doc of docRows) {
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
      nodeType: row.nodeType as NodeType,
      position: row.position,
      children: [],
    };

    if (row.documentId !== null) {
      treeNode.documentId = row.documentId;
      const path = documentPaths.get(row.documentId);
      if (path !== undefined) {
        treeNode.documentPath = path;
      }
    }

    if (row.externalUrl !== null) {
      treeNode.externalUrl = row.externalUrl;
    }

    nodesById.set(row.id, treeNode);
  }

  // Second pass: build hierarchy
  for (const row of nodeRows) {
    const node = nodesById.get(row.id);
    if (node === undefined) continue;

    if (row.parentNodeId === null) {
      rootNodes.push(node);
    } else {
      const parent = nodesById.get(row.parentNodeId);
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
