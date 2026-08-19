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

import { query } from '../db';
import type {
  CreateStructureParams,
  UpdateBranchStructureParams,
  BranchStructure,
  ListBranchStructuresOptions,
  StructureDefinitionRow,
  BranchStructureRow,
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
 * Create a new site structure (atomic: definition + branch state).
 * Creates both the site_structures definition and branch_structure_state entry.
 */
export async function createStructure(params: CreateStructureParams): Promise<BranchStructure> {
  const { siteId, branchId, name, description, structureType } = params;
  const slug = normalizeSlug(params.slug);

  try {
    // Step 1: Create the structure definition (minimal - just ID and site)
    const defResult = await query<StructureDefinitionRow>(
      `INSERT INTO app.site_structures (site_id)
       VALUES ($1)
       RETURNING *`,
      [siteId],
    );

    const defRow = defResult.rows[0];
    if (!defRow) {
      throw new SiteNotFoundError(siteId);
    }
    const structureId = defRow.id;
    const createdAt = defRow.created_at;

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

    const stateRow = stateResult.rows[0];
    if (!stateRow) {
      throw new SiteNotFoundError(siteId);
    }
    return mapBranchStructureRow(stateRow);
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

  const branchRow = result.rows[0];
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
    [branchId, normalizedSlug],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const slugRow = result.rows[0];
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
    const normalizedSlug = normalizeSlug(updates.slug);
    setClauses.push(`slug = $${String(paramIndex)}`);
    params.push(normalizedSlug);
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

  const countRow = countResult.rows[0];
  const remainingRefs = countRow ? parseInt(countRow.count, 10) : 0;

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
