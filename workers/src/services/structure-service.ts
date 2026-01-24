/**
 * Phase 6.1: Structure Service
 *
 * Manages site structures and structure nodes for hierarchical
 * document organization.
 *
 * Based on collaborative-state-system-architecture-v2.2.md
 */

import { query } from '../db';
import type { SiteStructure, StructureNode, StructureType, NodeType } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a site structure.
 */
export interface CreateStructureParams {
  siteId: string;
  name: string;
  slug: string;
  description?: string;
  structureType: StructureType;
}

/**
 * Parameters for updating a site structure.
 */
export interface UpdateStructureParams {
  name?: string;
  description?: string;
}

/**
 * Options for listing structures.
 */
export interface ListStructuresOptions {
  siteId: string;
  structureType?: StructureType;
}

/**
 * Parameters for creating a structure node.
 */
export interface CreateNodeParams {
  structureId: string;
  parentNodeId?: string;
  name: string;
  slug: string;
  nodeType: NodeType;
  documentId?: string;
  externalUrl?: string;
  position: number;
}

/**
 * Parameters for updating a structure node.
 */
export interface UpdateNodeParams {
  name?: string;
  slug?: string;
  documentId?: string;
  externalUrl?: string;
}

/**
 * Options for listing nodes.
 */
export interface ListNodesOptions {
  structureId: string;
  parentNodeId?: string | null;
}

/**
 * Parameters for moving a node.
 */
export interface MoveNodeParams {
  newParentId: string | null;
  newPosition: number;
}

/**
 * Navigation tree node with children.
 */
export interface NavigationTreeNode {
  id: string;
  name: string;
  slug: string;
  nodeType: NodeType;
  documentId?: string;
  documentPath?: string;
  externalUrl?: string;
  position: number;
  children: NavigationTreeNode[];
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when a site is not found.
 */
export class SiteNotFoundError extends Error {
  public readonly name = 'SiteNotFoundError';

  constructor(public readonly siteId: string) {
    super(`Site "${siteId}" not found.`);
    Object.setPrototypeOf(this, SiteNotFoundError.prototype);
  }
}

/**
 * Error thrown when a structure is not found.
 */
export class StructureNotFoundError extends Error {
  public readonly name = 'StructureNotFoundError';

  constructor(public readonly structureId: string) {
    super(`Structure "${structureId}" not found.`);
    Object.setPrototypeOf(this, StructureNotFoundError.prototype);
  }
}

/**
 * Error thrown when a node is not found.
 */
export class NodeNotFoundError extends Error {
  public readonly name = 'NodeNotFoundError';

  constructor(public readonly nodeId: string) {
    super(`Node "${nodeId}" not found.`);
    Object.setPrototypeOf(this, NodeNotFoundError.prototype);
  }
}

/**
 * Error thrown when a structure slug already exists.
 */
export class DuplicateStructureSlugError extends Error {
  public readonly name = 'DuplicateStructureSlugError';

  constructor(
    public readonly siteId: string,
    public readonly slug: string,
  ) {
    super(`Structure with slug "${slug}" already exists in site "${siteId}".`);
    Object.setPrototypeOf(this, DuplicateStructureSlugError.prototype);
  }
}

/**
 * Error thrown when a node slug already exists in the same parent.
 */
export class DuplicateNodeSlugError extends Error {
  public readonly name = 'DuplicateNodeSlugError';

  constructor(
    public readonly structureId: string,
    public readonly slug: string,
  ) {
    super(`Node with slug "${slug}" already exists in structure "${structureId}".`);
    Object.setPrototypeOf(this, DuplicateNodeSlugError.prototype);
  }
}

/**
 * Error thrown when moving a node would create a circular reference.
 */
export class CircularReferenceError extends Error {
  public readonly name = 'CircularReferenceError';

  constructor(
    public readonly nodeId: string,
    public readonly targetParentId: string,
  ) {
    super(`Moving node "${nodeId}" to parent "${targetParentId}" would create a circular reference.`);
    Object.setPrototypeOf(this, CircularReferenceError.prototype);
  }
}

// =============================================================================
// Database Row Types
// =============================================================================

interface StructureRow {
  id: string;
  site_id: string;
  name: string;
  slug: string;
  description?: string;
  structure_type: string;
  created_at: string;
}

interface NodeRow {
  id: string;
  structure_id: string;
  parent_node_id: string | null;
  position: number;
  name: string;
  slug: string;
  node_type: string;
  document_id: string | null;
  external_url: string | null;
  created_at: string;
}

// =============================================================================
// Mappers
// =============================================================================

function mapStructureRow(row: StructureRow): SiteStructure {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    structureType: row.structure_type as StructureType,
    createdAt: row.created_at,
  };
}

function mapNodeRow(row: NodeRow): StructureNode {
  const node: StructureNode = {
    id: row.id,
    structureId: row.structure_id,
    position: row.position,
    name: row.name,
    slug: row.slug,
    nodeType: row.node_type as NodeType,
    createdAt: row.created_at,
  };

  if (row.parent_node_id !== null) {
    node.parentNodeId = row.parent_node_id;
  }
  if (row.document_id !== null) {
    node.documentId = row.document_id;
  }
  if (row.external_url !== null) {
    node.externalUrl = row.external_url;
  }

  return node;
}

// =============================================================================
// Structure CRUD
// =============================================================================

/**
 * Create a new site structure.
 */
export async function createStructure(params: CreateStructureParams): Promise<SiteStructure> {
  const { siteId, name, slug, description, structureType } = params;

  try {
    const result = await query<StructureRow>(
      `INSERT INTO app.site_structures (site_id, name, slug, description, structure_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [siteId, name, slug, description ?? null, structureType],
    );

    return mapStructureRow(result.rows[0]);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const pgError = error as Error & { code: string };
      if (pgError.code === '23505') {
        throw new DuplicateStructureSlugError(siteId, slug);
      }
      if (pgError.code === '23503') {
        throw new SiteNotFoundError(siteId);
      }
    }
    throw error;
  }
}

/**
 * Get a structure by ID.
 */
export async function getStructure(structureId: string): Promise<SiteStructure | null> {
  const result = await query<StructureRow>(
    'SELECT * FROM app.site_structures WHERE id = $1',
    [structureId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapStructureRow(result.rows[0]);
}

/**
 * Get a structure by site ID and slug.
 */
export async function getStructureBySlug(
  siteId: string,
  slug: string,
): Promise<SiteStructure | null> {
  const result = await query<StructureRow>(
    'SELECT * FROM app.site_structures WHERE site_id = $1 AND slug = $2',
    [siteId, slug],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapStructureRow(result.rows[0]);
}

/**
 * List structures for a site.
 */
export async function listStructures(options: ListStructuresOptions): Promise<SiteStructure[]> {
  const { siteId, structureType } = options;

  let sql = 'SELECT * FROM app.site_structures WHERE site_id = $1';
  const params: (string | null)[] = [siteId];

  if (structureType !== undefined) {
    sql += ' AND structure_type = $2';
    params.push(structureType);
  }

  sql += ' ORDER BY created_at ASC';

  const result = await query<StructureRow>(sql, params);
  return result.rows.map(mapStructureRow);
}

/**
 * Update a structure.
 */
export async function updateStructure(
  structureId: string,
  updates: UpdateStructureParams,
): Promise<SiteStructure> {
  const setClauses: string[] = [];
  const params: (string | null)[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${String(paramIndex)}`);
    params.push(updates.name);
    paramIndex++;
  }

  if (updates.description !== undefined) {
    setClauses.push(`description = $${String(paramIndex)}`);
    params.push(updates.description);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    const existing = await getStructure(structureId);
    if (existing === null) {
      throw new StructureNotFoundError(structureId);
    }
    return existing;
  }

  params.push(structureId);

  const result = await query<StructureRow>(
    `UPDATE app.site_structures SET ${setClauses.join(', ')} WHERE id = $${String(paramIndex)} RETURNING *`,
    params,
  );

  if (result.rows.length === 0) {
    throw new StructureNotFoundError(structureId);
  }

  return mapStructureRow(result.rows[0]);
}

/**
 * Delete a structure.
 */
export async function deleteStructure(structureId: string): Promise<void> {
  const result = await query<{ id: string }>(
    'DELETE FROM app.site_structures WHERE id = $1 RETURNING id',
    [structureId],
  );

  if (result.rows.length === 0) {
    throw new StructureNotFoundError(structureId);
  }
}

// =============================================================================
// Node CRUD
// =============================================================================

/**
 * Create a new structure node.
 */
export async function createNode(params: CreateNodeParams): Promise<StructureNode> {
  const { structureId, parentNodeId, name, slug, nodeType, documentId, externalUrl, position } =
    params;

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

    return mapNodeRow(result.rows[0]);
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

  if (result.rows.length === 0) {
    return null;
  }

  return mapNodeRow(result.rows[0]);
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
    setClauses.push(`slug = $${String(paramIndex)}`);
    params.push(updates.slug);
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

  return mapNodeRow(result.rows[0]);
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

  return mapNodeRow(result.rows[0]);
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
