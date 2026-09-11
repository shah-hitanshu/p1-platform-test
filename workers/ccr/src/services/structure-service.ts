/**
 * Phase 6.1 + 7.1.1a: Structure Service
 *
 * Core structure CRUD operations (branch-scoped).
 * Node operations are in node-service.ts,
 * types/errors/mappers in structure-types.ts.
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

import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { branchStructureState, siteStructures } from '../db/schema';
import { db } from '../db/scope';
import { driverErrorCode } from '../db/driver-error';
import type {
  CreateStructureParams,
  UpdateBranchStructureParams,
  BranchStructure,
  ListBranchStructuresOptions,
} from './structure-types';
import {
  mapBranchStructureRow,
  normalizeSlug,
} from './structure-types';
import {
  SiteNotFoundError,
  StructureNotFoundError,
  DuplicateStructureSlugError,
} from './errors';

// =============================================================================
// Re-exports for backward compatibility
// =============================================================================

export type {
  CreateStructureParams,
  UpdateBranchStructureParams,
  BranchStructure,
  ListStructuresOptions,
  ListBranchStructuresOptions,
  CreateNodeParams,
  UpdateNodeParams,
  ListNodesOptions,
  MoveNodeParams,
  NavigationTreeNode,
} from './structure-types';

export {
  normalizeSlug,
  mapBranchStructureRow,
  mapNodeRow,
} from './structure-types';

export {
  SiteNotFoundError,
  StructureNotFoundError,
  NodeNotFoundError,
  DuplicateStructureSlugError,
  DuplicateNodeSlugError,
  CircularReferenceError,
  InvalidSlugError,
} from './errors';

export {
  createNode,
  getNode,
  listNodes,
  updateNode,
  deleteNode,
  moveNode,
  reorderNodes,
  buildNavigationTree,
} from './node-service';

// =============================================================================
// Structure CRUD (Branch-Scoped - Phase 7.1.1a)
// =============================================================================

/**
 * The select list every branch-structure read shares: identity from the branch
 * row, ownership and creation time from the definition.
 */
const branchStructureColumns = {
  structureId: branchStructureState.structureId,
  branchId: branchStructureState.branchId,
  name: branchStructureState.name,
  slug: branchStructureState.slug,
  description: branchStructureState.description,
  structureType: branchStructureState.structureType,
  structureTree: branchStructureState.structureTree,
  metadataSchema: branchStructureState.metadataSchema,
  schemaEnforcement: branchStructureState.schemaEnforcement,
  siteId: siteStructures.siteId,
  createdAt: siteStructures.createdAt,
};

const DEFAULT_STRUCTURE_METADATA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
};

/**
 * Create a new site structure (atomic: definition + branch state).
 * Creates both the site_structures definition and branch_structure_state entry.
 */
export async function createStructure(
  params: CreateStructureParams,
): Promise<BranchStructure> {
  const { siteId, branchId, name, description, structureType } = params;
  const slug = normalizeSlug(params.slug);

  try {
    // Step 1: Create the structure definition (minimal - just ID and site)
    const [defRow] = await db()
      .insert(siteStructures)
      .values({ siteId })
      .returning();

    if (!defRow) {
      throw new SiteNotFoundError(siteId);
    }

    // Step 2: Create the branch structure state (with identity)
    const [stateRow] = await db()
      .insert(branchStructureState)
      .values({
        branchId,
        structureId: defRow.id,
        name,
        slug,
        description: description ?? null,
        structureType,
        structureTree: [],
        metadataSchema: DEFAULT_STRUCTURE_METADATA_SCHEMA,
        schemaEnforcement: 'warn',
      })
      .returning();

    if (!stateRow) {
      throw new SiteNotFoundError(siteId);
    }
    // Ownership and creation time belong to the definition just written, so the
    // branch row is completed from it rather than read back.
    return mapBranchStructureRow({ ...stateRow, siteId, createdAt: defRow.createdAt });
  } catch (error) {
    const code = driverErrorCode(error);
    if (code === '23505') {
      throw new DuplicateStructureSlugError(siteId, slug);
    }
    if (code === '23503') {
      throw new SiteNotFoundError(siteId);
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
  const [branchRow] = await db()
    .select(branchStructureColumns)
    .from(branchStructureState)
    .innerJoin(siteStructures, eq(siteStructures.id, branchStructureState.structureId))
    .where(
      and(
        eq(branchStructureState.branchId, branchId),
        eq(branchStructureState.structureId, structureId),
      ),
    );

  if (!branchRow) {
    return null;
  }
  return mapBranchStructureRow(branchRow);
}

/**
 * Get a branch structure by slug.
 */
export async function getBranchStructureBySlug(
  branchId: string,
  slug: string,
): Promise<BranchStructure | null> {
  const normalizedSlug = normalizeSlug(slug);
  const [slugRow] = await db()
    .select(branchStructureColumns)
    .from(branchStructureState)
    .innerJoin(siteStructures, eq(siteStructures.id, branchStructureState.structureId))
    .where(
      and(
        eq(branchStructureState.branchId, branchId),
        eq(branchStructureState.slug, normalizedSlug),
      ),
    );

  if (!slugRow) {
    return null;
  }
  return mapBranchStructureRow(slugRow);
}

/**
 * List structures on a branch.
 */
export async function listBranchStructures(
  branchId: string,
  options?: ListBranchStructuresOptions,
): Promise<BranchStructure[]> {
  const conditions = [eq(branchStructureState.branchId, branchId)];

  if (options?.structureType !== undefined) {
    conditions.push(eq(branchStructureState.structureType, options.structureType));
  }

  const rows = await db()
    .select(branchStructureColumns)
    .from(branchStructureState)
    .innerJoin(siteStructures, eq(siteStructures.id, branchStructureState.structureId))
    .where(and(...conditions))
    .orderBy(asc(siteStructures.createdAt));

  return rows.map(mapBranchStructureRow);
}

/**
 * Update a branch structure.
 */
export async function updateBranchStructure(
  branchId: string,
  structureId: string,
  updates: UpdateBranchStructureParams,
): Promise<BranchStructure> {
  const changes: PgUpdateSetSource<typeof branchStructureState> = {};

  if (updates.name !== undefined) {
    changes.name = updates.name;
  }

  if (updates.slug !== undefined) {
    changes.slug = normalizeSlug(updates.slug);
  }

  if (updates.description !== undefined) {
    changes.description = updates.description;
  }

  if (Object.keys(changes).length === 0) {
    const existing = await getBranchStructure(branchId, structureId);
    if (existing === null) {
      throw new StructureNotFoundError(structureId);
    }
    return existing;
  }

  try {
    const updatedRows = await db()
      .update(branchStructureState)
      .set(changes)
      .where(
        and(
          eq(branchStructureState.branchId, branchId),
          eq(branchStructureState.structureId, structureId),
        ),
      )
      .returning({ structureId: branchStructureState.structureId });

    if (updatedRows.length === 0) {
      throw new StructureNotFoundError(structureId);
    }

    // Fetch the full updated structure
    const updated = await getBranchStructure(branchId, structureId);
    if (updated === null) {
      throw new StructureNotFoundError(structureId);
    }
    return updated;
  } catch (error) {
    if (driverErrorCode(error) === '23505') {
      throw new DuplicateStructureSlugError(branchId, updates.slug ?? '');
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
  const deletedRows = await db()
    .delete(branchStructureState)
    .where(
      and(
        eq(branchStructureState.branchId, branchId),
        eq(branchStructureState.structureId, structureId),
      ),
    )
    .returning({ structureId: branchStructureState.structureId });

  if (deletedRows.length === 0) {
    throw new StructureNotFoundError(structureId);
  }

  // Step 2: Check if any other branches reference this structure
  const [countRow] = await db()
    .select({ count: count() })
    .from(branchStructureState)
    .where(eq(branchStructureState.structureId, structureId));

  const remainingRefs = countRow?.count ?? 0;

  // Step 3: If no more references, cascade delete the definition
  if (remainingRefs === 0) {
    await db().delete(siteStructures).where(eq(siteStructures.id, structureId));
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
  // The insert column list is the table's own, in schema order, so the select
  // must project every insertable column in that order.
  await db().insert(branchStructureState).select(
    db()
      .select({
        branchId: sql<string>`${newBranchId}`.as('branch_id'),
        structureId: branchStructureState.structureId,
        structureTree: branchStructureState.structureTree,
        metadataSchema: branchStructureState.metadataSchema,
        schemaEnforcement: branchStructureState.schemaEnforcement,
        hasChangesSinceCheckpoint: sql<boolean>`FALSE`.as('has_changes_since_checkpoint'),
        lastModifiedAt: branchStructureState.lastModifiedAt,
        lastModifiedBy: branchStructureState.lastModifiedBy,
        name: branchStructureState.name,
        slug: branchStructureState.slug,
        description: branchStructureState.description,
        structureType: branchStructureState.structureType,
      })
      .from(branchStructureState)
      .where(eq(branchStructureState.branchId, sourceBranchId)),
  );
}
