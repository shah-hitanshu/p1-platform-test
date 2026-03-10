/**
 * Phase 5.1b: Merge Base Service
 *
 * Finds the common ancestor checkpoint between branches for merge operations.
 * Uses recursive CTEs to traverse branch/checkpoint ancestry.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Merge Operations"
 */

import { query } from '../db';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a merge base - the common ancestor checkpoint between two branches.
 */
export interface MergeBase {
  checkpointId: string;
  branchId: string;
  createdAt: string;
  name?: string;
  message?: string;
}

/**
 * Information about a document modified since a checkpoint.
 */
export interface ModifiedDocument {
  documentId: string;
  documentPath: string;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  baseVersionId: string | null;
  baseVersionNumber: number | null;
  isDeleted?: boolean;
}

/**
 * Document version at a specific checkpoint.
 */
export interface CheckpointDocument {
  documentId: string;
  documentPath: string;
  versionId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
}

/**
 * Branch in a lineage chain.
 */
export interface BranchInLineage {
  id: string;
  sourceBranchId: string | null;
  sourceCheckpointId?: string | null;
  depth: number;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when the source branch does not exist.
 */
export class SourceBranchNotFoundError extends Error {
  public readonly name = 'SourceBranchNotFoundError';

  constructor(public readonly branchId: string) {
    super(`Source branch with ID "${branchId}" not found.`);
    Object.setPrototypeOf(this, SourceBranchNotFoundError.prototype);
  }
}

/**
 * Error thrown when the target branch does not exist.
 */
export class TargetBranchNotFoundError extends Error {
  public readonly name = 'TargetBranchNotFoundError';

  constructor(public readonly branchId: string) {
    super(`Target branch with ID "${branchId}" not found.`);
    Object.setPrototypeOf(this, TargetBranchNotFoundError.prototype);
  }
}

// =============================================================================
// Database Row Types
// =============================================================================

interface MergeBaseRow {
  merge_base_checkpoint_id: string | null;
  merge_base_branch_id: string | null;
  created_at: string;
  name: string | null;
  message: string | null;
}

interface BranchRow {
  id: string;
  source_branch_id: string | null;
  source_checkpoint_id: string | null;
}

interface ModifiedDocumentRow {
  document_id: string;
  document_path: string;
  latest_version_id: string | null;
  latest_version_number: number | null;
  base_version_id: string | null;
  base_version_number: number | null;
  is_deleted?: boolean;
  source?: string;
  snapshot?: Record<string, unknown> | null;
}

interface CheckpointDocumentRow {
  document_id: string;
  document_path: string;
  version_id: string;
  version_number: number;
  snapshot: Record<string, unknown> | string;
}

interface BranchLineageRow {
  id: string;
  source_branch_id: string | null;
  source_checkpoint_id: string | null;
  depth: number;
}

// =============================================================================
// Merge Base Calculation
// =============================================================================

/**
 * Find the merge base (common ancestor checkpoint) between two branches.
 *
 * Algorithm:
 * 1. If source and target are the same, return null
 * 2. Get the lineage of both branches (all ancestors)
 * 3. Find the first common branch in both lineages
 * 4. Return the checkpoint at which the source diverged, or the most recent
 *    checkpoint on the common ancestor branch before the divergence
 */
export async function findMergeBase(
  sourceBranchId: string,
  targetBranchId: string,
): Promise<MergeBase | null> {
  // Same branch - no merge base needed
  if (sourceBranchId === targetBranchId) {
    return null;
  }

  // Verify source branch exists and get its source_checkpoint_id
  const sourceBranchResult = await query<BranchRow>(
    'SELECT id, source_branch_id, source_checkpoint_id FROM app.branches WHERE id = $1',
    [sourceBranchId],
  );

  if (sourceBranchResult.rows.length === 0) {
    throw new SourceBranchNotFoundError(sourceBranchId);
  }

  // Verify target branch exists
  const targetBranchResult = await query<BranchRow>(
    'SELECT id, source_branch_id, source_checkpoint_id FROM app.branches WHERE id = $1',
    [targetBranchId],
  );

  if (targetBranchResult.rows.length === 0) {
    throw new TargetBranchNotFoundError(targetBranchId);
  }

  // With main-only branching, the merge base is simply the source_checkpoint_id
  // from the source branch (the checkpoint on main when the branch was created)
  const sourceCheckpointId = sourceBranchResult.rows[0].source_checkpoint_id;

  if (sourceCheckpointId === null) {
    return null;
  }

  // Look up checkpoint metadata
  const checkpointResult = await query<MergeBaseRow>(
    `SELECT
      $1::uuid AS merge_base_checkpoint_id,
      $2::uuid AS merge_base_branch_id,
      c.created_at,
      c.name,
      c.message
    FROM app.checkpoints c
    WHERE c.id = $1`,
    [sourceCheckpointId, targetBranchId],
  );

  if (checkpointResult.rows.length === 0) {
    return null;
  }

  const row = checkpointResult.rows[0];

  return {
    checkpointId: row.merge_base_checkpoint_id ?? '',
    branchId: row.merge_base_branch_id ?? '',
    createdAt: row.created_at,
    name: row.name ?? undefined,
    message: row.message ?? undefined,
  };
}

// =============================================================================
// Document Comparison
// =============================================================================

/**
 * Get all documents modified on a branch since a specific checkpoint.
 *
 * This compares the current document versions on the branch with the
 * document versions that were part of the checkpoint.
 */
export async function getModifiedDocumentsSince(
  branchId: string,
  checkpointId: string,
): Promise<ModifiedDocument[]> {
  const sql = `
    WITH
    -- Documents and versions at the checkpoint
    checkpoint_docs AS (
      SELECT cd.document_id, cd.document_version_id, dv.version_number
      FROM app.checkpoint_documents cd
      INNER JOIN app.document_versions dv ON dv.id = cd.document_version_id
      WHERE cd.checkpoint_id = $2
    ),
    -- Current latest versions on the branch
    current_versions AS (
      SELECT DISTINCT ON (dv.document_id)
        dv.document_id, dv.id AS version_id, dv.version_number, dv.source, dv.snapshot, dv.is_tombstone
      FROM app.document_versions dv
      WHERE dv.branch_id = $1
      ORDER BY dv.document_id, dv.version_number DESC
    )
    -- Find documents that differ
    SELECT
      cv.document_id,
      d.path AS document_path,
      cv.version_id AS latest_version_id,
      cv.version_number AS latest_version_number,
      cd.document_version_id AS base_version_id,
      cd.version_number AS base_version_number,
      cv.source,
      cv.is_tombstone AS is_deleted
    FROM current_versions cv
    LEFT JOIN checkpoint_docs cd ON cv.document_id = cd.document_id
    INNER JOIN app.documents d ON d.id = cv.document_id
    WHERE
      (
        -- Modified: version numbers differ
        (cv.version_number IS DISTINCT FROM cd.version_number)
        -- Or new document (not in checkpoint)
        OR (cd.document_id IS NULL)
      )
      -- Exclude unmodified branch copies (created when branch was forked)
      AND NOT (cv.source = 'branch' AND cd.document_id IS NOT NULL AND d.archived_at IS NULL)
      -- Exclude documents created after the checkpoint and then archived (net-zero change)
      AND NOT (cd.document_id IS NULL AND d.archived_at IS NOT NULL)
  `;

  const result = await query<ModifiedDocumentRow>(sql, [branchId, checkpointId]);

  return result.rows.map((row) => ({
    documentId: row.document_id,
    documentPath: row.document_path,
    latestVersionId: row.latest_version_id,
    latestVersionNumber: row.latest_version_number,
    baseVersionId: row.base_version_id,
    baseVersionNumber: row.base_version_number,
    isDeleted: row.is_deleted === true,
  }));
}

/**
 * Get all document versions at a specific checkpoint.
 */
export async function getDocumentsAtCheckpoint(
  checkpointId: string,
): Promise<CheckpointDocument[]> {
  const sql = `
    SELECT
      cd.document_id,
      d.path AS document_path,
      cd.document_version_id AS version_id,
      dv.version_number,
      dv.snapshot
    FROM app.checkpoint_documents cd
    INNER JOIN app.documents d ON d.id = cd.document_id
    INNER JOIN app.document_versions dv ON dv.id = cd.document_version_id
    WHERE cd.checkpoint_id = $1
    ORDER BY d.path
  `;

  const result = await query<CheckpointDocumentRow>(sql, [checkpointId]);

  return result.rows.map((row) => ({
    documentId: row.document_id,
    documentPath: row.document_path,
    versionId: row.version_id,
    versionNumber: row.version_number,
    snapshot:
      typeof row.snapshot === 'string'
        ? (JSON.parse(row.snapshot) as Record<string, unknown>)
        : row.snapshot,
  }));
}

// =============================================================================
// Branch Lineage
// =============================================================================

/**
 * Get the full lineage of a branch from itself to the root (main branch).
 * Uses recursive CTE for efficient traversal.
 */
export async function getBranchLineage(branchId: string): Promise<BranchInLineage[]> {
  const sql = `
    WITH RECURSIVE lineage AS (
      SELECT
        id,
        source_branch_id,
        source_checkpoint_id,
        0 AS depth
      FROM app.branches
      WHERE id = $1

      UNION ALL

      SELECT
        b.id,
        b.source_branch_id,
        b.source_checkpoint_id,
        l.depth + 1
      FROM app.branches b
      INNER JOIN lineage l ON b.id = l.source_branch_id
    )
    SELECT id, source_branch_id, source_checkpoint_id, depth
    FROM lineage
    ORDER BY depth ASC
  `;

  const result = await query<BranchLineageRow>(sql, [branchId]);

  return result.rows.map((row) => ({
    id: row.id,
    sourceBranchId: row.source_branch_id,
    sourceCheckpointId: row.source_checkpoint_id,
    depth: row.depth,
  }));
}
