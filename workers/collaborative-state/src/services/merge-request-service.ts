/**
 * Phase 5.1a: Merge Request Service
 *
 * CRUD operations for Merge Requests with status management.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Merge Operations"
 */

import type { MergeRequest, MergeRequestStatus, ConflictDetails } from '../types';
import { query } from '../db';
import {
  MergeRequestNotFoundError,
  InvalidMergeRequestParamsError,
  InvalidMergeRequestStatusTransitionError,
  SourceBranchNotFoundError,
  TargetBranchNotFoundError,
  CannotDeleteMergedRequestError,
  TargetBranchNotMainError,
} from './errors';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new merge request.
 */
export interface CreateMergeRequestParams {
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  baseCheckpointId?: string;
  title: string;
  description?: string;
  createdById: string;
  createdByType: 'user' | 'agent';
}

/**
 * Parameters for updating a merge request.
 */
export interface UpdateMergeRequestParams {
  title?: string;
  description?: string;
}

/**
 * Options for listing merge requests.
 */
export interface ListMergeRequestsOptions {
  status?: MergeRequestStatus;
  sourceBranchId?: string;
  targetBranchId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Metadata for merge completion.
 */
export interface MergeMetadata {
  mergedById: string;
  mergedByType: 'user' | 'agent';
}

/**
 * Database row format for merge requests.
 */
interface MergeRequestRow {
  id: string;
  site_id: string;
  source_branch_id: string;
  target_branch_id: string;
  base_checkpoint_id: string | null;
  title: string;
  description: string | null;
  status: MergeRequestStatus;
  has_conflicts: boolean;
  conflict_details: string | null;
  created_by_id: string;
  created_by_type: 'user' | 'agent';
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  merged_by_id: string | null;
  merged_by_type: string | null;
}

// =============================================================================
// Status Transitions
// =============================================================================

/**
 * Valid status transitions for merge requests.
 * Key = current status, Value = array of allowed next statuses
 */
const VALID_STATUS_TRANSITIONS: Record<MergeRequestStatus, MergeRequestStatus[]> = {
  open: ['approved', 'closed', 'conflicted'],
  approved: ['merged', 'closed', 'open', 'conflicted'], // can go back to open, or to conflicted if merge detects conflicts
  conflicted: ['open', 'closed', 'merged'], // back to open after conflict resolution, or merged after resolution applied
  merged: [], // terminal state
  closed: ['open'], // can be reopened
};

/**
 * Check if a status transition is valid.
 */
export function isValidStatusTransition(
  fromStatus: MergeRequestStatus,
  toStatus: MergeRequestStatus,
): boolean {
  const allowedTransitions = VALID_STATUS_TRANSITIONS[fromStatus];
  return allowedTransitions.includes(toStatus);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert database row to MergeRequest type.
 */
function rowToMergeRequest(row: MergeRequestRow): MergeRequest {
  let conflictDetails: ConflictDetails | undefined;
  if (row.conflict_details !== null && row.conflict_details !== '') {
    try {
      conflictDetails =
        typeof row.conflict_details === 'string'
          ? (JSON.parse(row.conflict_details) as ConflictDetails)
          : row.conflict_details;
    } catch {
      // Invalid JSON, leave undefined
    }
  }

  return {
    id: row.id,
    siteId: row.site_id,
    sourceBranchId: row.source_branch_id,
    targetBranchId: row.target_branch_id,
    baseCheckpointId: row.base_checkpoint_id ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    hasConflicts: row.has_conflicts,
    conflictDetails,
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mergedAt: row.merged_at ?? undefined,
    mergedById: row.merged_by_id ?? undefined,
    mergedByType: row.merged_by_type ?? undefined,
  };
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Create a new merge request.
 */
export async function createMergeRequest(params: CreateMergeRequestParams): Promise<MergeRequest> {
  // Validate required fields
  if (params.title.trim() === '') {
    throw new InvalidMergeRequestParamsError('Title is required and cannot be empty.');
  }

  if (params.sourceBranchId === params.targetBranchId) {
    throw new InvalidMergeRequestParamsError('Source and target branches must be different.');
  }

  // Validate target branch is the main branch
  const targetBranchResult = await query<{ id: string; is_main: boolean }>(
    'SELECT id, is_main FROM app.branches WHERE id = $1',
    [params.targetBranchId],
  );

  const targetBranch = targetBranchResult.rows[0];
  if (targetBranch?.is_main !== true) {
    throw new TargetBranchNotMainError(params.targetBranchId);
  }

  const sql = `
    INSERT INTO app.merge_requests (
      site_id,
      source_branch_id,
      target_branch_id,
      base_checkpoint_id,
      title,
      description,
      created_by_id,
      created_by_type
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  try {
    const result = await query<MergeRequestRow>(sql, [
      params.siteId,
      params.sourceBranchId,
      params.targetBranchId,
      params.baseCheckpointId ?? null,
      params.title.trim(),
      params.description?.trim() ?? null,
      params.createdById,
      params.createdByType,
    ]);

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create merge request');
    }
    return rowToMergeRequest(row);
  } catch (error) {
    // Handle foreign key violations
    if (error instanceof Error && 'code' in error && error.code === '23503') {
      const constraint = (error as Error & { constraint?: string }).constraint ?? '';
      if (constraint.includes('source_branch')) {
        throw new SourceBranchNotFoundError(params.sourceBranchId);
      }
      if (constraint.includes('target_branch')) {
        throw new TargetBranchNotFoundError(params.targetBranchId);
      }
    }
    throw error;
  }
}

/**
 * Get a merge request by ID.
 */
export async function getMergeRequest(id: string): Promise<MergeRequest | null> {
  const sql = 'SELECT * FROM app.merge_requests WHERE id = $1';
  const result = await query<MergeRequestRow>(sql, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return rowToMergeRequest(row);
}

/**
 * List merge requests for a site with optional filtering.
 */
export async function listMergeRequests(
  siteId: string,
  options: ListMergeRequestsOptions = {},
): Promise<MergeRequest[]> {
  const conditions: string[] = ['site_id = $1'];
  const params: unknown[] = [siteId];
  let paramIndex = 2;

  if (options.status !== undefined) {
    conditions.push('status = $' + String(paramIndex));
    params.push(options.status);
    paramIndex++;
  }

  if (options.sourceBranchId !== undefined && options.sourceBranchId !== '') {
    conditions.push('source_branch_id = $' + String(paramIndex));
    params.push(options.sourceBranchId);
    paramIndex++;
  }

  if (options.targetBranchId !== undefined && options.targetBranchId !== '') {
    conditions.push('target_branch_id = $' + String(paramIndex));
    params.push(options.targetBranchId);
    paramIndex++;
  }

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const limitParam = '$' + String(paramIndex);
  const offsetParam = '$' + String(paramIndex + 1);

  const sql =
    'SELECT * FROM app.merge_requests WHERE ' +
    conditions.join(' AND ') +
    ' ORDER BY created_at DESC LIMIT ' +
    limitParam +
    ' OFFSET ' +
    offsetParam;

  params.push(limit, offset);

  const result = await query<MergeRequestRow>(sql, params);
  return result.rows.map(rowToMergeRequest);
}

/**
 * Update a merge request's title and/or description.
 */
export async function updateMergeRequest(
  id: string,
  params: UpdateMergeRequestParams,
): Promise<MergeRequest> {
  // Validate title if provided
  if (params.title?.trim() === '') {
    throw new InvalidMergeRequestParamsError('Title cannot be empty.');
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.title !== undefined) {
    updates.push('title = $' + String(paramIndex));
    values.push(params.title.trim());
    paramIndex++;
  }

  if (params.description !== undefined) {
    updates.push('description = $' + String(paramIndex));
    values.push(params.description.trim());
    paramIndex++;
  }

  if (updates.length === 0) {
    // Nothing to update, just fetch and return
    const existing = await getMergeRequest(id);
    if (existing === null) {
      throw new MergeRequestNotFoundError(id);
    }
    return existing;
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql =
    'UPDATE app.merge_requests SET ' +
    updates.join(', ') +
    ' WHERE id = $' +
    String(paramIndex) +
    ' RETURNING *';

  const result = await query<MergeRequestRow>(sql, values);

  if (result.rows.length === 0) {
    throw new MergeRequestNotFoundError(id);
  }

  const updatedRow = result.rows[0];
  if (!updatedRow) {
    throw new MergeRequestNotFoundError(id);
  }
  return rowToMergeRequest(updatedRow);
}

/**
 * Update a merge request's status with transition validation.
 */
export async function updateMergeRequestStatus(
  id: string,
  newStatus: MergeRequestStatus,
  mergeMetadata?: MergeMetadata,
): Promise<MergeRequest> {
  // Get current status
  const currentResult = await query<{ status: MergeRequestStatus }>(
    'SELECT status FROM app.merge_requests WHERE id = $1',
    [id],
  );

  if (currentResult.rows.length === 0) {
    throw new MergeRequestNotFoundError(id);
  }

  const currentRow = currentResult.rows[0];
  if (!currentRow) {
    throw new MergeRequestNotFoundError(id);
  }
  const currentStatus = currentRow.status;

  // Validate transition
  if (!isValidStatusTransition(currentStatus, newStatus)) {
    throw new InvalidMergeRequestStatusTransitionError(currentStatus, newStatus);
  }

  // Build update query
  const updates = ['status = $1', 'updated_at = NOW()'];
  const values: unknown[] = [newStatus];
  let paramIndex = 2;

  // Add merge metadata if transitioning to merged
  if (newStatus === 'merged' && mergeMetadata !== undefined) {
    updates.push('merged_at = NOW()');
    updates.push('merged_by_id = $' + String(paramIndex));
    values.push(mergeMetadata.mergedById);
    paramIndex++;
    updates.push('merged_by_type = $' + String(paramIndex));
    values.push(mergeMetadata.mergedByType);
    paramIndex++;
  }

  values.push(id);

  const sql =
    'UPDATE app.merge_requests SET ' +
    updates.join(', ') +
    ' WHERE id = $' +
    String(paramIndex) +
    ' RETURNING *';

  const result = await query<MergeRequestRow>(sql, values);
  const statusRow = result.rows[0];
  if (!statusRow) {
    throw new MergeRequestNotFoundError(id);
  }
  return rowToMergeRequest(statusRow);
}

/**
 * Update a merge request's conflict details.
 */
export async function updateMergeRequestConflicts(
  id: string,
  conflictDetails: ConflictDetails,
): Promise<MergeRequest> {
  const hasConflicts =
    conflictDetails.documentConflicts.length > 0 ||
    conflictDetails.structureConflicts.length > 0;

  const sql = `
    UPDATE app.merge_requests
    SET
      has_conflicts = $1,
      conflict_details = $2,
      updated_at = NOW()
    WHERE id = $3
    RETURNING *
  `;

  const result = await query<MergeRequestRow>(sql, [
    hasConflicts,
    hasConflicts ? JSON.stringify(conflictDetails) : null,
    id,
  ]);

  if (result.rows.length === 0) {
    throw new MergeRequestNotFoundError(id);
  }

  const conflictRow = result.rows[0];
  if (!conflictRow) {
    throw new MergeRequestNotFoundError(id);
  }
  return rowToMergeRequest(conflictRow);
}

/**
 * Delete a merge request.
 */
export async function deleteMergeRequest(id: string): Promise<void> {
  // Check if merge request exists and isn't merged
  const checkResult = await query<MergeRequestRow>(
    'SELECT * FROM app.merge_requests WHERE id = $1',
    [id],
  );

  if (checkResult.rows.length === 0) {
    throw new MergeRequestNotFoundError(id);
  }

  const checkRow = checkResult.rows[0];
  if (!checkRow) {
    throw new MergeRequestNotFoundError(id);
  }
  if (checkRow.status === 'merged') {
    throw new CannotDeleteMergedRequestError(id);
  }

  // Delete the merge request
  await query('DELETE FROM app.merge_requests WHERE id = $1', [id]);
}
