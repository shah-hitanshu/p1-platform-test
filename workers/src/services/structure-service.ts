/**
 * Phase 6.1 + 7.1.1a: Structure Service
 *
 * Manages site structures and structure nodes for hierarchical
 * document organization.
 *
 * Phase 7.1.1a Updates:
 * - Structure identity (name, slug) is now branch-scoped
 * - createStructure atomically creates definition + branch state
 * - Added getBranchStructure, getBranchStructureBySlug, listBranchStructures
 * - Added updateBranchStructure, deleteBranchStructure
 * - Added copyStructureStateForBranch for branch creation
 *
 * Based on collaborative-state-system-architecture-v2.2.md
 */

import { query } from '../db';
import type { StructureNode, StructureType, NodeType } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a site structure (branch-scoped).
 * Creates both the definition and branch state atomically.
 */
export interface CreateStructureParams {
  siteId: string;
  branchId: string;
  name: string;
  slug: string;
  description?: string;
  structureType: StructureType;
}

/**
 * Parameters for updating a branch structure.
 */
export interface UpdateBranchStructureParams {
  name?: string;
  slug?: string;
  description?: string;
}

/**
 * Branch-scoped structure (with identity from branch_structure_state).
 */
export interface BranchStructure {
  id: string;
  siteId: string;
  branchId: string;
  name: string;
  slug: string;
  description?: string;
  structureType: StructureType;
  structureTree: Record<string, unknown>[];
  metadataSchema: Record<string, unknown>;
  schemaEnforcement: string;
  createdAt: string;
}

/**
 * Options for listing structures (site-level - deprecated).
 */
export interface ListStructuresOptions {
  siteId: string;
  structureType?: StructureType;
}

/**
 * Options for listing branch structures.
 */
export interface ListBranchStructuresOptions {
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

/**
 * Site structure definition (minimal after migration 007).
 */
interface StructureDefinitionRow {
  id: string;
  site_id: string;
  created_at: string;
}

/**
 * Branch structure state (includes identity after migration 007).
 */
interface BranchStructureRow {
  structure_id: string;
  site_id: string;
  branch_id: string;
  name: string;
  slug: string;
  description?: string;
  structure_type: string;
  structure_tree: Record<string, unknown>[];
  metadata_schema: Record<string, unknown>;
  schema_enforcement: string;
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

function mapBranchStructureRow(row: BranchStructureRow): BranchStructure {
  return {
    id: row.structure_id,
    siteId: row.site_id,
    branchId: row.branch_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    structureType: row.structure_type as StructureType,
    structureTree: row.structure_tree,
    metadataSchema: row.metadata_schema,
    schemaEnforcement: row.schema_enforcement,
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
// Structure CRUD (Branch-Scoped - Phase 7.1.1a)
// =============================================================================

/**
 * Create a new site structure (atomic: definition + branch state).
 * Creates both the site_structures definition and branch_structure_state entry.
 */
export async function createStructure(params: CreateStructureParams): Promise<BranchStructure> {
  const { siteId, branchId, name, slug, description, structureType } = params;

  try {
    // Step 1: Create the structure definition (minimal - just ID and site)
    const defResult = await query<StructureDefinitionRow>(
      `INSERT INTO app.site_structures (site_id)
       VALUES ($1)
       RETURNING *`,
      [siteId],
    );

    const structureId = defResult.rows[0].id;
    const createdAt = defResult.rows[0].created_at;

    // Step 2: Create the branch structure state (with identity)
    const defaultSchema = JSON.stringify({
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    });

    const stateResult = await query<BranchStructureRow>(
      `INSERT INTO app.branch_structure_state
       (branch_id, structure_id, name, slug, description, structure_type,
        structure_tree, metadata_schema, schema_enforcement)
       VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $9::jsonb, 'warn')
       RETURNING
         structure_id,
         $7::uuid AS site_id,
         branch_id,
         name,
         slug,
         description,
         structure_type,
         structure_tree,
         metadata_schema,
         schema_enforcement,
         $8::timestamptz AS created_at`,
      [
        branchId,
        structureId,
        name,
        slug,
        description ?? null,
        structureType,
        siteId,
        createdAt,
        defaultSchema,
      ],
    );

    return mapBranchStructureRow(stateResult.rows[0]);
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
 * Get a branch structure by structure ID.
 */
export async function getBranchStructure(
  branchId: string,
  structureId: string,
): Promise<BranchStructure | null> {
  const result = await query<BranchStructureRow>(
    `SELECT
       bss.structure_id,
       ss.site_id,
       bss.branch_id,
       bss.name,
       bss.slug,
       bss.description,
       bss.structure_type,
       bss.structure_tree,
       bss.metadata_schema,
       bss.schema_enforcement,
       ss.created_at
     FROM app.branch_structure_state bss
     JOIN app.site_structures ss ON ss.id = bss.structure_id
     WHERE bss.branch_id = $1 AND bss.structure_id = $2`,
    [branchId, structureId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapBranchStructureRow(result.rows[0]);
}

/**
 * Get a branch structure by slug.
 */
export async function getBranchStructureBySlug(
  branchId: string,
  slug: string,
): Promise<BranchStructure | null> {
  const result = await query<BranchStructureRow>(
    `SELECT
       bss.structure_id,
       ss.site_id,
       bss.branch_id,
       bss.name,
       bss.slug,
       bss.description,
       bss.structure_type,
       bss.structure_tree,
       bss.metadata_schema,
       bss.schema_enforcement,
       ss.created_at
     FROM app.branch_structure_state bss
     JOIN app.site_structures ss ON ss.id = bss.structure_id
     WHERE bss.branch_id = $1 AND bss.slug = $2`,
    [branchId, slug],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapBranchStructureRow(result.rows[0]);
}

/**
 * List structures on a branch.
 */
export async function listBranchStructures(
  branchId: string,
  options?: ListBranchStructuresOptions,
): Promise<BranchStructure[]> {
  let sql = `
    SELECT
      bss.structure_id,
      ss.site_id,
      bss.branch_id,
      bss.name,
      bss.slug,
      bss.description,
      bss.structure_type,
      bss.structure_tree,
      bss.metadata_schema,
      bss.schema_enforcement,
      ss.created_at
    FROM app.branch_structure_state bss
    JOIN app.site_structures ss ON ss.id = bss.structure_id
    WHERE bss.branch_id = $1`;

  const params: string[] = [branchId];

  if (options?.structureType !== undefined) {
    sql += ' AND bss.structure_type = $2';
    params.push(options.structureType);
  }

  sql += ' ORDER BY ss.created_at ASC';

  const result = await query<BranchStructureRow>(sql, params);
  return result.rows.map(mapBranchStructureRow);
}

/**
 * Update a branch structure.
 */
export async function updateBranchStructure(
  branchId: string,
  structureId: string,
  updates: UpdateBranchStructureParams,
): Promise<BranchStructure> {
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

  if (updates.description !== undefined) {
    setClauses.push(`description = $${String(paramIndex)}`);
    params.push(updates.description);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    const existing = await getBranchStructure(branchId, structureId);
    if (existing === null) {
      throw new StructureNotFoundError(structureId);
    }
    return existing;
  }

  params.push(branchId, structureId);

  try {
    const result = await query<{ structure_id: string }>(
      `UPDATE app.branch_structure_state
       SET ${setClauses.join(', ')}
       WHERE branch_id = $${String(paramIndex)} AND structure_id = $${String(paramIndex + 1)}
       RETURNING structure_id`,
      params,
    );

    if (result.rows.length === 0) {
      throw new StructureNotFoundError(structureId);
    }

    // Fetch the full updated structure
    const updated = await getBranchStructure(branchId, structureId);
    if (updated === null) {
      throw new StructureNotFoundError(structureId);
    }
    return updated;
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const pgError = error as Error & { code: string };
      if (pgError.code === '23505') {
        throw new DuplicateStructureSlugError(branchId, updates.slug ?? '');
      }
    }
    throw error;
  }
}

/**
 * Delete a branch structure.
 * If this is the last branch referencing the definition, cascade delete it.
 */
export async function deleteBranchStructure(
  branchId: string,
  structureId: string,
): Promise<void> {
  // Step 1: Delete from branch_structure_state
  const deleteResult = await query<{ structure_id: string }>(
    `DELETE FROM app.branch_structure_state
     WHERE branch_id = $1 AND structure_id = $2
     RETURNING structure_id`,
    [branchId, structureId],
  );

  if (deleteResult.rows.length === 0) {
    throw new StructureNotFoundError(structureId);
  }

  // Step 2: Check if any other branches reference this structure
  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM app.branch_structure_state WHERE structure_id = $1',
    [structureId],
  );

  const remainingRefs = parseInt(countResult.rows[0].count, 10);

  // Step 3: If no more references, cascade delete the definition
  if (remainingRefs === 0) {
    await query(
      'DELETE FROM app.site_structures WHERE id = $1',
      [structureId],
    );
  }
}

/**
 * Copy all structure state from source branch to new branch.
 * Used during branch creation.
 */
export async function copyStructureStateForBranch(
  sourceBranchId: string,
  newBranchId: string,
): Promise<void> {
  await query(
    `INSERT INTO app.branch_structure_state (
       branch_id,
       structure_id,
       name,
       slug,
       description,
       structure_type,
       structure_tree,
       metadata_schema,
       schema_enforcement,
       has_changes_since_checkpoint,
       last_modified_at,
       last_modified_by
     )
     SELECT
       $2,
       structure_id,
       name,
       slug,
       description,
       structure_type,
       structure_tree,
       metadata_schema,
       schema_enforcement,
       FALSE,
       last_modified_at,
       last_modified_by
     FROM app.branch_structure_state
     WHERE branch_id = $1`,
    [sourceBranchId, newBranchId],
  );
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
