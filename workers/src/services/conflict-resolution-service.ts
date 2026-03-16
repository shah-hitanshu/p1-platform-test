/**
 * Phase 5.2b: Conflict Resolution Service
 *
 * Resolves document conflicts using take-source and take-target strategies.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Merge Operations"
 */

import type { ConflictResolutionStrategy, DocumentConflict } from '../types';
import { query } from '../db';
import {
  getDocumentVersion,
  createDocumentVersion,
} from './document-version-service';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for resolving a single conflict.
 */
export interface ResolveConflictParams {
  documentId: string;
  sourceBranchId: string;
  targetBranchId: string;
  sourceVersionId: string;
  targetVersionId: string;
  strategy: ConflictResolutionStrategy;
  resolvedById: string;
  resolvedByType: 'user' | 'agent';
  /** Required when strategy is 'manual'. The client-provided merged snapshot. */
  resolvedSnapshot?: Record<string, unknown>;
}

/**
 * Result of resolving a single conflict.
 */
export interface ConflictResolutionResult {
  resolved: boolean;
  documentId: string;
  strategy: ConflictResolutionStrategy;
  resultVersionId?: string;
  resolvedById: string;
  resolvedByType: 'user' | 'agent';
  error?: string;
}

/**
 * Conflict with version IDs for resolution.
 */
export interface ConflictWithVersions extends Omit<DocumentConflict, 'sourceVersion' | 'targetVersion' | 'baseVersion'> {
  sourceVersionId: string;
  targetVersionId: string;
}

/**
 * Parameters for resolving all conflicts in a merge.
 */
export interface ResolveAllConflictsParams {
  conflicts: ConflictWithVersions[];
  sourceBranchId: string;
  targetBranchId: string;
  strategy: ConflictResolutionStrategy;
  resolvedById: string;
  resolvedByType: 'user' | 'agent';
}

/**
 * Result of resolving all conflicts.
 */
export interface ResolveAllConflictsResult {
  resolvedCount: number;
  failedCount: number;
  resolutions: ConflictResolutionResult[];
}

/**
 * Parameters for resolving a deletion conflict.
 */
export interface ResolveDeletedConflictParams {
  documentId: string;
  targetBranchId: string;
  sourceBranchId?: string;
  sourceVersionId?: string;
  conflictType: 'deleted-in-source' | 'deleted-in-target';
  strategy: 'take-source' | 'take-target';
  resolvedById: string;
  resolvedByType: 'user' | 'agent';
}

/**
 * Result of resolving a deletion conflict.
 */
export interface DeletedConflictResolutionResult {
  resolved: boolean;
  action: 'deleted' | 'kept' | 'restored' | 'kept-deleted';
  documentId: string;
  resultVersionId?: string;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when the specified version does not exist.
 */
export class VersionNotFoundError extends Error {
  public readonly name = 'VersionNotFoundError';

  constructor(public readonly versionId: string) {
    super(`Document version with ID "${versionId}" not found.`);
    Object.setPrototypeOf(this, VersionNotFoundError.prototype);
  }
}

/**
 * Error thrown when an unsupported resolution strategy is used.
 */
export class UnsupportedStrategyError extends Error {
  public readonly name = 'UnsupportedStrategyError';

  constructor(public readonly strategy: string) {
    super(`Conflict resolution strategy "${strategy}" is not supported by this service.`);
    Object.setPrototypeOf(this, UnsupportedStrategyError.prototype);
  }
}

/**
 * Error thrown when manual resolution is requested without a resolvedSnapshot.
 */
export class ManualResolutionError extends Error {
  public readonly name = 'ManualResolutionError';

  constructor() {
    super('Manual resolution strategy requires a resolvedSnapshot.');
    Object.setPrototypeOf(this, ManualResolutionError.prototype);
  }
}

// =============================================================================
// Conflict Resolution Functions
// =============================================================================

/**
 * Resolve a single document conflict using the specified strategy.
 *
 * - take-source: Copy source version's snapshot to target branch
 * - take-target: Keep target version unchanged
 * - merge-crdt: Not supported here (use Phase 5.2c)
 * - manual: Not supported (requires manual intervention)
 */
export async function resolveConflict(
  params: ResolveConflictParams,
): Promise<ConflictResolutionResult> {
  const { strategy } = params;

  // Validate strategy - reject unsupported strategies
  if (strategy === 'merge-crdt') {
    throw new UnsupportedStrategyError('merge-crdt');
  }

  // Handle manual strategy
  if (strategy === 'manual') {
    return resolveWithManual(params);
  }

  // Handle supported strategies
  if (strategy === 'take-source') {
    return resolveWithTakeSource(params);
  }

  // strategy === 'take-target'
  return resolveWithTakeTarget(params);
}

/**
 * Resolve conflict by taking the source version.
 * Creates a new version on the target branch with source's snapshot.
 */
async function resolveWithTakeSource(
  params: ResolveConflictParams,
): Promise<ConflictResolutionResult> {
  const {
    documentId,
    sourceVersionId,
    targetBranchId,
    resolvedById,
    resolvedByType,
  } = params;

  // Get source version
  const sourceVersion = await getDocumentVersion(sourceVersionId);
  if (sourceVersion === null) {
    throw new VersionNotFoundError(sourceVersionId);
  }

  // Create new version on target branch with source's snapshot
  const newVersion = await createDocumentVersion({
    documentId,
    branchId: targetBranchId,
    snapshot: sourceVersion.snapshot,
    source: 'merge',
    createdById: resolvedById,
    createdByType: resolvedByType,
    isTombstone: sourceVersion.isTombstone,
  });

  return {
    resolved: true,
    documentId,
    strategy: 'take-source',
    resultVersionId: newVersion.id,
    resolvedById,
    resolvedByType,
  };
}

/**
 * Resolve conflict by taking the target version.
 * No new version is created - we keep the existing target version.
 */
async function resolveWithTakeTarget(
  params: ResolveConflictParams,
): Promise<ConflictResolutionResult> {
  const {
    documentId,
    targetVersionId,
    resolvedById,
    resolvedByType,
  } = params;

  // Verify target version exists
  const targetVersion = await getDocumentVersion(targetVersionId);
  if (targetVersion === null) {
    throw new VersionNotFoundError(targetVersionId);
  }

  // For take-target, we keep the existing version as-is
  return {
    resolved: true,
    documentId,
    strategy: 'take-target',
    resultVersionId: targetVersionId,
    resolvedById,
    resolvedByType,
  };
}

/**
 * Resolve conflict by using a client-provided merged snapshot.
 * Creates a new version on the target branch with the provided snapshot.
 *
 * @param params - Resolution parameters; `resolvedSnapshot` is required for this strategy.
 * @returns The resolution result containing the new version ID.
 * @throws {ManualResolutionError} If `resolvedSnapshot` is not provided.
 */
async function resolveWithManual(
  params: ResolveConflictParams,
): Promise<ConflictResolutionResult> {
  const {
    documentId,
    targetBranchId,
    resolvedById,
    resolvedByType,
    resolvedSnapshot,
  } = params;

  if (resolvedSnapshot === undefined) {
    throw new ManualResolutionError();
  }

  // Create new version on target branch with the provided snapshot
  const newVersion = await createDocumentVersion({
    documentId,
    branchId: targetBranchId,
    snapshot: resolvedSnapshot,
    source: 'merge',
    createdById: resolvedById,
    createdByType: resolvedByType,
  });

  return {
    resolved: true,
    documentId,
    strategy: 'manual',
    resultVersionId: newVersion.id,
    resolvedById,
    resolvedByType,
  };
}

/**
 * Resolve all conflicts in a merge using the same strategy.
 * Continues processing even if individual resolutions fail.
 */
export async function resolveAllConflicts(
  params: ResolveAllConflictsParams,
): Promise<ResolveAllConflictsResult> {
  const {
    conflicts,
    sourceBranchId,
    targetBranchId,
    strategy,
    resolvedById,
    resolvedByType,
  } = params;

  const resolutions: ConflictResolutionResult[] = [];
  let resolvedCount = 0;
  let failedCount = 0;

  for (const conflict of conflicts) {
    try {
      const result = await resolveConflict({
        documentId: conflict.documentId,
        sourceBranchId,
        targetBranchId,
        sourceVersionId: conflict.sourceVersionId,
        targetVersionId: conflict.targetVersionId,
        strategy,
        resolvedById,
        resolvedByType,
      });

      resolutions.push(result);
      resolvedCount++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      resolutions.push({
        resolved: false,
        documentId: conflict.documentId,
        strategy,
        resolvedById,
        resolvedByType,
        error: errorMessage,
      });
      failedCount++;
    }
  }

  return {
    resolvedCount,
    failedCount,
    resolutions,
  };
}

/**
 * Resolve a conflict involving document deletion.
 *
 * Deletion conflict scenarios:
 * - deleted-in-source + take-source: Delete on target
 * - deleted-in-source + take-target: Keep target version
 * - deleted-in-target + take-source: Restore from source
 * - deleted-in-target + take-target: Keep deleted
 */
export async function resolveDeletedConflict(
  params: ResolveDeletedConflictParams,
): Promise<DeletedConflictResolutionResult> {
  const {
    documentId,
    targetBranchId,
    sourceBranchId,
    sourceVersionId,
    conflictType,
    strategy,
    resolvedById,
    resolvedByType,
  } = params;

  if (conflictType === 'deleted-in-source') {
    if (strategy === 'take-source') {
      // Delete on target - create a deletion marker
      // In this system, we mark deletion by creating a version with null/empty snapshot
      // or by using a soft-delete flag
      await query(
        `INSERT INTO app.document_deletions (document_id, branch_id, deleted_by_id, deleted_by_type)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [documentId, targetBranchId, resolvedById, resolvedByType],
      );

      return {
        resolved: true,
        action: 'deleted',
        documentId,
      };
    } else {
      // take-target: Keep the target version as-is
      return {
        resolved: true,
        action: 'kept',
        documentId,
      };
    }
  }

  // conflictType === 'deleted-in-target'
  if (strategy === 'take-source') {
    // Restore from source - create new version on target with source content
    if (sourceVersionId === undefined || sourceBranchId === undefined) {
      throw new VersionNotFoundError('source-version-required');
    }

    const sourceVersion = await getDocumentVersion(sourceVersionId);
    if (sourceVersion === null) {
      throw new VersionNotFoundError(sourceVersionId);
    }

    const newVersion = await createDocumentVersion({
      documentId,
      branchId: targetBranchId,
      snapshot: sourceVersion.snapshot,
      source: 'merge',
      createdById: resolvedById,
      createdByType: resolvedByType,
      isTombstone: sourceVersion.isTombstone,
    });

    return {
      resolved: true,
      action: 'restored',
      documentId,
      resultVersionId: newVersion.id,
    };
  }

  // strategy === 'take-target': Keep deleted state
  return {
    resolved: true,
    action: 'kept-deleted',
    documentId,
  };
}
