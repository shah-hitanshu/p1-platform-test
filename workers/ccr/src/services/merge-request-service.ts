/**
 * Phase 5.1a: Merge Request Service
 *
 * CRUD operations for Merge Requests with status management.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Merge Operations"
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { MergeRequest, MergeRequestStatus, ConflictDetails } from '../types';
import { driverErrorCode } from '../db/driver-error';
import { branches, mergeRequests } from '../db/schema';
import { db } from '../db/scope';
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

// =============================================================================
// Status Transitions
// =============================================================================

/**
 * Valid status transitions for merge requests.
 * Key = current status, Value = array of allowed next statuses
 */
const VALID_STATUS_TRANSITIONS: Record<MergeRequestStatus, MergeRequestStatus[]> = {
  open: ['approved', 'closed', 'conflicted'],
  // Direct approved/conflicted -> merged stays valid while the inline merge
  // path exists; the job runner goes through 'merging' instead [PCC-3737].
  approved: ['merging', 'merged', 'closed', 'open', 'conflicted'], // can go back to open, or to conflicted if merge detects conflicts
  conflicted: ['merging', 'open', 'closed', 'merged'], // back to open after conflict resolution, or merged after resolution applied
  // 'merging' is owned by merge execution: forward to merged, back to the
  // job's prior_mr_status (approved/conflicted) on failure or cancellation,
  // or to conflicted when planning finds unresolved conflicts.
  merging: ['merged', 'approved', 'conflicted'],
  merged: [], // terminal state
  closed: ['open'], // can be reopened
};

// =============================================================================
// Execution claim primitives [PCC-3737]
//
// 'merging' is owned by merge execution, and every edge into/out of it is
// written HERE, next to the transition map, so the map has one governed
// writer. Each statement uses a plain qual on the target table: the
// UPDATE ... FROM (self-select) shape is NOT concurrency-safe under READ
// COMMITTED — EvalPlanQual re-evaluates a blocked loser's qual against the
// stale subquery row, letting BOTH racers claim (reproduced on PG 16). A
// plain qual re-evaluates against the winner's committed row, so the loser
// gets 0 rows.
// =============================================================================

/**
 * Claims a merge request for execution: CAS its status to 'merging'.
 * Returns the prior status on success, null when the race was lost or the MR
 * is not executable. Two single-status UPDATEs instead of one IN(...) so the
 * winning statement itself tells us the prior status atomically.
 */
export async function claimMergeRequestForExecution(
  mergeRequestId: string,
): Promise<'approved' | 'conflicted' | null> {
  for (const prior of ['approved', 'conflicted'] as const) {
    // Edge governed by VALID_STATUS_TRANSITIONS: approved/conflicted -> merging.
    const [row] = await db()
      .update(mergeRequests)
      .set({ status: 'merging', updatedAt: sql`NOW()` })
      .where(and(eq(mergeRequests.id, mergeRequestId), eq(mergeRequests.status, prior)))
      .returning({ id: mergeRequests.id });
    if (row !== undefined) {
      return prior;
    }
  }
  return null;
}

/**
 * Releases an execution claim: 'merging' back to the prior status. No-op if
 * the MR moved on (e.g. the job finalized it to 'merged').
 */
export async function restoreMergeRequestClaim(
  mergeRequestId: string,
  priorStatus: string,
): Promise<void> {
  if (!isValidStatusTransition('merging', priorStatus as MergeRequestStatus)) {
    throw new InvalidMergeRequestStatusTransitionError('merging', priorStatus as MergeRequestStatus);
  }
  await db()
    .update(mergeRequests)
    .set({ status: priorStatus, updatedAt: sql`NOW()` })
    .where(and(eq(mergeRequests.id, mergeRequestId), eq(mergeRequests.status, 'merging')));
}

/**
 * Plan-time exit: unresolved conflicts move the executing MR to 'conflicted'
 * so the UI can offer resolution. No-op if the MR is no longer 'merging'.
 */
export async function markMergeRequestConflictedFromMerging(
  mergeRequestId: string,
): Promise<void> {
  await db()
    .update(mergeRequests)
    .set({ status: 'conflicted', updatedAt: sql`NOW()` })
    .where(and(eq(mergeRequests.id, mergeRequestId), eq(mergeRequests.status, 'merging')));
}

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
 * The constraint a rejected statement violated, as the driver names it.
 */
function constraintName(error: unknown): string {
  for (let candidate: unknown = error; candidate instanceof Error; candidate = candidate.cause) {
    if ('constraint' in candidate && typeof candidate.constraint === 'string') {
      return candidate.constraint;
    }
  }
  return '';
}

/**
 * Convert database row to MergeRequest type.
 */
function rowToMergeRequest(row: typeof mergeRequests.$inferSelect): MergeRequest {
  // conflict_details is jsonb, so the driver hands back the decoded value.
  const conflictDetails =
    row.conflictDetails === null ? undefined : (row.conflictDetails as ConflictDetails);

  return {
    id: row.id,
    siteId: row.siteId,
    sourceBranchId: row.sourceBranchId,
    targetBranchId: row.targetBranchId,
    baseCheckpointId: row.baseCheckpointId ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as MergeRequestStatus,
    hasConflicts: row.hasConflicts ?? false,
    conflictDetails,
    createdById: row.createdById,
    createdByType: row.createdByType as 'user' | 'agent',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    mergedAt: row.mergedAt ?? undefined,
    mergedById: row.mergedById ?? undefined,
    mergedByType: row.mergedByType ?? undefined,
  };
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Create a new merge request.
 */
export async function createMergeRequest(
  params: CreateMergeRequestParams,
): Promise<MergeRequest> {
  // Validate required fields
  if (params.title.trim() === '') {
    throw new InvalidMergeRequestParamsError('Title is required and cannot be empty.');
  }

  if (params.sourceBranchId === params.targetBranchId) {
    throw new InvalidMergeRequestParamsError('Source and target branches must be different.');
  }

  // Validate target branch is the main branch
  const [targetBranch] = await db()
    .select({ id: branches.id, isMain: branches.isMain })
    .from(branches)
    .where(eq(branches.id, params.targetBranchId));

  if (targetBranch?.isMain !== true) {
    throw new TargetBranchNotMainError(params.targetBranchId);
  }

  try {
    const [row] = await db()
      .insert(mergeRequests)
      .values({
        siteId: params.siteId,
        sourceBranchId: params.sourceBranchId,
        targetBranchId: params.targetBranchId,
        baseCheckpointId: params.baseCheckpointId ?? null,
        title: params.title.trim(),
        description: params.description?.trim() ?? null,
        createdById: params.createdById,
        createdByType: params.createdByType,
      })
      .returning();

    if (!row) {
      throw new Error('Failed to create merge request');
    }
    return rowToMergeRequest(row);
  } catch (error) {
    // Handle foreign key violations
    if (driverErrorCode(error) === '23503') {
      const constraint = constraintName(error);
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
  const [row] = await db().select().from(mergeRequests).where(eq(mergeRequests.id, id));

  if (row === undefined) {
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
  const conditions = [eq(mergeRequests.siteId, siteId)];

  if (options.status !== undefined) {
    conditions.push(eq(mergeRequests.status, options.status));
  }

  if (options.sourceBranchId !== undefined && options.sourceBranchId !== '') {
    conditions.push(eq(mergeRequests.sourceBranchId, options.sourceBranchId));
  }

  if (options.targetBranchId !== undefined && options.targetBranchId !== '') {
    conditions.push(eq(mergeRequests.targetBranchId, options.targetBranchId));
  }

  const rows = await db()
    .select()
    .from(mergeRequests)
    .where(and(...conditions))
    .orderBy(desc(mergeRequests.createdAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  return rows.map(rowToMergeRequest);
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

  const updates: PgUpdateSetSource<typeof mergeRequests> = {};

  if (params.title !== undefined) {
    updates.title = params.title.trim();
  }

  if (params.description !== undefined) {
    updates.description = params.description.trim();
  }

  if (Object.keys(updates).length === 0) {
    // Nothing to update, just fetch and return
    const existing = await getMergeRequest(id);
    if (existing === null) {
      throw new MergeRequestNotFoundError(id);
    }
    return existing;
  }

  const [updatedRow] = await db()
    .update(mergeRequests)
    .set({ ...updates, updatedAt: sql`NOW()` })
    .where(eq(mergeRequests.id, id))
    .returning();

  if (updatedRow === undefined) {
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
  const [currentRow] = await db()
    .select({ status: mergeRequests.status })
    .from(mergeRequests)
    .where(eq(mergeRequests.id, id));

  if (currentRow === undefined) {
    throw new MergeRequestNotFoundError(id);
  }
  const currentStatus = currentRow.status as MergeRequestStatus;

  // Validate transition
  if (!isValidStatusTransition(currentStatus, newStatus)) {
    throw new InvalidMergeRequestStatusTransitionError(currentStatus, newStatus);
  }

  const updates: PgUpdateSetSource<typeof mergeRequests> = {};

  // Add merge metadata if transitioning to merged
  if (newStatus === 'merged' && mergeMetadata !== undefined) {
    updates.mergedAt = sql`NOW()`;
    updates.mergedById = mergeMetadata.mergedById;
    updates.mergedByType = mergeMetadata.mergedByType;
  }

  // Qualified on the status this function just validated, so the write is a
  // real CAS: a concurrent transition between the read above and this UPDATE
  // quals out (0 rows) instead of blindly overwriting — e.g. a PATCH racing
  // a merge job's claim can no longer slip an MR out of 'merging' [PCC-3737].
  const [statusRow] = await db()
    .update(mergeRequests)
    .set({ status: newStatus, updatedAt: sql`NOW()`, ...updates })
    .where(and(eq(mergeRequests.id, id), eq(mergeRequests.status, currentStatus)))
    .returning();

  if (statusRow === undefined) {
    // Row exists (read above) but the status moved underneath us: report the
    // transition as invalid from the caller's observed state.
    throw new InvalidMergeRequestStatusTransitionError(currentStatus, newStatus);
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

  const [conflictRow] = await db()
    .update(mergeRequests)
    .set({
      hasConflicts,
      conflictDetails: hasConflicts ? conflictDetails : null,
      updatedAt: sql`NOW()`,
    })
    .where(eq(mergeRequests.id, id))
    .returning();

  if (conflictRow === undefined) {
    throw new MergeRequestNotFoundError(id);
  }
  return rowToMergeRequest(conflictRow);
}

/**
 * Delete a merge request.
 */
export async function deleteMergeRequest(id: string): Promise<void> {
  // Check if merge request exists and isn't merged
  const [checkRow] = await db().select().from(mergeRequests).where(eq(mergeRequests.id, id));

  if (checkRow === undefined) {
    throw new MergeRequestNotFoundError(id);
  }
  if (checkRow.status === 'merged') {
    throw new CannotDeleteMergedRequestError(id);
  }

  // Delete the merge request
  await db().delete(mergeRequests).where(eq(mergeRequests.id, id));
}
