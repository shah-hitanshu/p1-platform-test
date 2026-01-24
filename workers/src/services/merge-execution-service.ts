/**
 * Phase 5.3: Merge Execution Service
 *
 * Orchestrates the complete merge workflow:
 * 1. Validate merge request status
 * 2. Detect conflicts
 * 3. Apply source changes to target branch
 * 4. Create post-merge checkpoint
 * 5. Update merge request status
 *
 * Based on collaborative-state-system-architecture-v2.2.md
 */

import { detectConflicts } from './conflict-detection-service';
import type { ConflictDetectionResult } from './conflict-detection-service';
import { resolveAllConflicts } from './conflict-resolution-service';
import { resolveWithCrdtMerge } from './crdt-merge-service';
import {
  getMergeRequest,
  updateMergeRequestStatus,
  updateMergeRequestConflicts,
  MergeRequestNotFoundError,
} from './merge-request-service';
import type { MergeRequest } from '../types';
import {
  createDocumentVersion,
  getDocumentVersion,
} from './document-version-service';
import { createCheckpoint } from './checkpoint-service';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for executing a merge.
 */
export interface ExecuteMergeParams {
  mergeRequestId: string;
  mergedById: string;
  mergedByType: 'user' | 'agent';
}

/**
 * Result of executing a merge.
 */
export interface ExecuteMergeResult {
  success: boolean;
  mergeRequestId: string;
  checkpointId?: string;
  documentsUpdated: number;
  error?: string;
}

/**
 * Parameters for executing a merge with conflict resolution.
 */
export interface ExecuteMergeWithResolutionParams {
  mergeRequestId: string;
  resolutionStrategy: 'take-source' | 'take-target' | 'merge-crdt';
  mergedById: string;
  mergedByType: 'user' | 'agent';
}

/**
 * Result of executing a merge with resolution.
 */
export interface ExecuteMergeWithResolutionResult extends ExecuteMergeResult {
  conflictsResolved: number;
}

/**
 * Merge preview showing what would happen.
 */
export interface MergePreview {
  canMerge: boolean;
  hasConflicts: boolean;
  conflicts: ConflictDetectionResult['conflicts'];
  sourceChanges: ConflictDetectionResult['sourceChanges'];
  targetChanges: ConflictDetectionResult['targetChanges'];
  mergeBase: ConflictDetectionResult['mergeBase'];
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when merge is not allowed due to status.
 */
export class MergeNotAllowedError extends Error {
  public readonly name = 'MergeNotAllowedError';

  constructor(
    public readonly mergeRequestId: string,
    public readonly currentStatus: string,
    message: string,
  ) {
    super(`Merge not allowed for request "${mergeRequestId}": ${message}`);
    Object.setPrototypeOf(this, MergeNotAllowedError.prototype);
  }
}

/**
 * Error thrown when merge cannot proceed due to conflicts.
 */
export class MergeConflictsError extends Error {
  public readonly name = 'MergeConflictsError';

  constructor(
    public readonly mergeRequestId: string,
    public readonly conflictCount: number,
  ) {
    super(
      `Merge request "${mergeRequestId}" has ${String(conflictCount)} conflict(s) that must be resolved.`,
    );
    Object.setPrototypeOf(this, MergeConflictsError.prototype);
  }
}

/**
 * Error thrown when merge execution fails.
 */
export class MergeExecutionError extends Error {
  public readonly name = 'MergeExecutionError';

  constructor(
    public readonly mergeRequestId: string,
    reason: string,
  ) {
    super(`Merge execution failed for request "${mergeRequestId}": ${reason}`);
    Object.setPrototypeOf(this, MergeExecutionError.prototype);
  }
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Execute a merge for an approved merge request.
 *
 * This is the main merge workflow:
 * 1. Fetch and validate merge request is approved
 * 2. Detect any conflicts
 * 3. If conflicts, update merge request and throw error
 * 4. Copy source changes to target branch
 * 5. Create post-merge checkpoint
 * 6. Update merge request status to merged
 */
export async function executeMerge(
  params: ExecuteMergeParams,
): Promise<ExecuteMergeResult> {
  const { mergeRequestId, mergedById, mergedByType } = params;

  // 1. Fetch merge request
  const mergeRequest = await getMergeRequest(mergeRequestId);
  if (mergeRequest === null) {
    throw new MergeRequestNotFoundError(mergeRequestId);
  }

  // 2. Validate status is approved
  if (mergeRequest.status !== 'approved') {
    throw new MergeNotAllowedError(
      mergeRequestId,
      mergeRequest.status,
      'Merge request must be approved',
    );
  }

  // 3. Detect conflicts
  const detectionResult = await detectConflicts({
    sourceBranchId: mergeRequest.sourceBranchId,
    targetBranchId: mergeRequest.targetBranchId,
  });

  // 4. If conflicts exist, update merge request and throw error
  if (detectionResult.hasConflicts) {
    await updateMergeRequestConflicts(mergeRequestId, {
      hasConflicts: true,
      conflictDetails: detectionResult.conflicts,
    });

    throw new MergeConflictsError(
      mergeRequestId,
      detectionResult.conflicts.documentConflicts.length,
    );
  }

  // 5. Copy source changes to target branch
  const documentsUpdated = await copySourceChangesToTarget(
    mergeRequest,
    detectionResult,
    mergedById,
    mergedByType,
  );

  // 6. Create post-merge checkpoint
  const checkpointResult = await createCheckpoint({
    branchId: mergeRequest.targetBranchId,
    name: `Merge: ${mergeRequest.title}`,
    type: 'post_merge',
    createdById: mergedById,
    createdByType: mergedByType,
  });

  // 7. Update merge request status to merged
  await updateMergeRequestStatus(mergeRequestId, 'merged', {
    mergedAt: new Date().toISOString(),
    mergedById,
    mergedByType,
  });

  return {
    success: true,
    mergeRequestId,
    checkpointId: checkpointResult.checkpoint.id,
    documentsUpdated,
  };
}

/**
 * Execute a merge with automatic conflict resolution.
 *
 * Applies the specified resolution strategy to all conflicts,
 * then executes the merge.
 */
export async function executeMergeWithResolution(
  params: ExecuteMergeWithResolutionParams,
): Promise<ExecuteMergeWithResolutionResult> {
  const { mergeRequestId, resolutionStrategy, mergedById, mergedByType } =
    params;

  // 1. Fetch merge request
  const mergeRequest = await getMergeRequest(mergeRequestId);
  if (mergeRequest === null) {
    throw new MergeRequestNotFoundError(mergeRequestId);
  }

  // 2. Validate status is approved
  if (mergeRequest.status !== 'approved') {
    throw new MergeNotAllowedError(
      mergeRequestId,
      mergeRequest.status,
      'Merge request must be approved',
    );
  }

  // 3. Detect conflicts
  const detectionResult = await detectConflicts({
    sourceBranchId: mergeRequest.sourceBranchId,
    targetBranchId: mergeRequest.targetBranchId,
  });

  let conflictsResolved = 0;

  // 4. Resolve conflicts if any
  if (detectionResult.hasConflicts) {
    if (resolutionStrategy === 'merge-crdt') {
      // Use CRDT merge for each conflict
      for (const conflict of detectionResult.conflicts.documentConflicts) {
        const sourceChange = detectionResult.sourceChanges.find(
          (c) => c.documentId === conflict.documentId,
        );
        const targetChange = detectionResult.targetChanges.find(
          (c) => c.documentId === conflict.documentId,
        );

        if (
          sourceChange !== undefined &&
          sourceChange.latestVersionId !== null &&
          sourceChange.latestVersionId !== '' &&
          targetChange !== undefined &&
          targetChange.latestVersionId !== null &&
          targetChange.latestVersionId !== ''
        ) {
          await resolveWithCrdtMerge({
            documentId: conflict.documentId,
            sourceBranchId: mergeRequest.sourceBranchId,
            targetBranchId: mergeRequest.targetBranchId,
            sourceVersionId: sourceChange.latestVersionId,
            targetVersionId: targetChange.latestVersionId,
            resolvedById: mergedById,
            resolvedByType: mergedByType,
          });
          conflictsResolved++;
        }
      }
    } else {
      // Use take-source or take-target
      const resolutionResult = await resolveAllConflicts({
        mergeRequestId,
        conflicts: buildConflictsWithVersions(detectionResult),
        strategy: resolutionStrategy,
        resolvedById: mergedById,
        resolvedByType: mergedByType,
      });
      conflictsResolved = resolutionResult.resolvedCount;
    }
  }

  // 5. Copy non-conflicting source changes to target
  const documentsUpdated = await copySourceChangesToTarget(
    mergeRequest,
    detectionResult,
    mergedById,
    mergedByType,
  );

  // 6. Create post-merge checkpoint
  const checkpointResult = await createCheckpoint({
    branchId: mergeRequest.targetBranchId,
    name: `Merge: ${mergeRequest.title}`,
    type: 'post_merge',
    createdById: mergedById,
    createdByType: mergedByType,
  });

  // 7. Update merge request status
  await updateMergeRequestStatus(mergeRequestId, 'merged', {
    mergedAt: new Date().toISOString(),
    mergedById,
    mergedByType,
  });

  return {
    success: true,
    mergeRequestId,
    checkpointId: checkpointResult.checkpoint.id,
    documentsUpdated,
    conflictsResolved,
  };
}

/**
 * Preview what would happen in a merge.
 *
 * Does not modify any data - just detects conflicts and changes.
 */
export async function previewMerge(
  mergeRequestId: string,
): Promise<MergePreview> {
  const mergeRequest = await getMergeRequest(mergeRequestId);
  if (mergeRequest === null) {
    throw new MergeRequestNotFoundError(mergeRequestId);
  }

  const detectionResult = await detectConflicts({
    sourceBranchId: mergeRequest.sourceBranchId,
    targetBranchId: mergeRequest.targetBranchId,
  });

  return {
    canMerge: !detectionResult.hasConflicts,
    hasConflicts: detectionResult.hasConflicts,
    conflicts: detectionResult.conflicts,
    sourceChanges: detectionResult.sourceChanges,
    targetChanges: detectionResult.targetChanges,
    mergeBase: detectionResult.mergeBase,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Copy source branch changes to target branch.
 * Creates new document versions on the target branch.
 */
async function copySourceChangesToTarget(
  mergeRequest: MergeRequest,
  detectionResult: ConflictDetectionResult,
  mergedById: string,
  mergedByType: 'user' | 'agent',
): Promise<number> {
  let documentsUpdated = 0;

  // Get conflicting document IDs to skip
  const conflictingDocIds = new Set(
    detectionResult.conflicts.documentConflicts.map((c) => c.documentId),
  );

  // Copy each non-conflicting source change to target
  for (const change of detectionResult.sourceChanges) {
    if (conflictingDocIds.has(change.documentId)) {
      continue; // Skip conflicting documents
    }

    // Get the source version
    const sourceVersion = await getDocumentVersion(change.latestVersionId);
    if (sourceVersion === null) {
      continue;
    }

    // Create version on target branch
    await createDocumentVersion({
      documentId: change.documentId,
      branchId: mergeRequest.targetBranchId,
      snapshot: sourceVersion.snapshot,
      crdtState: sourceVersion.crdtState,
      source: 'merge',
      createdById: mergedById,
      createdByType: mergedByType,
    });

    documentsUpdated++;
  }

  return documentsUpdated;
}

/**
 * Build conflict objects with version information for resolution.
 */
function buildConflictsWithVersions(
  detectionResult: ConflictDetectionResult,
): {
  documentId: string;
  conflictType: string;
  sourceVersionId: string;
  targetVersionId: string;
}[] {
  return detectionResult.conflicts.documentConflicts.map((conflict) => {
    const sourceChange = detectionResult.sourceChanges.find(
      (c) => c.documentId === conflict.documentId,
    );
    const targetChange = detectionResult.targetChanges.find(
      (c) => c.documentId === conflict.documentId,
    );

    return {
      documentId: conflict.documentId,
      conflictType: conflict.conflictType,
      sourceVersionId: sourceChange?.latestVersionId ?? '',
      targetVersionId: targetChange?.latestVersionId ?? '',
    };
  });
}
