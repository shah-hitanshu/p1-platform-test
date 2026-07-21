/**
 * Categorize Changes
 *
 * Pure function that takes sourceChanges, targetChanges, and conflicts
 * from the merge preview response and categorizes documents into:
 * - sourceOnly: changed only on source branch
 * - targetOnly: changed only on target branch
 * - conflicting: changed on both branches (with conflict info)
 */

import type { ModifiedDocument, DocumentConflict } from '../../types';

/** Categorized document-level changes from a merge preview. */
export interface DocumentChangeSummaryResult {
  /** Documents changed only in the source branch. */
  sourceOnly: ModifiedDocument[];
  /** Documents changed only in the target branch. */
  targetOnly: ModifiedDocument[];
  /** Documents changed in both branches with conflicting edits. */
  conflicting: DocumentConflict[];
  /** Total number of changed documents across all categories. */
  totalChanges: number;
}

/**
 * Categorize merge preview changes into source-only, target-only, and conflicting groups.
 * Excludes documents that appear in the conflicts list from the source-only and target-only results.
 *
 * @param sourceChanges - Documents modified on the source branch.
 * @param targetChanges - Documents modified on the target branch.
 * @param conflicts - Documents with conflicting changes across both branches.
 * @returns A categorized summary with totals.
 */
export function categorizeChanges(
  sourceChanges: ModifiedDocument[],
  targetChanges: ModifiedDocument[],
  conflicts: DocumentConflict[]
): DocumentChangeSummaryResult {
  const conflictDocIds = new Set(conflicts.map((c) => c.documentId));

  const sourceOnly = sourceChanges.filter(
    (doc) => !conflictDocIds.has(doc.documentId)
  );

  const targetOnly = targetChanges.filter(
    (doc) => !conflictDocIds.has(doc.documentId)
  );

  const totalChanges = sourceOnly.length + targetOnly.length + conflicts.length;

  return {
    sourceOnly,
    targetOnly,
    conflicting: conflicts,
    totalChanges,
  };
}
