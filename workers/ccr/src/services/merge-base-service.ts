/**
 * Phase 5.1b: Merge Base Service
 *
 * Finds the common ancestor checkpoint between branches for merge operations.
 * Uses recursive CTEs to traverse branch/checkpoint ancestry.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Merge Operations"
 */

import { asc, eq, sql } from 'drizzle-orm';
import { branches, checkpointDocuments, checkpoints, documentVersions, documents } from '../db/schema';
import { db } from '../db/scope';
import { SourceBranchNotFoundError, TargetBranchNotFoundError } from './errors';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a merge base - the common ancestor checkpoint between two branches.
 */
export interface MergeBase {
  checkpointId: string;
  branchId: string;
  createdAt: Date | null;
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
// Raw Projection Row Types
// =============================================================================

/** Shapes the CTE queries below project, which no table declares. */
type ModifiedDocumentRow = {
  document_id: string;
  document_path: string;
  latest_version_id: string | null;
  latest_version_number: number | null;
  base_version_id: string | null;
  base_version_number: number | null;
  is_deleted?: boolean;
};

type BranchLineageRow = {
  id: string;
  source_branch_id: string | null;
  source_checkpoint_id: string | null;
  depth: number;
};

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

  const branchColumns = {
    id: branches.id,
    sourceBranchId: branches.sourceBranchId,
    sourceCheckpointId: branches.sourceCheckpointId,
  };

  // Verify source branch exists and get its source_checkpoint_id
  const [sourceBranch] = await db()
    .select(branchColumns)
    .from(branches)
    .where(eq(branches.id, sourceBranchId));

  if (sourceBranch === undefined) {
    throw new SourceBranchNotFoundError(sourceBranchId);
  }

  // Verify target branch exists
  const [targetBranch] = await db()
    .select(branchColumns)
    .from(branches)
    .where(eq(branches.id, targetBranchId));

  if (targetBranch === undefined) {
    throw new TargetBranchNotFoundError(targetBranchId);
  }

  // With main-only branching, the merge base is simply the source_checkpoint_id
  // from the source branch (the checkpoint on main when the branch was created)
  const sourceCheckpointId = sourceBranch.sourceCheckpointId;

  if (sourceCheckpointId === null) {
    return null;
  }

  // Look up checkpoint metadata
  const [row] = await db()
    .select({
      createdAt: checkpoints.createdAt,
      name: checkpoints.name,
      message: checkpoints.message,
    })
    .from(checkpoints)
    .where(eq(checkpoints.id, sourceCheckpointId));

  if (row === undefined) {
    return null;
  }

  return {
    checkpointId: sourceCheckpointId,
    branchId: targetBranchId,
    createdAt: row.createdAt,
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
export interface GetModifiedDocumentsOptions {
  publishedOnly?: boolean;
}

export async function getModifiedDocumentsSince(
  branchId: string,
  checkpointId: string,
  options?: GetModifiedDocumentsOptions,
): Promise<ModifiedDocument[]> {
  // When the caller asks for the published view (target side of merge conflict
  // detection), the CTEs must be scoped to publish-type checkpoints only.
  // Without this filter, prior post_merge / auto / pre_merge / agent_pre_edit
  // references would be treated as "the published version" — causing phantom
  // target changes for every doc previously touched by any prior merge, which
  // cascades into false-positive conflicts. Production observation: a single-
  // doc translation merge into main produced 32 phantom conflicts because
  // every prior post_merge had captured 32 docs.
  const publishTypeFilter = options?.publishedOnly === true
    ? sql`AND cp.checkpoint_type = 'publish'`
    : sql``;

  const currentVersionsCte = options?.publishedOnly === true
    ? sql`
    current_versions AS (
      -- Tombstone overlay: a delete written directly to document_versions
      -- without a publish checkpoint capturing it must still be authoritative
      -- for "doc no longer exists on target" — otherwise the last published
      -- version (with content) leaks back into merge preview as a phantom
      -- both-modified conflict instead of disappearing from the target view.
      -- Mirrors the tombstone exclusion in listDocumentsOnBranch
      -- (branch-document-service.ts:161-171). Source-side semantics
      -- intentionally differ — tombstones must surface there as isDeleted
      -- so the merge can propagate deletes to target.
      SELECT DISTINCT ON (cd.document_id)
        cd.document_id,
        dv.id AS version_id,
        dv.version_number,
        dv.source,
        dv.snapshot,
        dv.is_tombstone
      FROM app.checkpoint_documents cd
      INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
      INNER JOIN app.document_versions dv ON dv.id = cd.document_version_id
      WHERE cp.branch_id = ${branchId} ${publishTypeFilter}
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv_t
          WHERE dv_t.document_id = cd.document_id
            AND dv_t.branch_id = ${branchId}
            AND dv_t.is_tombstone = true
            AND dv_t.version_number > dv.version_number
        )
      ORDER BY cd.document_id, cp.created_at DESC
    )`
    : sql`
    current_versions AS (
      SELECT DISTINCT ON (dv.document_id)
        dv.document_id, dv.id AS version_id, dv.version_number, dv.source, dv.snapshot, dv.is_tombstone
      FROM app.document_versions dv
      WHERE dv.branch_id = ${branchId}
        AND dv.superseded_at IS NULL
      ORDER BY dv.document_id, dv.version_number DESC
    )`;

  const statement = sql`
    WITH
    -- Documents and versions at the merge base checkpoint time.
    -- Resolves the full published state by looking at ALL checkpoints
    -- on the branch at or before the merge base time, not just the
    -- single checkpoint (which may be empty/incremental). (issue #34)
    -- When publishedOnly is true (target side), restrict to publish-type
    -- checkpoints only, mirroring the current_versions CTE above — see the
    -- comment at the top of this function for context.
    checkpoint_docs AS (
      SELECT DISTINCT ON (cd.document_id)
        cd.document_id, cd.document_version_id, dv.version_number
      FROM app.checkpoint_documents cd
      INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
      INNER JOIN app.document_versions dv ON dv.id = cd.document_version_id
      WHERE cp.branch_id = (SELECT branch_id FROM app.checkpoints WHERE id = ${checkpointId})
        AND cp.created_at <= (SELECT created_at FROM app.checkpoints WHERE id = ${checkpointId})
        ${publishTypeFilter}
      ORDER BY cd.document_id, cp.created_at DESC
    ),
    -- Current latest versions on the branch
    ${currentVersionsCte}
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
        -- Modified: version IDs differ. Compare UUIDs, not version_number —
        -- version_number is per-(branch, document) and can collide across
        -- branches (e.g., feature branch's v2 vs main's v2 are entirely
        -- different content). Only version_id (UUID) is globally unique
        -- and safe to compare across the merge-base boundary.
        (cv.version_id IS DISTINCT FROM cd.document_version_id)
        -- Or new document (not in checkpoint)
        OR (cd.document_id IS NULL)
      )
      -- Exclude unmodified branch copies (created when branch was forked)
      AND NOT (cv.source = 'branch' AND cd.document_id IS NOT NULL AND d.archived_at IS NULL)
      -- Exclude documents created after the checkpoint and then archived (net-zero change)
      AND NOT (cd.document_id IS NULL AND d.archived_at IS NOT NULL)
  `;

  const rows = await db().execute<ModifiedDocumentRow>(statement);

  return rows.map((row) => ({
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
  const rows = await db()
    .select({
      documentId: checkpointDocuments.documentId,
      documentPath: documents.path,
      versionId: checkpointDocuments.documentVersionId,
      versionNumber: documentVersions.versionNumber,
      snapshot: documentVersions.snapshot,
    })
    .from(checkpointDocuments)
    .innerJoin(documents, eq(documents.id, checkpointDocuments.documentId))
    .innerJoin(documentVersions, eq(documentVersions.id, checkpointDocuments.documentVersionId))
    .where(eq(checkpointDocuments.checkpointId, checkpointId))
    .orderBy(asc(documents.path));

  return rows.map((row) => ({
    documentId: row.documentId,
    documentPath: row.documentPath,
    versionId: row.versionId,
    versionNumber: row.versionNumber,
    // snapshot is jsonb, so the driver hands back the decoded value.
    snapshot: (row.snapshot ?? {}) as Record<string, unknown>,
  }));
}

// =============================================================================
// Branch Lineage
// =============================================================================

/**
 * Get the full lineage of a branch from itself to the root (main branch).
 * Uses recursive CTE for efficient traversal.
 */
export async function getBranchLineage(
  branchId: string,
): Promise<BranchInLineage[]> {
  const rows = await db().execute<BranchLineageRow>(sql`
    WITH RECURSIVE lineage AS (
      SELECT
        id,
        source_branch_id,
        source_checkpoint_id,
        0 AS depth
      FROM app.branches
      WHERE id = ${branchId}

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
  `);

  return rows.map((row) => ({
    id: row.id,
    sourceBranchId: row.source_branch_id,
    sourceCheckpointId: row.source_checkpoint_id,
    depth: row.depth,
  }));
}
