/**
 * Branch Diff Utility
 *
 * Bridges merge preview API data with existing Puck diff utilities
 * for branch-level comparison. Provides document-level and aggregate
 * merge comparison capabilities.
 */

import type { PuckData } from '@pantheon/css-client';
import type { ComponentDiffWithPosition } from '../types.js';
import { diffPuckDataWithPositions } from './diff.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Comparison result for a single document between source and target branches.
 */
export interface BranchDocumentComparison {
  /** Document identifier. */
  documentId: string;

  /** Document path (e.g., '/pages/home'). */
  documentPath: string;

  /** Whether the snapshots were detected as PuckData. */
  isPuckData: boolean;

  /** Component-level diffs with position information. */
  diffs: ComponentDiffWithPosition[];

  /** Aggregated change counts for this document. */
  counts: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

/**
 * Aggregated comparison result across all documents in a branch merge.
 */
export interface BranchMergeComparison {
  /** Per-document comparison results. */
  documents: BranchDocumentComparison[];

  /** Aggregated change counts across all documents. */
  totalCounts: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };

  /** Total number of documents compared. */
  documentCount: number;

  /** Number of documents that have at least one non-unchanged diff. */
  changedDocumentCount: number;
}

/**
 * Input summary for a document to be diffed between branches.
 */
export interface DocumentDiffSummary {
  /** Document identifier. */
  documentId: string;

  /** Document path (e.g., '/pages/home'). */
  documentPath: string;

  /** Snapshot from the source branch (may be PuckData or regular JSON). */
  sourceSnapshot: unknown;

  /** Snapshot from the target branch (may be PuckData or regular JSON). */
  targetSnapshot: unknown;
}

// =============================================================================
// Utilities
// =============================================================================

/** Empty PuckData used as a stand-in for null snapshots. */
const EMPTY_PUCK_DATA: PuckData = { content: [], root: { props: {} } };

/**
 * Detects whether the given value is a PuckData structure.
 *
 * A value is considered PuckData when it is a non-null object with a
 * `content` property that is an array and a `root` property that is
 * an object.
 *
 * @param data - The value to inspect.
 * @returns `true` if the value matches the PuckData shape.
 *
 * @example
 * ```typescript
 * if (isPuckData(snapshot)) {
 *   const diffs = diffPuckDataWithPositions(before, snapshot);
 * }
 * ```
 */
export function isPuckData(data: unknown): boolean {
  if (data === null || data === undefined || typeof data !== 'object') {
    return false;
  }

  const obj = data as Record<string, unknown>;

  return Array.isArray(obj.content) && obj.root !== null && typeof obj.root === 'object';
}

/**
 * Counts diffs by type, producing an object with `added`, `removed`,
 * `modified`, and `unchanged` tallies.
 */
function countDiffs(diffs: ComponentDiffWithPosition[]): {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
} {
  const counts = { added: 0, removed: 0, modified: 0, unchanged: 0 };

  for (const diff of diffs) {
    if (diff.type === 'added') {
      counts.added++;
    } else if (diff.type === 'removed') {
      counts.removed++;
    } else if (diff.type === 'modified') {
      counts.modified++;
    } else if (diff.type === 'unchanged') {
      counts.unchanged++;
    }
    // 'reordered' diffs are intentionally not counted in the four standard
    // buckets; they are tracked via the reordered flag on modified diffs.
  }

  return counts;
}

/**
 * Creates a comparison for a single document between source and target
 * branch snapshots.
 *
 * Behaviour varies depending on the snapshot values:
 *
 * - **Both PuckData** -- uses `diffPuckDataWithPositions` to compute
 *   component-level diffs.
 * - **Source is null, target is PuckData** -- produces synthetic diffs
 *   where all components in the target are marked as `added`.
 * - **Target is null, source is PuckData** -- produces synthetic diffs
 *   where all components in the source are marked as `removed`.
 * - **Neither is PuckData / both null** -- returns empty diffs with
 *   `isPuckData: false`.
 *
 * @param documentId   - Unique identifier of the document.
 * @param documentPath - Path of the document (e.g., '/pages/home').
 * @param sourceSnapshot - Snapshot from the source branch (or null).
 * @param targetSnapshot - Snapshot from the target branch (or null).
 * @returns A {@link BranchDocumentComparison} describing the differences.
 *
 * @example
 * ```typescript
 * const comparison = createBranchDocumentComparison(
 *   'doc-1',
 *   '/pages/home',
 *   sourceBranchSnapshot,
 *   targetBranchSnapshot
 * );
 * console.log(comparison.counts); // { added: 0, removed: 1, modified: 2, unchanged: 5 }
 * ```
 */
export function createBranchDocumentComparison(
  documentId: string,
  documentPath: string,
  sourceSnapshot: unknown,
  targetSnapshot: unknown
): BranchDocumentComparison {
  const sourceIsPuck = isPuckData(sourceSnapshot);
  const targetIsPuck = isPuckData(targetSnapshot);

  // Neither side is PuckData (or both are null) -- nothing we can diff.
  if (!sourceIsPuck && !targetIsPuck) {
    return {
      documentId,
      documentPath,
      isPuckData: false,
      diffs: [],
      counts: { added: 0, removed: 0, modified: 0, unchanged: 0 },
    };
  }

  // Determine the effective before / after PuckData, substituting the
  // empty placeholder when one side is null.
  const before: PuckData = sourceIsPuck
    ? (sourceSnapshot as PuckData)
    : EMPTY_PUCK_DATA;
  const after: PuckData = targetIsPuck
    ? (targetSnapshot as PuckData)
    : EMPTY_PUCK_DATA;

  const diffs = diffPuckDataWithPositions(before, after);
  const counts = countDiffs(diffs);

  return {
    documentId,
    documentPath,
    isPuckData: true,
    diffs,
    counts,
  };
}

/**
 * Creates an aggregated comparison across multiple documents for a
 * branch merge operation.
 *
 * Calls {@link createBranchDocumentComparison} for each document and
 * aggregates the resulting counts. A document is considered "changed"
 * when it contains at least one diff whose type is **not** `unchanged`.
 *
 * @param documents - Array of document diff summaries to compare.
 * @returns A {@link BranchMergeComparison} with per-document results
 *          and aggregate statistics.
 *
 * @example
 * ```typescript
 * const merge = createBranchMergeComparison([
 *   { documentId: 'doc-1', documentPath: '/home', sourceSnapshot, targetSnapshot },
 *   { documentId: 'doc-2', documentPath: '/about', sourceSnapshot: null, targetSnapshot },
 * ]);
 * console.log(merge.changedDocumentCount); // number of docs with changes
 * ```
 */
export function createBranchMergeComparison(
  documents: DocumentDiffSummary[]
): BranchMergeComparison {
  const totalCounts = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const comparisons: BranchDocumentComparison[] = [];
  let changedDocumentCount = 0;

  for (const doc of documents) {
    const comparison = createBranchDocumentComparison(
      doc.documentId,
      doc.documentPath,
      doc.sourceSnapshot,
      doc.targetSnapshot
    );

    comparisons.push(comparison);

    // Aggregate counts.
    totalCounts.added += comparison.counts.added;
    totalCounts.removed += comparison.counts.removed;
    totalCounts.modified += comparison.counts.modified;
    totalCounts.unchanged += comparison.counts.unchanged;

    // A document is "changed" if it has any diff that is not 'unchanged'.
    const hasChanges = comparison.diffs.some(
      (diff) => diff.type !== 'unchanged'
    );
    if (hasChanges) {
      changedDocumentCount++;
    }
  }

  return {
    documents: comparisons,
    totalCounts,
    documentCount: documents.length,
    changedDocumentCount,
  };
}
