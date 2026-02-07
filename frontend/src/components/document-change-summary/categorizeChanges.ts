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

export interface DocumentChangeSummaryResult {
  sourceOnly: ModifiedDocument[];
  targetOnly: ModifiedDocument[];
  conflicting: DocumentConflict[];
  totalChanges: number;
}

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
