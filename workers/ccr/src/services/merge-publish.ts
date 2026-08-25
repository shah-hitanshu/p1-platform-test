/**
 * Merge Publish Helper
 *
 * After an executed merge into the main branch, marks the merge-created
 * versions as published by:
 *   1. Setting publish provenance fields on each main-side merge version
 *      (source_branch_id, source_version_id) and the back-link
 *      (published_to_version_id) on the corresponding source-branch version,
 *      when a clean source version is identifiable.
 *   2. Creating a `publish` checkpoint on main referencing exactly the
 *      merge-touched documents (allowlist semantics via documentVersionIds).
 *
 * Safety: only versions explicitly passed in via `mergedVersions` are touched.
 * Untouched documents on main (including ones with unpublished edits) are
 * never affected because the publish checkpoint uses the allowlist field.
 */

import { query } from '../db';
import { createCheckpoint } from './checkpoint-service';
import { purgeContentCache } from '../cache/purge';

export interface MergedVersionWithSource {
  documentId: string;
  /** The newly created version on the main branch. */
  documentVersionId: string;
  /**
   * The source-branch version this main-side version came from.
   * Null when no single source-branch version is identifiable
   * (e.g. take-target conflict resolution, manual resolution).
   */
  sourceVersionId: string | null;
}

export interface PublishMergedVersionsParams {
  siteId: string;
  mainBranchId: string;
  sourceBranchId: string;
  mergedVersions: MergedVersionWithSource[];
  mergedById: string;
  mergedByType: 'user' | 'agent';
  mergeTitle: string;
}

export interface PublishMergedVersionsResult {
  /** Id of the publish checkpoint, or undefined when no versions were published. */
  checkpointId?: string;
  /** Number of documents included in the publish checkpoint. */
  publishedCount: number;
}

export async function publishMergedVersions(
  params: PublishMergedVersionsParams,
): Promise<PublishMergedVersionsResult> {
  const {
    mainBranchId,
    sourceBranchId,
    mergedVersions,
    mergedById,
    mergedByType,
    mergeTitle,
  } = params;

  if (mergedVersions.length === 0) {
    return { publishedCount: 0 };
  }

  // Order matters: create the publish checkpoint FIRST so that if it fails
  // we leave no provenance behind. createCheckpoint manages its own
  // transaction (BEGIN/COMMIT/ROLLBACK) — we deliberately do NOT wrap an
  // outer transaction around it because PostgreSQL doesn't nest transactions.
  // After the checkpoint commits, isPublished is already true; the provenance
  // UPDATEs below are best-effort metadata for the "published from X" badge.
  // If they fail, isPublished stays true and the badge data is missing —
  // graceful degradation matching the take-target case.
  const checkpoint = await createCheckpoint({
    branchId: mainBranchId,
    name: `Auto-publish: ${mergeTitle}`,
    checkpointType: 'publish',
    createdById: mergedById,
    createdByType: mergedByType,
    documentVersionIds: mergedVersions.map((v) => ({
      documentId: v.documentId,
      documentVersionId: v.documentVersionId,
    })),
  });

  // In a finally because the checkpoint above has already committed: a throw
  // from the best-effort provenance UPDATEs would otherwise leave content
  // live-published but the edge serving pre-merge content for a full TTL plus
  // stale-while-revalidate window, with no purge log to show it happened.
  try {
    for (const entry of mergedVersions) {
      if (entry.sourceVersionId === null) {
        continue;
      }
      await query(
        `UPDATE app.document_versions
         SET source_branch_id = $1, source_version_id = $2
         WHERE id = $3`,
        [sourceBranchId, entry.sourceVersionId, entry.documentVersionId],
      );
      await query(
        `UPDATE app.document_versions
         SET published_to_version_id = $1
         WHERE id = $2`,
        [entry.documentVersionId, entry.sourceVersionId],
      );
    }
  } finally {
    await purgeContentCache({
      siteId: params.siteId,
      branchId: mainBranchId,
    });
  }

  return {
    checkpointId: checkpoint.checkpoint.id,
    publishedCount: mergedVersions.length,
  };
}
