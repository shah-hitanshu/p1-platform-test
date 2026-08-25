/**
 * Structure Service - Types, Interfaces, and Error Classes
 *
 * Parameter interfaces, result types, database row mappings,
 * error classes, and mapper functions for the structure service.
 */

import type { StructureNode, StructureType, NodeType } from '../types';
import { InvalidSlugError } from './errors';

// =============================================================================
// Parameter & Result Types
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
// Slug Normalization
// =============================================================================

export function normalizeSlug(slug: string): string {
  if (!slug || slug.trim() === '') {
    throw new InvalidSlugError('slug cannot be empty');
  }

  const normalized = slug.trim().toLowerCase();

  if (!/^[a-z0-9._-]+$/.test(normalized)) {
    throw new InvalidSlugError(
      `slug "${slug}" contains invalid characters; only letters, numbers, hyphens, underscores, and dots are allowed`,
    );
  }

  return normalized;
}

// =============================================================================
// Database Row Types
// =============================================================================

/**
 * Site structure definition (minimal after migration 007).
 */
export interface StructureDefinitionRow {
  id: string;
  site_id: string;
  created_at: string;
}

/**
 * Branch structure state (includes identity after migration 007).
 */
export interface BranchStructureRow {
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

export interface NodeRow {
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

export function mapBranchStructureRow(row: BranchStructureRow): BranchStructure {
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

export function mapNodeRow(row: NodeRow): StructureNode {
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
