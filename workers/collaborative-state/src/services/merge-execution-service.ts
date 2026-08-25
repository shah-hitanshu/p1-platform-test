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

import { getLogger } from '@pantheon-systems/p1-telemetry';
import { detectConflicts } from './conflict-detection-service';
import type { ConflictDetectionResult } from './conflict-detection-service';
import { getPathChangesSince } from './path-change-service';
import type { PathChange } from './path-change-service';
import { resolveAllConflicts } from './conflict-resolution-service';
import {
  getMergeRequest,
  updateMergeRequestStatus,
  updateMergeRequestConflicts,
} from './merge-request-service';
import { computeDocumentDiffs } from './document-diff-service';
import type { DocumentDiff } from './document-diff-service';
import type { MergeRequest } from '../types';
import {
  createDocumentVersion,
  getDocumentVersion,
  getLatestDocumentVersion,
} from './document-version-service';
import { createCheckpoint } from './checkpoint-service';
import { getMainBranch } from './branch-service';
import {
  assertPathFreeOnBranch,
  upsertBranchDocumentPaths,
  type PlannedMove,
} from './branch-document-service';
import { TEMPLATE_RELATION_INNER_JOIN, branchInheritsFromMain } from './document-queries';
import { publishMergedVersions } from './merge-publish';
import { query } from '../db';
import {
  triggerMigration,
  processMigration,
} from './migration-service';
import {
  MergeNotAllowedError,
  MergeConflictsError,
  MergeExecutionError,
  MergeRequestNotFoundError,
} from './errors';

// =============================================================================
// System-managed path exclusion
// =============================================================================

/**
 * Path prefixes whose contents are owned by Pantheon core code, not the user's
 * site. Documents under these prefixes are unconditionally excluded from
 * preview, merge writes, and merge checkpoints — regardless of any caller-
 * provided excludePathPrefixes. The result of merging or auto-publishing
 * such documents would be meaningless because the source of truth lives in
 * code, not in any branch.
 *
 * NOTE: This intentionally does NOT include other underscore-prefixed paths
 * such as `_translations/`, `_structure/` or `_redirects/` — those are user
 * content and must continue to merge normally. Redirects in particular were
 * once stored under `_registry/`, where this exclusion silently kept them off
 * the main branch a live site resolves against; don't move them back.
 *
 * EXCEPTION: `_registry/templates/` documents are user-authored content types
 * and must merge normally to support cross-branch template propagation
 * (PROPOSAL-010, CUJ-13).
 */
const SYSTEM_MANAGED_PATH_PREFIXES: readonly string[] = ['_registry/'];

/**
 * True when `path` is owned by Pantheon core code and must be excluded
 * from any merge-related operation.
 *
 * Exception: `_registry/templates/` paths are user-authored content type
 * definitions and are allowed through merges.
 */
function isSystemManagedPath(path: string): boolean {
  if (path.startsWith('_registry/templates/')) {
    return false;
  }
  return SYSTEM_MANAGED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Strip system-managed paths from a `ConflictDetectionResult`. Returns a new
 * result; never mutates the input. Applied at the entry of every merge code
 * path so downstream logic can ignore the exclusion entirely.
 */
export function applySystemManagedExclusions(
  detectionResult: ConflictDetectionResult,
): ConflictDetectionResult {
  return {
    ...detectionResult,
    conflicts: {
      ...detectionResult.conflicts,
      documentConflicts: detectionResult.conflicts.documentConflicts.filter(
        (c) => !isSystemManagedPath(c.documentPath),
      ),
    },
    sourceChanges: detectionResult.sourceChanges.filter(
      (c) => !isSystemManagedPath(c.documentPath),
    ),
    targetChanges: detectionResult.targetChanges.filter(
      (c) => !isSystemManagedPath(c.documentPath),
    ),
    // hasConflicts is intentionally recomputed against the filtered list so
    // a merge with only _registry conflicts proceeds normally.
    hasConflicts:
      detectionResult.conflicts.documentConflicts.filter(
        (c) => !isSystemManagedPath(c.documentPath),
      ).length > 0 || detectionResult.conflicts.structureConflicts.length > 0,
  };
}

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
  /** Id of the auto-publish checkpoint, when target was main and publish succeeded. */
  publishCheckpointId?: string;
  /** Auto-publish error message, when target was main and publish failed (merge itself stays committed). */
  publishError?: string;
  /**
   * Document IDs that were auto-published as part of this merge. Set only
   * when the target was main and publish was attempted (regardless of
   * success). The route layer uses this to fire DO /reload notifications.
   */
  publishedDocumentIds?: string[];
}

/**
 * Per-document resolution instruction.
 */
export interface DocumentResolution {
  documentId: string;
  strategy: 'take-source' | 'take-target' | 'manual';
  /** Required when strategy is 'manual'. The client-provided merged snapshot. */
  resolvedSnapshot?: Record<string, unknown>;
}

/**
 * Parameters for executing a merge with conflict resolution.
 */
export interface ExecuteMergeWithResolutionParams {
  mergeRequestId: string;
  /** Default strategy applied to conflicts without a per-document resolution. */
  resolutionStrategy: 'take-source' | 'take-target';
  /** Optional per-document resolutions that override the default strategy. */
  resolutions?: DocumentResolution[];
  mergedById: string;
  mergedByType: 'user' | 'agent';
}

/**
 * Result of executing a merge with resolution.
 *
 * Inherits `publishCheckpointId` / `publishError` from ExecuteMergeResult.
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
  /**
   * When provided, excludes documents whose path starts with any of the
   * given prefixes from the response (conflicts, changes, and diffs).
   */
  excludePathPrefixes?: string[];
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
   * Documents whose effective path differs between source and target branches.
   * Empty when no moves have been made on the source branch.
   */
  pathChanges: PathChange[];
  /**
   * Document diffs with snapshots and operations.
   * Only included when options.includeContent is true.
   */
  documentDiffs?: DocumentDiff[];
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
  const rawDetectionResult = await detectConflicts(
    mergeRequest.sourceBranchId,
    mergeRequest.targetBranchId,
  );
  // Strip system-managed paths (e.g. _registry/) before any merge logic runs.
  const detectionResult = applySystemManagedExclusions(rawDetectionResult);

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

  // 4b. Check path promotions before any write, so an occupied destination
  // fails the merge cleanly instead of part-way through.
  const pathPromotion = await planPathOverridePromotion(
    mergeRequest.sourceBranchId,
    mergeRequest.targetBranchId,
    mergeRequest.siteId,
  );

  // 5. Copy source changes to target branch
  const copiedVersions = await copySourceChangesToTarget(
    mergeRequest,
    detectionResult,
    mergedById,
    mergedByType,
  );

  // 5b. Promote source-branch path overrides to the target branch.
  await applyPathOverridePromotion(pathPromotion);

  // 6. Create post-merge checkpoint with only merge-touched documents
  const checkpointResult = await createCheckpoint({
    branchId: mergeRequest.targetBranchId,
    name: `Merge: ${mergeRequest.title}`,
    checkpointType: 'post_merge',
    createdById: mergedById,
    createdByType: mergedByType,
    documentVersionIds: copiedVersions.map((v) => ({
      documentId: v.documentId,
      documentVersionId: v.documentVersionId,
    })),
  });

  // 7. Update merge request status to merged
  await updateMergeRequestStatus(mergeRequestId, 'merged', {
    mergedById,
    mergedByType,
  });

  // 8. Auto-publish: when merging into main, mark merged versions as published.
  const publishOutcome = await autoPublishIfTargetIsMain(
    mergeRequest,
    copiedVersions,
    mergedById,
    mergedByType,
  );

  // 9. Post-merge template migration: if template documents were merged,
  // trigger migration for affected documents on the target branch.
  // Best-effort: each template is individually try/caught inside the helper,
  // so failures are logged but never roll back the merge.
  await triggerPostMergeTemplateMigrations(
    mergeRequest,
    detectionResult,
    mergedById,
    mergedByType,
  );

  return {
    success: true,
    mergeRequestId,
    checkpointId: checkpointResult.checkpoint.id,
    documentsUpdated: copiedVersions.length,
    ...(publishOutcome.checkpointId !== undefined
      ? { publishCheckpointId: publishOutcome.checkpointId }
      : {}),
    ...(publishOutcome.error !== undefined
      ? { publishError: publishOutcome.error }
      : {}),
    ...(publishOutcome.documentIds !== undefined
      ? { publishedDocumentIds: publishOutcome.documentIds }
      : {}),
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
  const rawDetectionResult = await detectConflicts(
    mergeRequest.sourceBranchId,
    mergeRequest.targetBranchId,
  );
  // Strip system-managed paths (e.g. _registry/) before any merge logic runs.
  const detectionResult = applySystemManagedExclusions(rawDetectionResult);

  // 3b. Check path promotions before any write, so an occupied destination
  // fails the merge cleanly instead of part-way through.
  const pathPromotion = await planPathOverridePromotion(
    mergeRequest.sourceBranchId,
    mergeRequest.targetBranchId,
    mergeRequest.siteId,
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

      // Capture pre-existing latest target version BEFORE resolving — used
      // below to suppress no-op resolutions that produce no new version
      // (e.g. take-target, or take-source/manual where the snapshot equals
      // what's already on main). Without this, the post_merge / auto-publish
      // checkpoints inflate with pre-existing target versions.
      const preExistingLatest = await getLatestDocumentVersion(
        conflict.documentId,
        mergeRequest.targetBranchId,
      );

      // The conflict-detection target side runs with publishedOnly:true,
      // which returns the most-recently-CHECKPOINTED version (not always the
      // highest version_number). For take-target, the resolver returns this
      // exact id — which can be older than the current latest. We treat any
      // match against EITHER "latest by version_number" OR "latest target
      // change id" as a no-op.
      const isPreExistingTargetVersionId = (versionId: string): boolean =>
        preExistingLatest?.id === versionId ||
        targetChange?.latestVersionId === versionId;

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
          skipCompaction: true,
        });
        // No-op skip: the manual snapshot resolved to an existing target
        // version (typically via the unique-violation fallback in
        // createDocumentVersion). Don't pollute the checkpoint.
        if (!isPreExistingTargetVersionId(manualVersion.id)) {
          mergedDocVersions.push({
            documentId: conflict.documentId,
            documentVersionId: manualVersion.id,
            // No clean source-branch version: snapshot is client-provided.
            sourceVersionId: null,
          });
        }
        conflictsResolved++;
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
            // No-op skip: resolver returned a pre-existing target version
            // (always true for take-target; possible for take-source when
            // snapshots match). The check covers both "latest by version
            // number" and "latest by checkpoint" (publishedOnly view).
            if (isPreExistingTargetVersionId(res.resultVersionId)) {
              continue;
            }
            mergedDocVersions.push({
              documentId: res.documentId,
              documentVersionId: res.resultVersionId,
              // Provenance only when the resolution unambiguously points at
              // a source-branch version (take-source). For take-target the
              // result is the existing main-side version and no source
              // mapping applies.
              sourceVersionId:
                strategy === 'take-source'
                  ? sourceChange?.latestVersionId ?? null
                  : null,
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

  // 5b. Promote source-branch path overrides to the target branch.
  await applyPathOverridePromotion(pathPromotion);

  // 6. Create post-merge checkpoint with only merge-touched documents
  const checkpointResult = await createCheckpoint({
    branchId: mergeRequest.targetBranchId,
    name: `Merge: ${mergeRequest.title}`,
    checkpointType: 'post_merge',
    createdById: mergedById,
    createdByType: mergedByType,
    documentVersionIds: mergedDocVersions.map((v) => ({
      documentId: v.documentId,
      documentVersionId: v.documentVersionId,
    })),
  });

  // 7. Update merge request status
  await updateMergeRequestStatus(mergeRequestId, 'merged', {
    mergedById,
    mergedByType,
  });

  // 8. Auto-publish: when merging into main, mark merged versions as published.
  const publishOutcome = await autoPublishIfTargetIsMain(
    mergeRequest,
    mergedDocVersions,
    mergedById,
    mergedByType,
  );

  // 9. Post-merge template migration (best-effort, same as above)
  await triggerPostMergeTemplateMigrations(
    mergeRequest,
    detectionResult,
    mergedById,
    mergedByType,
  );

  return {
    success: true,
    mergeRequestId,
    checkpointId: checkpointResult.checkpoint.id,
    documentsUpdated: copiedVersions.length,
    conflictsResolved,
    ...(publishOutcome.checkpointId !== undefined
      ? { publishCheckpointId: publishOutcome.checkpointId }
      : {}),
    ...(publishOutcome.error !== undefined
      ? { publishError: publishOutcome.error }
      : {}),
    ...(publishOutcome.documentIds !== undefined
      ? { publishedDocumentIds: publishOutcome.documentIds }
      : {}),
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
  const [rawDetectionResult, rawPathChanges] = await Promise.all([
    detectConflicts(sourceBranchId, targetBranchId),
    getPathChangesSince(sourceBranchId, targetBranchId),
  ]);
  // Always strip system-managed paths (e.g. _registry/) — caller's
  // excludePathPrefixes is layered on top, never instead of this.
  const detectionResult = applySystemManagedExclusions(rawDetectionResult);

  // Apply caller-provided path prefix filtering on top of system exclusions.
  const excludePrefixes = options?.excludePathPrefixes;
  const shouldExclude = excludePrefixes != null && excludePrefixes.length > 0
    ? (path: string): boolean => excludePrefixes.some((prefix) => path.startsWith(prefix))
    : null;

  let { documentConflicts } = detectionResult.conflicts;
  let sourceChanges = detectionResult.sourceChanges;
  let targetChanges = detectionResult.targetChanges;
  let pathChanges = rawPathChanges;

  if (shouldExclude != null) {
    documentConflicts = documentConflicts.filter((c) => !shouldExclude(c.documentPath));
    sourceChanges = sourceChanges.filter((c) => !shouldExclude(c.documentPath));
    targetChanges = targetChanges.filter((c) => !shouldExclude(c.documentPath));
    pathChanges = pathChanges.filter((c) => !shouldExclude(c.documentPath));
  }

  const filteredConflicts = shouldExclude != null
    ? { ...detectionResult.conflicts, documentConflicts }
    : detectionResult.conflicts;

  const preview: MergePreview = {
    canMerge: !detectionResult.hasConflicts,
    hasConflicts: detectionResult.hasConflicts,
    conflicts: filteredConflicts,
    sourceChanges,
    targetChanges,
    mergeBase: detectionResult.mergeBase,
    pathChanges,
  };

  // Include document diffs if requested
  if (options?.includeContent === true) {
    preview.documentDiffs = await computeDocumentDiffs(
      documentConflicts,
      sourceChanges,
      targetChanges,
      sourceBranchId,
      targetBranchId,
    );
  }

  return preview;
}

// =============================================================================
// Helper Functions
// =============================================================================

/** The source branch's path overrides, checked against the target and ready to write. */
export interface PathOverridePromotion {
  targetIsMain: boolean;
  targetBranchId: string;
  moves: PlannedMove[];
}

/**
 * Reads the source branch's path overrides and verifies every destination is
 * still free on the target.
 *
 * A merge is a sequence of writes, not one transaction, so a path taken on the
 * target while the branch was in flight has to fail here — before anything is
 * written — rather than tripping the unique constraint after versions are
 * copied and leaving a half-applied merge behind.
 *
 * @throws DuplicateDocumentPathError if a destination path is occupied on the target
 */
export async function planPathOverridePromotion(
  sourceBranchId: string,
  targetBranchId: string,
  siteId: string,
): Promise<PathOverridePromotion | null> {
  const overrides = await query<{ document_id: string; path: string }>(
    'SELECT document_id, path FROM app.branch_document_paths WHERE branch_id = $1',
    [sourceBranchId],
  );

  if (overrides.rows.length === 0) return null;

  const moves: PlannedMove[] = overrides.rows.map((row) => ({
    documentId: row.document_id,
    newPath: row.path,
  }));

  await assertPathFreeOnBranch(
    targetBranchId,
    siteId,
    moves.map((move) => move.documentId),
    moves.map((move) => move.newPath),
  );

  const mainBranch = await getMainBranch(siteId);

  return { targetIsMain: targetBranchId === mainBranch?.id, targetBranchId, moves };
}

/**
 * Applies the planned path overrides to the target branch.
 *
 * When merging into main the override becomes the global path in app.documents.
 * When merging into a workstream branch the override is upserted for that branch.
 * Path moves are a separate channel from content changes and are always promoted
 * regardless of whether the document's content was also modified in this merge.
 */
export async function applyPathOverridePromotion(
  promotion: PathOverridePromotion | null,
): Promise<void> {
  if (promotion === null) return;
  const { moves, targetIsMain, targetBranchId } = promotion;

  if (!targetIsMain) {
    await upsertBranchDocumentPaths(targetBranchId, moves);
    return;
  }

  await query(
    `UPDATE app.documents d
     SET path = m.path
     FROM unnest($1::uuid[], $2::text[]) AS m(document_id, path)
     WHERE d.id = m.document_id`,
    [moves.map((move) => move.documentId), moves.map((move) => move.newPath)],
  );
}

/**
 * A document version created or referenced during a merge.
 *
 * `sourceVersionId` is the source-branch version this main-side version came
 * from, when one is unambiguously identifiable. It's `null` for resolutions
 * where there is no clean source (take-target, manual). Used by the
 * auto-publish helper to set publish provenance.
 */
interface MergedDocumentVersion {
  documentId: string;
  documentVersionId: string;
  sourceVersionId: string | null;
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
    if (change.latestVersionId === null) {
      continue;
    }
    const sourceVersion = await getDocumentVersion(change.latestVersionId);
    if (sourceVersion === null) {
      continue;
    }

    // Capture the pre-existing latest version on the target BEFORE creating
    // the new merge version. If createDocumentVersion's unique-violation
    // fallback ends up returning this same id, no real new version was
    // created and we must not push it into mergedVersions — otherwise the
    // post_merge / auto-publish checkpoints would contain references to
    // pre-existing target-branch versions that weren't actually changed by
    // this merge (observed in production: a merge with 1 real new doc
    // showed 32 docs in its post_merge checkpoint).
    const preExistingLatest = await getLatestDocumentVersion(
      change.documentId,
      mergeRequest.targetBranchId,
    );

    // Create version on target branch
    // Always create for merge operations — the source='merge' marker matters for history.
    const newVersion = await createDocumentVersion({
      documentId: change.documentId,
      branchId: mergeRequest.targetBranchId,
      snapshot: sourceVersion.snapshot ?? {},
      source: 'merge',
      createdById: mergedById,
      createdByType: mergedByType,
      skipDuplicateCheck: true,
      skipCompaction: true,
      isTombstone: sourceVersion.isTombstone,
      // Insert-time provenance [PCC-3737]: the merge job runner's write-level
      // idempotency probe reads this; stamping it here too means versions
      // created by the inline path are equally resumable by a later job.
      sourceVersionId: change.latestVersionId,
    });

    // No-op skip: createDocumentVersion returned the pre-existing target
    // version (typically via the unique-violation fallback). Nothing was
    // actually merged for this document — exclude from downstream
    // checkpoints.
    if (preExistingLatest?.id === newVersion.id) {
      continue;
    }

    mergedVersions.push({
      documentId: change.documentId,
      documentVersionId: newVersion.id,
      sourceVersionId: change.latestVersionId,
    });
  }

  return mergedVersions;
}

/**
 * Outcome of the auto-publish step.
 *
 * `checkpointId` is set when the publish step ran AND succeeded.
 * `error` is set when the publish step ran AND failed (the merge itself
 *   stays committed; the failure is surfaced on the merge response).
 * `documentIds` is set whenever publish was attempted (target was main),
 *   regardless of success — the route layer uses it for DO /reload.
 * All three undefined means the target was not main and no publish was attempted.
 */
interface AutoPublishOutcome {
  checkpointId?: string;
  error?: string;
  documentIds?: string[];
}

/**
 * If the merge target is the main branch, mark the merge-created versions
 * as published via publishMergedVersions(). Otherwise this is a no-op.
 *
 * Failures are caught and surfaced via the returned outcome — they do NOT
 * roll back the merge itself, since the merge has already been committed
 * (post_merge checkpoint + status transition). This matches the user-facing
 * contract: a successful merge with a failed publish is reported as a
 * successful merge with a publish error attached.
 */
async function autoPublishIfTargetIsMain(
  mergeRequest: MergeRequest,
  mergedVersions: MergedDocumentVersion[],
  mergedById: string,
  mergedByType: 'user' | 'agent',
): Promise<AutoPublishOutcome> {
  const mainBranch = await getMainBranch(mergeRequest.siteId);
  if (mergeRequest.targetBranchId !== mainBranch?.id) {
    return {};
  }

  if (mergedVersions.length === 0) {
    return {};
  }

  const documentIds = mergedVersions.map((v) => v.documentId);

  try {
    const result = await publishMergedVersions({
      siteId: mergeRequest.siteId,
      mainBranchId: mainBranch.id,
      sourceBranchId: mergeRequest.sourceBranchId,
      mergedVersions,
      mergedById,
      mergedByType,
      mergeTitle: mergeRequest.title,
    });
    return {
      documentIds,
      ...(result.checkpointId !== undefined
        ? { checkpointId: result.checkpointId }
        : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Auto-publish-on-merge failed for merge request ${mergeRequest.id}:`,
      error,
    );
    return { documentIds, error: `Auto-publish failed: ${message}` };
  }
}

/**
 * After a merge, detect if any template documents were merged and trigger
 * migration for documents on the target branch that reference those templates
 * with a stale template_version.
 *
 * Best-effort: failures are logged but do not roll back the merge.
 */
const POST_MERGE_MIGRATION_TIMEOUT_MS = 10_000;

// Count pages still deriving from an older template version, which a template
// bump leaves stale and needing migration. On a branch that inherits the edge
// from main, resolve each page's synced version through its per-branch override.
async function getStaleTemplateCountByBranch(
  templateId: string,
  targetVersion: number,
  branchId: string,
  inheritsFromMain: boolean,
): Promise<number> {
  const [sql, params]: [string, unknown[]] = inheritsFromMain
    ? [
      `SELECT COUNT(*) as count FROM app.documents d
       ${TEMPLATE_RELATION_INNER_JOIN}
       LEFT JOIN app.document_relation_branch_sync brs
         ON brs.source_document_id = d.id AND brs.relation_type = 'template' AND brs.branch_id = $3
       WHERE dr.target_document_id = $1
         AND COALESCE(brs.synced_version, dr.synced_version) < $2
         AND d.archived_at IS NULL`,
      [templateId, targetVersion, branchId],
    ]
    : [
      `SELECT COUNT(*) as count FROM app.documents d
       ${TEMPLATE_RELATION_INNER_JOIN}
       WHERE dr.target_document_id = $1 AND dr.synced_version < $2 AND d.archived_at IS NULL`,
      [templateId, targetVersion],
    ];

  const result = await query<{ count: string }>(sql, params);
  const row = result.rows[0];
  if (!row) return 0;
  return parseInt(row.count, 10);
}

async function triggerPostMergeTemplateMigrations(
  mergeRequest: MergeRequest,
  detectionResult: ConflictDetectionResult,
  mergedById: string,
  mergedByType: 'user' | 'agent',
): Promise<void> {
  const mergedTemplates = detectionResult.sourceChanges.filter(
    (c) => c.documentPath.startsWith('_registry/templates/'),
  );

  if (mergedTemplates.length === 0) {
    return;
  }

  await runPostMergeTemplateMigrations({
    siteId: mergeRequest.siteId,
    targetBranchId: mergeRequest.targetBranchId,
    templateDocumentIds: mergedTemplates.map((c) => c.documentId),
    mergedById,
    mergedByType,
    // Time-box each migration so a large stale set doesn't block the merge
    // response. If it times out, the job stays 'in_progress' and can be retried.
    timeoutMs: POST_MERGE_MIGRATION_TIMEOUT_MS,
  });
}

/**
 * Migrate stale pages after template documents landed on the target branch.
 * Best-effort per template: failures are logged and never thrown.
 *
 * Extracted so the merge job runner can drive it from its ledger (template
 * document ids by path prefix) in a finalize step, where no request deadline
 * applies — `timeoutMs` undefined means no per-template time-box [PCC-3737].
 */
export async function runPostMergeTemplateMigrations(params: {
  siteId: string;
  targetBranchId: string;
  templateDocumentIds: string[];
  mergedById: string;
  mergedByType: 'user' | 'agent';
  timeoutMs?: number;
}): Promise<void> {
  const { siteId, targetBranchId, templateDocumentIds, mergedById, mergedByType, timeoutMs } = params;

  if (templateDocumentIds.length === 0) {
    return;
  }

  // Merging into a non-main branch migrates through that branch's sync override
  // rather than the shared edge; resolve main so the migration can target it.
  const mainBranch = await getMainBranch(siteId);
  const mainBranchId = mainBranch?.id;
  const inheritsFromMain = branchInheritsFromMain(targetBranchId, mainBranchId);

  for (const templateDocumentId of templateDocumentIds) {
    try {
      const latestVersion = await getLatestDocumentVersion(
        templateDocumentId,
        targetBranchId,
      );
      if (latestVersion === null) {
        continue;
      }

      const staleCount = await getStaleTemplateCountByBranch(
        templateDocumentId,
        latestVersion.versionNumber,
        targetBranchId,
        inheritsFromMain,
      );
      if (staleCount === 0) {
        continue;
      }

      const fromVersion = Math.max(latestVersion.versionNumber - 1, 0);
      const job = await triggerMigration(
        siteId,
        targetBranchId,
        templateDocumentId,
        fromVersion,
        latestVersion.versionNumber,
        { id: mergedById, type: mergedByType },
        mainBranchId,
      );

      const migration = processMigration(job.id, undefined, mainBranchId);
      if (timeoutMs !== undefined) {
        await Promise.race([
          migration,
          new Promise<never>((_, reject) => {
            setTimeout(() => { reject(new Error('Post-merge migration timed out')); }, timeoutMs);
          }),
        ]);
      } else {
        await migration;
      }

      getLogger().info('post-merge template migration completed', {
        template_id: templateDocumentId,
        migrated_count: staleCount,
      });
    } catch (error) {
      getLogger().error('post-merge template migration failed', error, {
        template_id: templateDocumentId,
      });
    }
  }
}

