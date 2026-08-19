/**
 * Phase 3.2: Branch Service
 *
 * CRUD operations for Branches with status management and main branch protection.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Branches"
 */

import type { Branch, BranchStatus } from '../types';
import { query } from '../db';
import {
  SiteNotFoundError,
  DuplicateBranchNameError,
  InvalidBranchParamsError,
  MainBranchProtectionError,
  InvalidBranchStatusTransitionError,
  MainBranchOnlyError,
  DatabaseError,
} from './errors';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new branch.
 */
export interface CreateBranchParams {
  siteId: string;
  name: string;
  description?: string;
  sourceBranchId: string;
  sourceCheckpointId?: string;
  createdById: string;
  createdByType: 'user' | 'agent';
}

/**
 * Parameters for creating the main branch.
 */
export interface CreateMainBranchParams {
  siteId: string;
  createdById: string;
  createdByType: 'user' | 'agent';
}

/**
 * Parameters for updating a branch.
 */
export interface UpdateBranchParams {
  name?: string;
  description?: string;
}

/**
 * Options for listing branches.
 */
export interface ListBranchesOptions {
  status?: BranchStatus;
  limit?: number;
  offset?: number;
  /** Filter by soft-delete state. true = archived only, false/undefined = active only. */
  archived?: boolean;
}

/**
 * Database row format for branches.
 */
interface BranchRow {
  id: string;
  site_id: string;
  name: string;
  description: string | null;
  status: BranchStatus;
  is_main: boolean;
  source_branch_id: string | null;
  source_checkpoint_id: string | null;
  created_by_id: string;
  created_by_type: 'user' | 'agent';
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

// =============================================================================
// Status Transition Rules
// =============================================================================

/**
 * Valid status transitions for branches.
 * - active → review (submit for review)
 * - active → archived (archive without merging)
 * - review → active (back to development)
 * - review → merged (complete merge)
 * - Same status → same status (no-op)
 */
const VALID_TRANSITIONS: Record<BranchStatus, BranchStatus[]> = {
  active: ['active', 'review', 'archived'],
  review: ['review', 'active', 'merged'],
  merged: ['merged'], // Terminal state - no transitions out
  archived: ['archived'], // Terminal state - no transitions out
};

/**
 * Checks if a status transition is valid.
 *
 * @param from - Current status
 * @param to - Target status
 * @returns True if the transition is valid
 */
export function isValidStatusTransition(from: BranchStatus, to: BranchStatus): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets.includes(to);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Maps a database row to a Branch domain object.
 */
function mapRowToBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    isMain: row.is_main,
    sourceBranchId: row.source_branch_id ?? undefined,
    sourceCheckpointId: row.source_checkpoint_id ?? undefined,
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
  };
}

/**
 * Gets the first row from a query result, throwing if not present.
 * Use this when an INSERT/UPDATE with RETURNING should always return a row.
 */
function getFirstRow<T>(rows: T[]): T {
  const first = rows[0];
  if (first === undefined) {
    throw new Error('Expected query to return at least one row');
  }
  return first;
}

/**
 * Checks if an error is a PostgreSQL unique constraint violation.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23505'
  );
}

/**
 * Checks if an error is a PostgreSQL foreign key constraint violation.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23503'
  );
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Creates a new branch from a source branch.
 * Copies structure state and document metadata from the source branch or checkpoint.
 *
 * @param params - Branch creation parameters
 * @returns The created branch
 * @throws InvalidBranchParamsError if required fields are missing or invalid
 * @throws SiteNotFoundError if the site does not exist
 * @throws DuplicateBranchNameError if branch name already exists in site
 */
export async function createBranch(params: CreateBranchParams): Promise<Branch> {
  // Validate required fields
  if (!params.name || params.name.trim() === '') {
    throw new InvalidBranchParamsError('Branch name is required');
  }
  if (!params.sourceBranchId || params.sourceBranchId.trim() === '') {
    throw new InvalidBranchParamsError('Source branch ID is required');
  }
  if (!params.siteId || params.siteId.trim() === '') {
    throw new InvalidBranchParamsError('Site ID is required');
  }
  if (!params.createdById || params.createdById.trim() === '') {
    throw new InvalidBranchParamsError('Created by ID is required');
  }

  try {
    await query('BEGIN');

    // Validate source branch is the main branch (copy-on-write: branches only from main)
    const sourceBranchResult = await query<{ id: string; is_main: boolean }>(
      'SELECT id, is_main FROM app.branches WHERE id = $1',
      [params.sourceBranchId],
    );

    if (sourceBranchResult.rows.length === 0 || sourceBranchResult.rows[0]?.is_main !== true) {
      await query('ROLLBACK');
      throw new MainBranchOnlyError(params.sourceBranchId);
    }

    const result = await query<BranchRow>(
      `INSERT INTO app.branches (
        site_id, name, description, status, is_main,
        source_branch_id, source_checkpoint_id,
        created_by_id, created_by_type
      )
      VALUES ($1, $2, $3, 'active', FALSE, $4, $5, $6, $7)
      RETURNING *`,
      [
        params.siteId,
        params.name.trim(),
        params.description ?? null,
        params.sourceBranchId,
        params.sourceCheckpointId ?? null,
        params.createdById,
        params.createdByType,
      ],
    );

    const branch = mapRowToBranch(getFirstRow(result.rows));

    // Copy-on-write: only copy structure state (navigation tree must be independent per branch)
    // Document versions and metadata are NOT copied — they inherit from main via fallback
    if (params.sourceCheckpointId !== undefined) {
      // Copy structure from checkpoint
      await query(
        `INSERT INTO app.branch_structure_state (
          branch_id, structure_id, name, slug, description, structure_type,
          structure_tree, metadata_schema, schema_enforcement
        )
        SELECT $1, cs.structure_id, cs.name, cs.slug, cs.description, cs.structure_type,
               cs.structure_tree, cs.metadata_schema, cs.schema_enforcement
        FROM app.checkpoint_structures cs
        WHERE cs.checkpoint_id = $2`,
        [branch.id, params.sourceCheckpointId],
      );
    } else {
      // Copy structure from current branch state
      await query(
        `INSERT INTO app.branch_structure_state (
          branch_id, structure_id, name, slug, description, structure_type,
          structure_tree, metadata_schema, schema_enforcement
        )
        SELECT $1, bss.structure_id, bss.name, bss.slug, bss.description, bss.structure_type,
               bss.structure_tree, bss.metadata_schema, bss.schema_enforcement
        FROM app.branch_structure_state bss
        WHERE bss.branch_id = $2`,
        [branch.id, params.sourceBranchId],
      );

      // Auto-resolve source_checkpoint_id from latest checkpoint on source branch
      const latestCheckpoint = await query<{ id: string }>(
        'SELECT id FROM app.checkpoints WHERE branch_id = $1 ORDER BY created_at DESC LIMIT 1',
        [params.sourceBranchId],
      );

      const latestCheckpointRow = latestCheckpoint.rows[0];
      if (latestCheckpointRow) {
        const updatedResult = await query<BranchRow>(
          'UPDATE app.branches SET source_checkpoint_id = $1 WHERE id = $2 RETURNING *',
          [latestCheckpointRow.id, branch.id],
        );
        const updatedRow = updatedResult.rows[0];
        if (updatedRow) {
          await query('COMMIT');
          return mapRowToBranch(updatedRow);
        }
      }
    }

    await query('COMMIT');

    return branch;
  } catch (error) {
    if (error instanceof MainBranchOnlyError) {
      throw error;
    }
    await query('ROLLBACK');
    console.error('createBranch error:', error);
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateBranchNameError(params.siteId, params.name);
    }
    if (isForeignKeyViolation(error)) {
      throw new SiteNotFoundError(params.siteId);
    }
    throw new DatabaseError(`Failed to create branch: ${error instanceof Error ? error.message : String(error)}`, 'createBranch');
  }
}

/**
 * Creates the main branch for a site.
 * Each site should have exactly one main branch.
 *
 * @param params - Main branch creation parameters
 * @returns The created main branch
 * @throws SiteNotFoundError if the site does not exist
 * @throws DuplicateBranchNameError if main branch already exists
 */
export async function createMainBranch(params: CreateMainBranchParams): Promise<Branch> {
  try {
    const result = await query<BranchRow>(
      `INSERT INTO app.branches (
        site_id, name, description, status, is_main,
        source_branch_id, source_checkpoint_id,
        created_by_id, created_by_type
      )
      VALUES ($1, 'main', 'Main branch', 'active', TRUE, NULL, NULL, $2, $3)
      RETURNING *`,
      [params.siteId, params.createdById, params.createdByType],
    );

    return mapRowToBranch(getFirstRow(result.rows));
  } catch (error) {
    console.error('createMainBranch error:', error);
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateBranchNameError(params.siteId, 'main');
    }
    if (isForeignKeyViolation(error)) {
      throw new SiteNotFoundError(params.siteId);
    }
    throw new DatabaseError(`Failed to create main branch: ${error instanceof Error ? error.message : String(error)}`, 'createMainBranch');
  }
}

/**
 * Retrieves a branch by its ID.
 *
 * @param branchId - The branch ID
 * @returns The branch or null if not found
 */
export async function getBranch(branchId: string): Promise<Branch | null> {
  const result = await query<BranchRow>(
    'SELECT * FROM app.branches WHERE id = $1',
    [branchId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToBranch(getFirstRow(result.rows));
}

/**
 * Retrieves a branch by name within a site.
 *
 * @param siteId - The site ID
 * @param name - The branch name
 * @returns The branch or null if not found
 */
export async function getBranchByName(siteId: string, name: string): Promise<Branch | null> {
  const result = await query<BranchRow>(
    'SELECT * FROM app.branches WHERE site_id = $1 AND name = $2',
    [siteId, name],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToBranch(getFirstRow(result.rows));
}

/**
 * Retrieves the main branch for a site.
 *
 * @param siteId - The site ID
 * @returns The main branch or null if not found
 */
export async function getMainBranch(siteId: string): Promise<Branch | null> {
  const result = await query<BranchRow>(
    'SELECT * FROM app.branches WHERE site_id = $1 AND is_main = TRUE',
    [siteId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToBranch(getFirstRow(result.rows));
}

/**
 * Soft-deletes a branch by setting archived_at.
 * Returns false if not found, 'already_archived' if already soft-deleted,
 * and throws MainBranchProtectionError for the main branch.
 */
export async function archiveBranch(branchId: string): Promise<boolean | 'already_archived'> {
  const branch = await getBranch(branchId);
  if (branch === null) {
    return false;
  }
  if (branch.isMain) {
    throw new MainBranchProtectionError('archive');
  }
  await query('BEGIN');
  try {
    const result = await query<{ id: string }>(
      `UPDATE app.branches SET archived_at = NOW()
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id`,
      [branchId],
    );
    await query('COMMIT');
    return (result.rowCount ?? 0) > 0 ? true : 'already_archived';
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

/**
 * Restores a soft-deleted branch. Returns null if not found, not archived,
 * or if the parent site is archived.
 */
export async function restoreBranch(branchId: string): Promise<Branch | null> {
  const selectResult = await query<BranchRow>(
    'SELECT * FROM app.branches WHERE id = $1',
    [branchId],
  );
  const row = selectResult.rows[0];
  if (row?.archived_at == null) {
    return null;
  }
  // Refuse to restore a branch whose site is archived
  const siteResult = await query<{ archived_at: string | null }>(
    'SELECT archived_at FROM app.sites WHERE id = $1',
    [row.site_id],
  );
  if (siteResult.rows[0]?.archived_at != null) {
    return null;
  }
  await query('BEGIN');
  try {
    const updateResult = await query<BranchRow>(
      'UPDATE app.branches SET archived_at = NULL WHERE id = $1 RETURNING *',
      [branchId],
    );
    await query('COMMIT');
    const updatedRow = updateResult.rows[0];
    if (!updatedRow) {
      return null;
    }
    return mapRowToBranch(updatedRow);
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

/**
 * Lists branches for a site with optional filtering.
 *
 * @param siteId - The site ID
 * @param options - Filtering and pagination options
 * @returns Array of branches
 */
export async function listBranches(
  siteId: string,
  options: ListBranchesOptions = {},
): Promise<Branch[]> {
  const { status, limit, offset, archived } = options;

  const archivedFilter = archived === true ? ' AND b.archived_at IS NOT NULL' : ' AND b.archived_at IS NULL';
  let sql = `SELECT b.* FROM app.branches b WHERE b.site_id = $1${archivedFilter}`;
  const params: unknown[] = [siteId];
  let paramIndex = 2;

  if (status !== undefined) {
    sql += ` AND b.status = $${String(paramIndex)}`;
    params.push(status);
    paramIndex++;
  }

  sql += ' ORDER BY b.created_at DESC';

  if (limit !== undefined) {
    sql += ` LIMIT $${String(paramIndex)}`;
    params.push(limit);
    paramIndex++;
  }

  if (offset !== undefined) {
    sql += ` OFFSET $${String(paramIndex)}`;
    params.push(offset);
  }

  const result = await query<BranchRow>(sql, params);

  return result.rows.map(mapRowToBranch);
}

/**
 * Updates a branch's name and/or description.
 *
 * @param branchId - The branch ID
 * @param updates - Fields to update
 * @returns The updated branch or null if not found
 * @throws InvalidBranchParamsError if name is empty
 * @throws DuplicateBranchNameError if new name already exists in site
 */
export async function updateBranch(
  branchId: string,
  updates: UpdateBranchParams,
): Promise<Branch | null> {
  // Validate name if provided
  if (updates.name?.trim() === '') {
    throw new InvalidBranchParamsError('Branch name cannot be empty');
  }

  // Convert empty description to null (clearing description)
  const description = updates.description === '' ? null : updates.description;

  try {
    const result = await query<BranchRow>(
      `UPDATE app.branches
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [updates.name ?? null, description ?? null, branchId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRowToBranch(getFirstRow(result.rows));
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateBranchNameError('unknown', updates.name ?? '');
    }
    throw new DatabaseError('Failed to update branch', 'updateBranch');
  }
}

/**
 * Updates a branch's status with transition validation.
 *
 * @param branchId - The branch ID
 * @param newStatus - The new status
 * @returns The updated branch or null if not found
 * @throws MainBranchProtectionError if trying to archive the main branch
 * @throws InvalidBranchStatusTransitionError if the transition is not valid
 */
export async function updateBranchStatus(
  branchId: string,
  newStatus: BranchStatus,
): Promise<Branch | null> {
  // Get current branch state
  const current = await getBranch(branchId);
  if (!current) {
    return null;
  }

  // Check main branch protection for archiving
  if (current.isMain && newStatus === 'archived') {
    throw new MainBranchProtectionError('archive');
  }

  // Validate status transition
  if (!isValidStatusTransition(current.status, newStatus)) {
    throw new InvalidBranchStatusTransitionError(current.status, newStatus);
  }

  // If no actual change, return current state
  if (current.status === newStatus) {
    return current;
  }

  const result = await query<BranchRow>(
    `UPDATE app.branches
     SET status = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [newStatus, branchId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToBranch(getFirstRow(result.rows));
}

/**
 * Deletes a branch.
 *
 * @param branchId - The branch ID
 * @returns True if deleted, false if not found
 * @throws MainBranchProtectionError if trying to delete the main branch
 */
export async function deleteBranch(branchId: string): Promise<boolean> {
  // Check if branch exists and is not main
  const branch = await getBranch(branchId);
  if (!branch) {
    return false;
  }

  if (branch.isMain) {
    throw new MainBranchProtectionError('delete');
  }

  // Delete related data in order to avoid foreign key constraint violations
  // Note: branch_grants and guest_links have ON DELETE CASCADE, so they are handled automatically

  // 1. Delete merge requests where this branch is source or target
  await query(
    'DELETE FROM app.merge_requests WHERE source_branch_id = $1 OR target_branch_id = $1',
    [branchId],
  );

  // 2. Delete branch document metadata
  await query(
    'DELETE FROM app.branch_document_metadata WHERE branch_id = $1',
    [branchId],
  );

  // 3. Delete branch structure state
  await query(
    'DELETE FROM app.branch_structure_state WHERE branch_id = $1',
    [branchId],
  );

  // 4. Delete checkpoint documents for checkpoints on this branch
  await query(
    `DELETE FROM app.checkpoint_documents
     WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id = $1)`,
    [branchId],
  );

  // 5. Delete checkpoint structures for checkpoints on this branch
  await query(
    `DELETE FROM app.checkpoint_structures
     WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id = $1)`,
    [branchId],
  );

  // 6. Delete checkpoint document metadata for checkpoints on this branch
  await query(
    `DELETE FROM app.checkpoint_document_metadata
     WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id = $1)`,
    [branchId],
  );

  // 7. Delete checkpoints
  await query(
    'DELETE FROM app.checkpoints WHERE branch_id = $1',
    [branchId],
  );

  // 8. Delete document versions
  await query(
    'DELETE FROM app.document_versions WHERE branch_id = $1',
    [branchId],
  );

  // 9. Finally, delete the branch
  const result = await query(
    'DELETE FROM app.branches WHERE id = $1',
    [branchId],
  );

  return (result.rowCount ?? 0) > 0;
}
