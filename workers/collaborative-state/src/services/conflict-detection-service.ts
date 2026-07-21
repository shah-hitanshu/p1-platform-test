/**
 * Phase 5.2a: Conflict Detection Service
 *
 * Detects document-level conflicts between branches during merge operations.
 * Uses merge base service to find common ancestor and compare changes.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Merge Operations"
 */

import type { ConflictDetails, DocumentConflict } from '../types';
import {
  findMergeBase,
  getModifiedDocumentsSince,
  type MergeBase,
  type ModifiedDocument,
} from './merge-base-service';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of conflict detection between two branches.
 */
export interface ConflictDetectionResult {
  hasConflicts: boolean;
  conflicts: ConflictDetails;
  mergeBase: MergeBase | null;
  sourceChanges: ModifiedDocument[];
  targetChanges: ModifiedDocument[];
}

/**
 * Result of checking if branches can be merged.
 */
export interface MergeabilityResult {
  canMerge: boolean;
  conflicts: DocumentConflict[];
  mergeBase: MergeBase;
  changes: {
    documentsModifiedInSource: string[];
    documentsModifiedInTarget: string[];
  };
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when no merge base (common ancestor) can be found between branches.
 */
export class NoMergeBaseError extends Error {
  public readonly name = 'NoMergeBaseError';

  constructor(
    public readonly sourceBranchId: string,
    public readonly targetBranchId: string,
  ) {
    super(
      `No common ancestor found between source branch "${sourceBranchId}" and target branch "${targetBranchId}".`,
    );
    Object.setPrototypeOf(this, NoMergeBaseError.prototype);
  }
}

// =============================================================================
// Conflict Detection
// =============================================================================

/**
 * Determine the conflict type based on document states.
 */
function determineConflictType(
  sourceDoc: ModifiedDocument | undefined,
  targetDoc: ModifiedDocument | undefined,
): DocumentConflict['conflictType'] | null {
  const sourceDeleted = sourceDoc?.isDeleted === true;
  const targetDeleted = targetDoc?.isDeleted === true;
  const sourceModified = sourceDoc !== undefined && !sourceDeleted;
  const targetModified = targetDoc !== undefined && !targetDeleted;

  // Both deleted - no conflict (they agree)
  if (sourceDeleted && targetDeleted) {
    return null;
  }

  // Source deleted, target modified - conflict
  if (sourceDeleted && targetModified) {
    return 'deleted-in-source';
  }

  // Target deleted, source modified - conflict
  if (targetDeleted && sourceModified) {
    return 'deleted-in-target';
  }

  // Both modified - conflict
  if (sourceModified && targetModified) {
    return 'both-modified';
  }

  // No conflict (only one side changed)
  return null;
}

/**
 * Detect conflicts between source and target branches.
 *
 * Algorithm:
 * 1. Find the merge base (common ancestor checkpoint)
 * 2. Get documents modified on source branch since merge base
 * 3. Get documents modified on target branch since merge base
 * 4. Find overlapping document IDs and determine conflict type
 */
export async function detectConflicts(
  sourceBranchId: string,
  targetBranchId: string,
): Promise<ConflictDetectionResult> {
  // Find merge base
  const mergeBase = await findMergeBase(sourceBranchId, targetBranchId);

  if (mergeBase === null) {
    throw new NoMergeBaseError(sourceBranchId, targetBranchId);
  }

  // Get changes on both branches since merge base
  const sourceChanges = await getModifiedDocumentsSince(sourceBranchId, mergeBase.checkpointId);
  const targetChanges = await getModifiedDocumentsSince(targetBranchId, mergeBase.checkpointId, {
    publishedOnly: true,
  });

  // Build lookup maps
  const sourceByDocId = new Map<string, ModifiedDocument>();
  for (const doc of sourceChanges) {
    sourceByDocId.set(doc.documentId, doc);
  }

  const targetByDocId = new Map<string, ModifiedDocument>();
  for (const doc of targetChanges) {
    targetByDocId.set(doc.documentId, doc);
  }

  // Find all document IDs that were touched by either branch
  const allDocIds = new Set<string>([...sourceByDocId.keys(), ...targetByDocId.keys()]);

  // Detect conflicts
  const documentConflicts: DocumentConflict[] = [];

  for (const docId of allDocIds) {
    const sourceDoc = sourceByDocId.get(docId);
    const targetDoc = targetByDocId.get(docId);

    // Only conflict if BOTH branches touched this document
    if (sourceDoc === undefined || targetDoc === undefined) {
      continue;
    }

    const conflictType = determineConflictType(sourceDoc, targetDoc);

    if (conflictType !== null) {
      documentConflicts.push({
        documentId: docId,
        documentPath: sourceDoc.documentPath,
        conflictType,
        sourceVersion: sourceDoc.latestVersionNumber ?? undefined,
        targetVersion: targetDoc.latestVersionNumber ?? undefined,
        baseVersion: sourceDoc.baseVersionNumber ?? undefined,
      });
    }
  }

  return {
    hasConflicts: documentConflicts.length > 0,
    conflicts: {
      documentConflicts,
      structureConflicts: [], // Phase 6 will implement structure conflicts
    },
    mergeBase,
    sourceChanges,
    targetChanges,
  };
}

/**
 * Check if two branches can be merged without conflicts.
 * Returns a simplified result focused on mergeability.
 */
export async function checkMergeability(
  sourceBranchId: string,
  targetBranchId: string,
): Promise<MergeabilityResult> {
  const result = await detectConflicts(sourceBranchId, targetBranchId);

  // Merge base is guaranteed to exist (detectConflicts throws NoMergeBaseError if null)
  // This check is for type narrowing
  if (result.mergeBase === null) {
    throw new NoMergeBaseError(sourceBranchId, targetBranchId);
  }

  return {
    canMerge: !result.hasConflicts,
    conflicts: result.conflicts.documentConflicts,
    mergeBase: result.mergeBase,
    changes: {
      documentsModifiedInSource: result.sourceChanges.map((doc) => doc.documentPath),
      documentsModifiedInTarget: result.targetChanges.map((doc) => doc.documentPath),
    },
  };
}
