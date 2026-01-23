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
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when the referenced site does not exist.
 */
export class SiteNotFoundError extends Error {
  public readonly name = 'SiteNotFoundError';

  constructor(public readonly siteId: string) {
    super(`Site with ID "${siteId}" not found.`);
    Object.setPrototypeOf(this, SiteNotFoundError.prototype);
  }
}

/**
 * Error thrown when the referenced branch does not exist.
 */
export class BranchNotFoundError extends Error {
  public readonly name = 'BranchNotFoundError';

  constructor(public readonly branchId: string) {
    super(`Branch with ID "${branchId}" not found.`);
    Object.setPrototypeOf(this, BranchNotFoundError.prototype);
  }
}

/**
 * Error thrown when attempting to create a branch with a duplicate name in the same site.
 */
export class DuplicateBranchNameError extends Error {
  public readonly name = 'DuplicateBranchNameError';

  constructor(
    public readonly siteId: string,
    public readonly branchName: string,
  ) {
    super(`A branch named "${branchName}" already exists in site "${siteId}".`);
    Object.setPrototypeOf(this, DuplicateBranchNameError.prototype);
  }
}

/**
 * Error thrown when branch creation parameters are invalid.
 */
export class InvalidBranchParamsError extends Error {
  public readonly name = 'InvalidBranchParamsError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InvalidBranchParamsError.prototype);
  }
}

/**
 * Error thrown when attempting to perform a protected operation on the main branch.
 */
export class MainBranchProtectionError extends Error {
  public readonly name = 'MainBranchProtectionError';

  constructor(public readonly operation: string) {
    super(`Cannot ${operation} the main branch.`);
    Object.setPrototypeOf(this, MainBranchProtectionError.prototype);
  }
}

/**
 * Error thrown when attempting an invalid branch status transition.
 */
export class InvalidBranchStatusTransitionError extends Error {
  public readonly name = 'InvalidBranchStatusTransitionError';

  constructor(
    public readonly fromStatus: BranchStatus,
    public readonly toStatus: BranchStatus,
  ) {
    super(`Invalid status transition from "${fromStatus}" to "${toStatus}".`);
    Object.setPrototypeOf(this, InvalidBranchStatusTransitionError.prototype);
  }
}

/**
 * Error thrown when an unexpected database error occurs.
 * Wraps raw database errors to prevent leaking internal details.
 */
export class DatabaseError extends Error {
  public readonly name = 'DatabaseError';

  constructor(message: string, public readonly operation: string) {
    super(message);
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
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

    return mapRowToBranch(getFirstRow(result.rows));
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateBranchNameError(params.siteId, params.name);
    }
    if (isForeignKeyViolation(error)) {
      throw new SiteNotFoundError(params.siteId);
    }
    throw new DatabaseError('Failed to create branch', 'createBranch');
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
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateBranchNameError(params.siteId, 'main');
    }
    if (isForeignKeyViolation(error)) {
      throw new SiteNotFoundError(params.siteId);
    }
    throw new DatabaseError('Failed to create main branch', 'createMainBranch');
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
  const { status, limit, offset } = options;

  let sql = 'SELECT * FROM app.branches WHERE site_id = $1';
  const params: unknown[] = [siteId];
  let paramIndex = 2;

  if (status !== undefined) {
    sql += ` AND status = $${String(paramIndex)}`;
    params.push(status);
    paramIndex++;
  }

  sql += ' ORDER BY created_at DESC';

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

  const result = await query(
    'DELETE FROM app.branches WHERE id = $1',
    [branchId],
  );

  return (result.rowCount ?? 0) > 0;
}
