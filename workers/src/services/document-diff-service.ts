/**
 * Phase 10.1: Document Diff Service
 *
 * Computes JSON diffs between document versions for merge visualization.
 * Uses fast-json-patch for RFC 6902 compliant diff operations.
 *
 * @see collaborative-state-system-architecture-v2.2.md
 */

import { compare, type Operation } from 'fast-json-patch';
import { getDocumentVersion } from './document-version-service';
import type { ModifiedDocument } from './merge-base-service';
import type { DocumentConflict } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * RFC 6902 JSON Patch operation.
 */
export type DiffOperation = Operation;

/**
 * Diff result for a single document.
 */
export interface DocumentDiff {
  documentId: string;
  documentPath: string;
  sourceSnapshot: Record<string, unknown> | null;
  targetSnapshot: Record<string, unknown> | null;
  diffOperations: DiffOperation[];
}

// Re-export ModifiedDocument for convenience
export type { ModifiedDocument };

/**
 * Result of computing a diff between two versions.
 */
export interface ComputedDiff {
  sourceSnapshot: Record<string, unknown>;
  targetSnapshot: Record<string, unknown>;
  diffOperations: DiffOperation[];
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when a document version is not found.
 */
export class DocumentVersionNotFoundError extends Error {
  public readonly name = 'DocumentVersionNotFoundError';

  constructor(public readonly versionId: string) {
    super(`Document version with ID "${versionId}" not found.`);
    Object.setPrototypeOf(this, DocumentVersionNotFoundError.prototype);
  }
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Computes the JSON diff between two objects using RFC 6902 JSON Patch format.
 *
 * @param source - The source (original) object
 * @param target - The target (modified) object
 * @returns Array of diff operations to transform source into target
 */
export function computeJsonDiff(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): DiffOperation[] {
  // fast-json-patch.compare returns operations to transform source into target
  return compare(source, target);
}

/**
 * Computes the diff between two document versions by their IDs.
 *
 * @param sourceVersionId - ID of the source version
 * @param targetVersionId - ID of the target version
 * @returns Computed diff with snapshots and operations
 * @throws DocumentVersionNotFoundError if either version is not found
 */
export async function computeDocumentDiff(
  sourceVersionId: string,
  targetVersionId: string,
): Promise<ComputedDiff> {
  // Fetch both versions
  const sourceVersion = await getDocumentVersion(sourceVersionId);
  if (!sourceVersion) {
    throw new DocumentVersionNotFoundError(sourceVersionId);
  }

  const targetVersion = await getDocumentVersion(targetVersionId);
  if (!targetVersion) {
    throw new DocumentVersionNotFoundError(targetVersionId);
  }

  // Versions used for diff should always be baselines with snapshots.
  // If snapshot is missing (diff version), use empty object as fallback.
  const sourceSnap = sourceVersion.snapshot ?? {};
  const targetSnap = targetVersion.snapshot ?? {};

  // Compute diff operations
  const diffOperations = computeJsonDiff(sourceSnap, targetSnap);

  return {
    sourceSnapshot: sourceSnap,
    targetSnapshot: targetSnap,
    diffOperations,
  };
}

/**
 * Computes diffs for all conflicting documents.
 *
 * @param conflicts - List of document conflicts
 * @param sourceChanges - Modified documents on source branch
 * @param targetChanges - Modified documents on target branch
 * @returns Array of document diffs for each conflict
 */
export async function computeDocumentDiffs(
  conflicts: DocumentConflict[],
  sourceChanges: ModifiedDocument[],
  targetChanges: ModifiedDocument[],
): Promise<DocumentDiff[]> {
  if (conflicts.length === 0) {
    return [];
  }

  // Build lookup maps for quick access
  const sourceMap = new Map<string, ModifiedDocument>();
  for (const change of sourceChanges) {
    sourceMap.set(change.documentId, change);
  }

  const targetMap = new Map<string, ModifiedDocument>();
  for (const change of targetChanges) {
    targetMap.set(change.documentId, change);
  }

  // Process each conflict
  const diffs: DocumentDiff[] = [];

  for (const conflict of conflicts) {
    const sourceChange = sourceMap.get(conflict.documentId);
    const targetChange = targetMap.get(conflict.documentId);

    let sourceSnapshot: Record<string, unknown> | null = null;
    let targetSnapshot: Record<string, unknown> | null = null;
    let diffOperations: DiffOperation[] = [];

    // Handle different conflict types
    if (conflict.conflictType === 'deleted-in-source') {
      // Source was deleted, only fetch target
      if (targetChange?.latestVersionId != null) {
        const targetVersion = await getDocumentVersion(targetChange.latestVersionId);
        targetSnapshot = targetVersion?.snapshot ?? null;
      }
    } else if (conflict.conflictType === 'deleted-in-target') {
      // Target was deleted, only fetch source
      if (sourceChange?.latestVersionId != null) {
        const sourceVersion = await getDocumentVersion(sourceChange.latestVersionId);
        sourceSnapshot = sourceVersion?.snapshot ?? null;
      }
    } else {
      // Both modified - fetch both and compute diff
      if (sourceChange?.latestVersionId != null) {
        const sourceVersion = await getDocumentVersion(sourceChange.latestVersionId);
        sourceSnapshot = sourceVersion?.snapshot ?? null;
      }

      if (targetChange?.latestVersionId != null) {
        const targetVersion = await getDocumentVersion(targetChange.latestVersionId);
        targetSnapshot = targetVersion?.snapshot ?? null;
      }

      // Compute diff if both snapshots available
      if (sourceSnapshot != null && targetSnapshot != null) {
        diffOperations = computeJsonDiff(sourceSnapshot, targetSnapshot);
      }
    }

    diffs.push({
      documentId: conflict.documentId,
      documentPath: conflict.documentPath,
      sourceSnapshot,
      targetSnapshot,
      diffOperations,
    });
  }

  return diffs;
}
