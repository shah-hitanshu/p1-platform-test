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
import { computeDocumentDiffs } from './document-diff-service';
import type { DocumentDiff } from './document-diff-service';
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
 * Per-document resolution instruction.
 */
export interface DocumentResolution {
  documentId: string;
  strategy: 'take-source' | 'take-target' | 'merge-crdt' | 'manual';
  /** Required when strategy is 'manual'. The client-provided merged snapshot. */
  resolvedSnapshot?: Record<string, unknown>;
}

/**
 * Parameters for executing a merge with conflict resolution.
 */
export interface ExecuteMergeWithResolutionParams {
  mergeRequestId: string;
  /** Default strategy applied to conflicts without a per-document resolution. */
  resolutionStrategy: 'take-source' | 'take-target' | 'merge-crdt';
  /** Optional per-document resolutions that override the default strategy. */
  resolutions?: DocumentResolution[];
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
 * Options for merge preview.
 */
export interface PreviewMergeOptions {
  /**
   * When true, includes full document snapshots and diff operations
   * for each conflicting document.
   */
  includeContent?: boolean;
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
  /**
   * Document diffs with snapshots and operations.
   * Only included when options.includeContent is true.
   */
  documentDiffs?: DocumentDiff[];
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
  const detectionResult = await detectConflicts(
    mergeRequest.sourceBranchId,
    mergeRequest.targetBranchId,
  );

  // 4. If conflicts exist, update merge request status and throw error
  if (detectionResult.hasConflicts) {
    await updateMergeRequestConflicts(mergeRequestId, detectionResult.conflicts);

    // Transition to 'conflicted' status so the UI can show resolution options
    await updateMergeRequestStatus(mergeRequestId, 'conflicted');

    throw new MergeConflictsError(
      mergeRequestId,
      detectionResult.conflicts.documentConflicts.length,
    );
  }

  // 5. Copy source changes to target branch
  const copiedVersions = await copySourceChangesToTarget(
    mergeRequest,
    detectionResult,
    mergedById,
    mergedByType,
  );

  // 6. Create post-merge checkpoint with only merge-touched documents
  const checkpointResult = await createCheckpoint({
    branchId: mergeRequest.targetBranchId,
    name: `Merge: ${mergeRequest.title}`,
    checkpointType: 'post_merge',
    createdById: mergedById,
    createdByType: mergedByType,
    documentVersionIds: copiedVersions,
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
    documentsUpdated: copiedVersions.length,
  };
}

/**
 * Execute a merge with conflict resolution.
 *
 * Supports per-document resolution strategies including 'manual' (client-provided snapshot).
 * Falls back to the default `resolutionStrategy` for any conflict without a specific resolution.
 */
export async function executeMergeWithResolution(
  params: ExecuteMergeWithResolutionParams,
): Promise<ExecuteMergeWithResolutionResult> {
  const { mergeRequestId, resolutionStrategy, resolutions, mergedById, mergedByType } =
    params;

  // 1. Fetch merge request
  const mergeRequest = await getMergeRequest(mergeRequestId);
  if (mergeRequest === null) {
    throw new MergeRequestNotFoundError(mergeRequestId);
  }

  // 2. Validate status is approved or conflicted
  if (mergeRequest.status !== 'approved' && mergeRequest.status !== 'conflicted') {
    throw new MergeNotAllowedError(
      mergeRequestId,
      mergeRequest.status,
      'Merge request must be approved or conflicted',
    );
  }

  // 3. Detect conflicts
  const detectionResult = await detectConflicts(
    mergeRequest.sourceBranchId,
    mergeRequest.targetBranchId,
  );

  let conflictsResolved = 0;

  // Track all document versions created/referenced by this merge so that
  // the post-merge checkpoint captures ONLY merge-touched documents.
  const mergedDocVersions: MergedDocumentVersion[] = [];

  // Build a map of per-document resolutions for quick lookup
  const resolutionMap = new Map<string, DocumentResolution>();
  if (resolutions !== undefined) {
    for (const r of resolutions) {
      resolutionMap.set(r.documentId, r);
    }
  }

  // 4. Resolve conflicts if any
  if (detectionResult.hasConflicts) {
    for (const conflict of detectionResult.conflicts.documentConflicts) {
      const docResolution = resolutionMap.get(conflict.documentId);
      const strategy = docResolution?.strategy ?? resolutionStrategy;

      const sourceChange = detectionResult.sourceChanges.find(
        (c) => c.documentId === conflict.documentId,
      );
      const targetChange = detectionResult.targetChanges.find(
        (c) => c.documentId === conflict.documentId,
      );

      if (strategy === 'manual') {
        // Manual resolution: use client-provided snapshot
        if (docResolution?.resolvedSnapshot === undefined) {
          throw new MergeExecutionError(
            mergeRequestId,
            `Manual resolution for document "${conflict.documentId}" requires a resolvedSnapshot`,
          );
        }
        const manualVersion = await createDocumentVersion({
          documentId: conflict.documentId,
          branchId: mergeRequest.targetBranchId,
          snapshot: docResolution.resolvedSnapshot,
          source: 'merge',
          createdById: mergedById,
          createdByType: mergedByType,
          skipDuplicateCheck: true,
        });
        mergedDocVersions.push({
          documentId: conflict.documentId,
          documentVersionId: manualVersion.id,
        });
        conflictsResolved++;
      } else if (strategy === 'merge-crdt') {
        if (
          sourceChange !== undefined &&
          sourceChange.latestVersionId !== null &&
          sourceChange.latestVersionId !== '' &&
          targetChange !== undefined &&
          targetChange.latestVersionId !== null &&
          targetChange.latestVersionId !== ''
        ) {
          const crdtResult = await resolveWithCrdtMerge({
            documentId: conflict.documentId,
            sourceBranchId: mergeRequest.sourceBranchId,
            targetBranchId: mergeRequest.targetBranchId,
            sourceVersionId: sourceChange.latestVersionId,
            targetVersionId: targetChange.latestVersionId,
            resolvedById: mergedById,
            resolvedByType: mergedByType,
          });
          if (crdtResult.resultVersionId !== undefined) {
            mergedDocVersions.push({
              documentId: conflict.documentId,
              documentVersionId: crdtResult.resultVersionId,
            });
          }
          conflictsResolved++;
        }
      } else {
        // take-source or take-target: resolve individually
        const resolutionResult = await resolveAllConflicts({
          sourceBranchId: mergeRequest.sourceBranchId,
          targetBranchId: mergeRequest.targetBranchId,
          conflicts: [{
            documentId: conflict.documentId,
            documentPath: sourceChange?.documentPath ?? targetChange?.documentPath ?? '',
            conflictType: conflict.conflictType,
            sourceVersionId: sourceChange?.latestVersionId ?? '',
            targetVersionId: targetChange?.latestVersionId ?? '',
          }],
          strategy,
          resolvedById: mergedById,
          resolvedByType: mergedByType,
        });
        for (const res of resolutionResult.resolutions) {
          if (res.resolved && res.resultVersionId !== undefined) {
            mergedDocVersions.push({
              documentId: res.documentId,
              documentVersionId: res.resultVersionId,
            });
          }
        }
        conflictsResolved += resolutionResult.resolvedCount;
      }
    }
  }

  // 5. Copy non-conflicting source changes to target
  const copiedVersions = await copySourceChangesToTarget(
    mergeRequest,
    detectionResult,
    mergedById,
    mergedByType,
  );
  mergedDocVersions.push(...copiedVersions);

  // 6. Create post-merge checkpoint with only merge-touched documents
  const checkpointResult = await createCheckpoint({
    branchId: mergeRequest.targetBranchId,
    name: `Merge: ${mergeRequest.title}`,
    checkpointType: 'post_merge',
    createdById: mergedById,
    createdByType: mergedByType,
    documentVersionIds: mergedDocVersions,
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
    documentsUpdated: copiedVersions.length,
    conflictsResolved,
  };
}

/**
 * Preview what would happen in a merge.
 *
 * Does not modify any data - just detects conflicts and changes.
 */
export async function previewMerge(
  sourceBranchId: string,
  targetBranchId: string,
  options?: PreviewMergeOptions,
): Promise<MergePreview> {
  const detectionResult = await detectConflicts(
    sourceBranchId,
    targetBranchId,
  );

  const preview: MergePreview = {
    canMerge: !detectionResult.hasConflicts,
    hasConflicts: detectionResult.hasConflicts,
    conflicts: detectionResult.conflicts,
    sourceChanges: detectionResult.sourceChanges,
    targetChanges: detectionResult.targetChanges,
    mergeBase: detectionResult.mergeBase,
  };

  // Include document diffs if requested
  if (options?.includeContent === true) {
    preview.documentDiffs = await computeDocumentDiffs(
      detectionResult.conflicts.documentConflicts,
      detectionResult.sourceChanges,
      detectionResult.targetChanges,
    );
  }

  return preview;
}

// =============================================================================
// Helper Functions
// =============================================================================

/** A document version created or referenced during a merge. */
interface MergedDocumentVersion {
  documentId: string;
  documentVersionId: string;
}

/**
 * Copy source branch changes to target branch.
 * Creates new document versions on the target branch.
 * Returns the list of document/version pairs that were created.
 */
async function copySourceChangesToTarget(
  mergeRequest: MergeRequest,
  detectionResult: ConflictDetectionResult,
  mergedById: string,
  mergedByType: 'user' | 'agent',
): Promise<MergedDocumentVersion[]> {
  const mergedVersions: MergedDocumentVersion[] = [];

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
    // Always create for merge operations — the source='merge' marker matters for history.
    const newVersion = await createDocumentVersion({
      documentId: change.documentId,
      branchId: mergeRequest.targetBranchId,
      snapshot: sourceVersion.snapshot,
      crdtState: sourceVersion.crdtState,
      source: 'merge',
      createdById: mergedById,
      createdByType: mergedByType,
      skipDuplicateCheck: true,
    });

    mergedVersions.push({
      documentId: change.documentId,
      documentVersionId: newVersion.id,
    });
  }

  return mergedVersions;
}

