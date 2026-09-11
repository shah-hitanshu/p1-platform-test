/**
 * Structure Service - Types, Interfaces, and Error Classes
 *
 * Parameter interfaces, result types, database row mappings,
 * error classes, and mapper functions for the structure service.
 */

import type { StructureNode, StructureType, NodeType } from '../types';
import type { branchStructureState, siteStructures, structureNodes } from '../db/schema';
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
  description?: string | null;
  structureType: StructureType;
  structureTree: Record<string, unknown>[];
  metadataSchema: Record<string, unknown>;
  schemaEnforcement: string;
  createdAt: Date | null;
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
 * A structure's branch-scoped state joined to the site it belongs to.
 *
 * Identity (name, slug) lives on the branch row; the owning site and the
 * creation time live on the definition, so neither table describes the whole
 * structure on its own.
 */
export type BranchStructureRow =
  Pick<
    typeof branchStructureState.$inferSelect,
    | 'structureId'
    | 'branchId'
    | 'name'
    | 'slug'
    | 'description'
    | 'structureType'
    | 'structureTree'
    | 'metadataSchema'
    | 'schemaEnforcement'
  >
  & Pick<typeof siteStructures.$inferSelect, 'siteId' | 'createdAt'>;

// =============================================================================
// Mappers
// =============================================================================

export function mapBranchStructureRow(row: BranchStructureRow): BranchStructure {
  return {
    id: row.structureId,
    siteId: row.siteId,
    branchId: row.branchId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    structureType: row.structureType as StructureType,
    structureTree: row.structureTree as Record<string, unknown>[],
    metadataSchema: row.metadataSchema as Record<string, unknown>,
    schemaEnforcement: row.schemaEnforcement,
    createdAt: row.createdAt,
  };
}

export function mapNodeRow(row: typeof structureNodes.$inferSelect): StructureNode {
  const node: StructureNode = {
    id: row.id,
    structureId: row.structureId,
    position: row.position,
    name: row.name,
    slug: row.slug,
    nodeType: row.nodeType as NodeType,
    createdAt: row.createdAt,
  };

  if (row.parentNodeId !== null) {
    node.parentNodeId = row.parentNodeId;
  }
  if (row.documentId !== null) {
    node.documentId = row.documentId;
  }
  if (row.externalUrl !== null) {
    node.externalUrl = row.externalUrl;
  }

  return node;
}
