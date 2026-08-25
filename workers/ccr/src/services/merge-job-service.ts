/**
 * Merge Job Service [PCC-3737]
 *
 * The Postgres job ledger behind the merge job runner
 * (docs/merge-job-runner-architecture-2026-08-21.md). One `merge_jobs` row per
 * execution attempt; `merge_job_documents` is the frozen work list and the
 * idempotency core. These functions are the workflow's step bodies — plain
 * service functions over the ambient request-scoped connection, so they unit
 * test with the existing harness and the WorkflowEntrypoint stays a thin shell.
 *
 * Idempotency is two-layer (design §5):
 *  - Layer 1, the ledger: done/skipped_noop/failed rows are never re-visited,
 *    so any resume costs one indexed SELECT instead of a re-walk.
 *  - Layer 2, the write-level probe: before inserting a copy row's version,
 *    check whether the latest target-branch version is already `source='merge'`
 *    from this row's planned source version. That closes the crash window
 *    between a version INSERT committing and the ledger row flipping to done,
 *    and makes a fresh job after a failed one resume without duplicates.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import { query } from '../db';
import type { ConflictResolutionStrategy } from '../types';
import {
  createDocumentVersion,
  getDocumentVersion,
  getLatestDocumentVersion,
} from './document-version-service';
import { detectConflicts } from './conflict-detection-service';
import { resolveAllConflicts } from './conflict-resolution-service';
import { createCheckpoint } from './checkpoint-service';
import { publishMergedVersions } from './merge-publish';
import {
  getMergeRequest,
  updateMergeRequestStatus,
  updateMergeRequestConflicts,
  restoreMergeRequestClaim,
  markMergeRequestConflictedFromMerging,
} from './merge-request-service';
import { isUniqueConstraintViolation } from './document-types';
import { isConnectionError } from '../db';
import {
  applySystemManagedExclusions,
  planPathOverridePromotion,
  applyPathOverridePromotion,
  runPostMergeTemplateMigrations,
} from './merge-execution-service';
import type { DocumentResolution } from './merge-execution-service';
import { getMainBranch } from './branch-service';
import {
  MergeExecutionError,
  MergeJobNotFoundError,
  ActiveMergeJobExistsError,
} from './errors';
import type {
  MergeJob,
  MergeJobRow,
  MergeJobDocumentRow,
  MergeJobProjection,
  MergeJobStatus,
  CreateMergeJobParams,
  PlanOutcome,
  ApplyChunkResult,
  FinalizeCheckpointResult,
  FinalizePublishResult,
} from './merge-job-types';
import {
  rowToMergeJob,
  ACTIVE_MERGE_JOB_STATUSES,
} from './merge-job-types';

// Everything callers need travels through this module, so the split between
// model (merge-job-types) and queries (here) stays invisible to them.
export * from './merge-job-types';
export { MergeJobNotFoundError, ActiveMergeJobExistsError } from './errors';
export {
  claimMergeRequestForExecution,
  restoreMergeRequestClaim,
} from './merge-request-service';

// =============================================================================
// Job CRUD
// =============================================================================



export async function createMergeJob(params: CreateMergeJobParams): Promise<MergeJob> {
  try {
    const result = await query<MergeJobRow>(
      `INSERT INTO app.merge_jobs (
         id, merge_request_id, site_id, source_branch_id, target_branch_id,
         prior_mr_status, resolution_strategy, resolutions,
         triggered_by_id, triggered_by_type
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        params.jobId,
        params.mergeRequestId ?? null,
        params.siteId,
        params.sourceBranchId,
        params.targetBranchId,
        params.priorMrStatus ?? null,
        params.resolutionStrategy ?? null,
        params.resolutions !== undefined ? JSON.stringify(params.resolutions) : null,
        params.triggeredById,
        params.triggeredByType,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new MergeExecutionError(params.mergeRequestId ?? params.jobId, 'merge job insert returned no row');
    }
    return rowToMergeJob(row);
  } catch (error) {
    // Postgres SQLSTATE 23505 (unique_violation): the INSERT collided with the
    // partial indexes allowing at most one ACTIVE job per MR / branch pair.
    // INSERT-and-catch is the atomic form of this claim; check-then-insert races.
    if (isUniqueConstraintViolation(error)) {
      const active = await findActiveMergeJob(params);
      throw new ActiveMergeJobExistsError(active?.id ?? null);
    }
    throw error;
  }
}

export async function findActiveMergeJob(params: {
  mergeRequestId?: string;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
}): Promise<MergeJob | null> {
  const statuses = [...ACTIVE_MERGE_JOB_STATUSES];
  const result =
    params.mergeRequestId !== undefined
      ? await query<MergeJobRow>(
        'SELECT * FROM app.merge_jobs WHERE merge_request_id = $1 AND status = ANY($2) LIMIT 1',
        [params.mergeRequestId, statuses],
      )
      : await query<MergeJobRow>(
        `SELECT * FROM app.merge_jobs
         WHERE merge_request_id IS NULL
           AND site_id = $1 AND source_branch_id = $2 AND target_branch_id = $3
           AND status = ANY($4)
         LIMIT 1`,
        [params.siteId, params.sourceBranchId, params.targetBranchId, statuses],
      );
  const row = result.rows[0];
  return row ? rowToMergeJob(row) : null;
}

export async function getMergeJob(jobId: string): Promise<MergeJob | null> {
  const result = await query<MergeJobRow>(
    'SELECT * FROM app.merge_jobs WHERE id = $1',
    [jobId],
  );
  const row = result.rows[0];
  return row ? rowToMergeJob(row) : null;
}

async function requireMergeJob(jobId: string): Promise<MergeJob> {
  const job = await getMergeJob(jobId);
  if (job === null) {
    throw new MergeJobNotFoundError(jobId);
  }
  return job;
}

export async function getMergeJobProjection(
  jobId: string,
  siteId: string,
): Promise<MergeJobProjection | null> {
  const job = await getMergeJob(jobId);
  if (job === null) {
    return null;
  }
  if (job.siteId !== siteId) {
    return null;
  }
  const failed = await query<{ document_id: string; document_path: string; error: string | null }>(
    `SELECT document_id, document_path, error FROM app.merge_job_documents
     WHERE job_id = $1 AND status = 'failed' ORDER BY document_path`,
    [jobId],
  );
  return {
    ...job,
    failedDocumentDetails: failed.rows.map((r) => ({
      documentId: r.document_id,
      path: r.document_path,
      error: r.error,
    })),
  };
}

/**
 * Cooperative cancellation: the chunk loop checks the flag between chunks.
 * 'finalizing' is deliberately not cancellable — the copy work is complete
 * and nothing reads the flag past that point, so accepting the request would
 * falsely report a cancellation that cannot happen.
 */
export async function requestMergeJobCancel(jobId: string, siteId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `UPDATE app.merge_jobs SET cancel_requested = true
     WHERE id = $1 AND site_id = $2 AND status = ANY($3)
     RETURNING id`,
    [jobId, siteId, ['queued', 'planning', 'running']],
  );
  return result.rows.length > 0;
}

async function setJobStatus(jobId: string, status: MergeJobStatus): Promise<void> {
  await query('UPDATE app.merge_jobs SET status = $2 WHERE id = $1', [jobId, status]);
}

/** Restores an MR from 'merging' back to the job's prior status. No-op if it moved on. */
async function restoreMergeRequestStatus(job: MergeJob): Promise<void> {
  if (job.mergeRequestId === null || job.priorMrStatus === null) {
    return;
  }
  await restoreMergeRequestClaim(job.mergeRequestId, job.priorMrStatus);
}

// =============================================================================
// Step 1: plan
// =============================================================================

/**
 * Freezes the work list (design §6 step 1). Detection runs once; the frozen
 * source-version ids make the merge a consistent snapshot even if the source
 * branch keeps moving. Idempotent: re-running upserts the same rows.
 */
export async function planMergeJob(jobId: string): Promise<PlanOutcome> {
  const logger = getLogger();
  const job = await requireMergeJob(jobId);

  if (job.status !== 'queued' && job.status !== 'planning' && job.status !== 'running') {
    // A retry after the plan already concluded (blocked/cancelled/failed).
    return job.status === 'blocked_on_conflicts'
      ? { outcome: 'blocked_on_conflicts', conflictCount: 0 }
      : { outcome: 'superseded' };
  }

  await query(
    `UPDATE app.merge_jobs SET status = 'planning', started_at = COALESCE(started_at, NOW())
     WHERE id = $1 AND status = 'queued'`,
    [jobId],
  );

  // MR-backed jobs must still own the 'merging' claim; anything else means a
  // second actor moved the MR and this job is superseded (ends successfully
  // as a job outcome, not an engine error).
  if (job.mergeRequestId !== null) {
    const mergeRequest = await getMergeRequest(job.mergeRequestId);
    if (mergeRequest?.status !== 'merging') {
      await query(
        'UPDATE app.merge_jobs SET status = \'failed\', error = $2, finished_at = NOW() WHERE id = $1',
        [jobId, 'superseded: merge request is no longer in merging status'],
      );
      return { outcome: 'superseded' };
    }
  }

  // Retry fence: once the work list is frozen, NEVER re-run detection — the
  // source branch may have moved, and re-freezing would mix snapshots and
  // overwrite total_documents out of sync with the ledger. Resume from the
  // ledger instead.
  const frozen = await query<{ total: string; conflicts: string }>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE kind = 'conflict') AS conflicts
     FROM app.merge_job_documents WHERE job_id = $1`,
    [jobId],
  );
  const frozenTotal = parseInt(frozen.rows[0]?.total ?? '0', 10);
  if (frozenTotal > 0) {
    const frozenConflicts = parseInt(frozen.rows[0]?.conflicts ?? '0', 10);
    await query(
      `UPDATE app.merge_jobs SET status = 'running', total_documents = $2
       WHERE id = $1 AND status IN ('queued', 'planning', 'running')`,
      [jobId, frozenTotal],
    );
    return {
      outcome: 'planned',
      totalDocuments: frozenTotal,
      copyCount: frozenTotal - frozenConflicts,
      conflictCount: frozenConflicts,
    };
  }

  const detection = applySystemManagedExclusions(
    await detectConflicts(job.sourceBranchId, job.targetBranchId),
  );

  // Path promotion (branch-scoped renames riding along with the merge) is
  // validated up front so an occupied destination path fails the job cleanly
  // before any version is written — the same pre-write check the inline merge
  // performs. The actual promotion is applied during finalization.
  await planPathOverridePromotion(job.sourceBranchId, job.targetBranchId, job.siteId);

  const resolutionMap = new Map<string, DocumentResolution>();
  for (const r of job.resolutions ?? []) {
    resolutionMap.set(r.documentId, r);
  }

  if (detection.hasConflicts) {
    const uncovered = detection.conflicts.documentConflicts.filter((c) => {
      const strategy = resolutionMap.get(c.documentId)?.strategy ?? job.resolutionStrategy;
      if (strategy === null) return true;
      // Manual resolutions are only covering when they carry a snapshot.
      if (strategy === 'manual') {
        return resolutionMap.get(c.documentId)?.resolvedSnapshot === undefined;
      }
      return false;
    });

    if (uncovered.length > 0) {
      if (job.mergeRequestId !== null) {
        await updateMergeRequestConflicts(job.mergeRequestId, detection.conflicts);
        await markMergeRequestConflictedFromMerging(job.mergeRequestId);
      }
      await query(
        `UPDATE app.merge_jobs SET status = 'blocked_on_conflicts', error = $2, finished_at = NOW()
         WHERE id = $1`,
        [jobId, `${String(uncovered.length)} unresolved conflict(s)`],
      );
      logger.info('merge job blocked on conflicts', {
        job_id: jobId,
        conflict_count: uncovered.length,
      });
      return { outcome: 'blocked_on_conflicts', conflictCount: uncovered.length };
    }
  }

  const conflictingDocIds = new Set(
    detection.conflicts.documentConflicts.map((c) => c.documentId),
  );

  interface PlannedRow {
    documentId: string;
    path: string;
    kind: 'copy' | 'conflict';
    strategy: ConflictResolutionStrategy | null;
    conflictType: string | null;
    sourceVersionId: string | null;
    targetVersionId: string | null;
  }

  const rows: PlannedRow[] = [];

  for (const change of detection.sourceChanges) {
    if (conflictingDocIds.has(change.documentId)) continue;
    if (change.latestVersionId === null) continue;
    rows.push({
      documentId: change.documentId,
      path: change.documentPath,
      kind: 'copy',
      strategy: null,
      conflictType: null,
      sourceVersionId: change.latestVersionId,
      targetVersionId: null,
    });
  }

  for (const conflict of detection.conflicts.documentConflicts) {
    const strategy = resolutionMap.get(conflict.documentId)?.strategy ?? job.resolutionStrategy;
    const sourceChange = detection.sourceChanges.find((c) => c.documentId === conflict.documentId);
    const targetChange = detection.targetChanges.find((c) => c.documentId === conflict.documentId);
    rows.push({
      documentId: conflict.documentId,
      path: sourceChange?.documentPath ?? targetChange?.documentPath ?? conflict.documentPath,
      kind: 'conflict',
      strategy: strategy ?? null,
      conflictType: conflict.conflictType,
      // Provenance only for take-source, matching the inline path.
      sourceVersionId: strategy === 'take-source' ? sourceChange?.latestVersionId ?? null : null,
      targetVersionId: targetChange?.latestVersionId ?? null,
    });
  }

  if (rows.length > 0) {
    // ON CONFLICT DO NOTHING keeps a plan-step retry idempotent: rows frozen
    // by a previous attempt (and possibly already applied) are never reset.
    await query(
      `INSERT INTO app.merge_job_documents
         (job_id, document_id, document_path, kind, resolution_strategy,
          conflict_type, source_version_id, target_version_id)
       SELECT $1, * FROM unnest(
         $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::uuid[], $8::uuid[]
       ) AS t(document_id, document_path, kind, resolution_strategy,
              conflict_type, source_version_id, target_version_id)
       ON CONFLICT (job_id, document_id) DO NOTHING`,
      [
        jobId,
        rows.map((r) => r.documentId),
        rows.map((r) => r.path),
        rows.map((r) => r.kind),
        rows.map((r) => r.strategy),
        rows.map((r) => r.conflictType),
        rows.map((r) => r.sourceVersionId),
        rows.map((r) => r.targetVersionId),
      ],
    );
  }

  await query(
    'UPDATE app.merge_jobs SET status = \'running\', total_documents = $2 WHERE id = $1',
    [jobId, rows.length],
  );

  const conflictCount = detection.conflicts.documentConflicts.length;
  logger.info('merge job planned', {
    job_id: jobId,
    total_documents: rows.length,
    conflict_count: conflictCount,
  });

  return {
    outcome: 'planned',
    totalDocuments: rows.length,
    copyCount: rows.length - conflictCount,
    conflictCount,
  };
}

// =============================================================================
// Step 2: apply chunk
// =============================================================================

const CHUNK_SIZE_DEFAULT = 25;
const CHUNK_WALL_CLOCK_MS_DEFAULT = 10_000;

/**
 * Infrastructure errors propagate out of the chunk (triggering the workflow
 * step's retry/backoff); anything else is a per-document failure recorded in
 * the ledger. Patterns mirror runWithConnection's connection-error detection.
 */
function isInfrastructureError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return isConnectionError(error) || /query (read )?timeout/i.test(error.message);
}

async function markLedgerRow(
  jobId: string,
  documentId: string,
  status: 'done' | 'skipped_noop' | 'failed',
  resultVersionId: string | null,
  error: string | null,
): Promise<void> {
  await query(
    `UPDATE app.merge_job_documents
     SET status = $3, result_version_id = $4, error = $5,
         attempts = attempts + 1, updated_at = NOW()
     WHERE job_id = $1 AND document_id = $2`,
    [jobId, documentId, status, resultVersionId, error],
  );
}

/** Recounts job counters from the ledger — idempotent, no drift on retries. */
async function refreshJobCounters(jobId: string): Promise<void> {
  await query(
    `UPDATE app.merge_jobs SET
       processed_documents =
         (SELECT COUNT(*) FROM app.merge_job_documents WHERE job_id = $1 AND status = 'done'),
       failed_documents =
         (SELECT COUNT(*) FROM app.merge_job_documents WHERE job_id = $1 AND status = 'failed'),
       noop_documents =
         (SELECT COUNT(*) FROM app.merge_job_documents WHERE job_id = $1 AND status = 'skipped_noop')
     WHERE id = $1`,
    [jobId],
  );
}

async function applyCopyRow(job: MergeJob, row: MergeJobDocumentRow): Promise<{
  status: 'done' | 'skipped_noop' | 'failed';
  resultVersionId: string | null;
  error: string | null;
}> {
  if (row.source_version_id === null) {
    return { status: 'failed', resultVersionId: null, error: 'copy row has no source version id' };
  }

  // One read serves both idempotency layers: the Layer-2 replay probe and the
  // pre-existing-latest no-op check (checkpoint-pollution guard).
  const latest = await getLatestDocumentVersion(row.document_id, job.targetBranchId);

  // Layer-2 probe: the latest target version is already this exact planned
  // write — a replay across the INSERT-vs-ledger crash window or a fresh job
  // resuming after a failed one. Record, insert nothing.
  if (
    latest !== null &&
    latest.source === 'merge' &&
    latest.sourceVersionId === row.source_version_id
  ) {
    return { status: 'done', resultVersionId: latest.id, error: null };
  }

  const sourceVersion = await getDocumentVersion(row.source_version_id);
  if (sourceVersion === null) {
    return { status: 'failed', resultVersionId: null, error: 'source version no longer exists' };
  }

  const newVersion = await createDocumentVersion({
    documentId: row.document_id,
    branchId: job.targetBranchId,
    snapshot: sourceVersion.snapshot ?? {},
    source: 'merge',
    createdById: job.triggeredById,
    createdByType: job.triggeredByType,
    // The merge-aware Layer-2 probe above replaces the blind duplicate check;
    // a deliberate re-merge of the same content from a DIFFERENT source
    // version still creates its `source='merge'` history marker.
    skipDuplicateCheck: true,
    skipCompaction: true,
    isTombstone: sourceVersion.isTombstone,
    // Insert-time provenance stamp — what the probe reads on the next replay.
    sourceVersionId: row.source_version_id,
  });

  // Pre-existing no-op: createDocumentVersion's unique-violation fallback
  // returned the version that was already latest on the target.
  if (latest?.id === newVersion.id) {
    return { status: 'skipped_noop', resultVersionId: newVersion.id, error: null };
  }

  return { status: 'done', resultVersionId: newVersion.id, error: null };
}

async function applyConflictRow(job: MergeJob, row: MergeJobDocumentRow): Promise<{
  status: 'done' | 'skipped_noop' | 'failed';
  resultVersionId: string | null;
  error: string | null;
}> {
  const strategy = row.resolution_strategy;
  if (strategy === null) {
    return { status: 'failed', resultVersionId: null, error: 'conflict row has no resolution strategy' };
  }

  const latest = await getLatestDocumentVersion(row.document_id, job.targetBranchId);
  const isPreExistingTargetVersionId = (versionId: string): boolean =>
    latest?.id === versionId || row.target_version_id === versionId;

  // Layer-2 probe for take-source, mirroring copy rows: the latest target
  // version already IS this planned write (a crash-window replay). Without
  // this, the replay would fall through to the pre-existing no-op check and
  // be misclassified skipped_noop — silently dropping a genuinely merged
  // document from the checkpoint and publish.
  if (
    strategy === 'take-source' &&
    row.source_version_id !== null &&
    latest !== null &&
    latest.source === 'merge' &&
    latest.sourceVersionId === row.source_version_id
  ) {
    return { status: 'done', resultVersionId: latest.id, error: null };
  }

  if (strategy === 'manual') {
    const resolution = (job.resolutions ?? []).find((r) => r.documentId === row.document_id);
    if (resolution?.resolvedSnapshot === undefined) {
      return {
        status: 'failed',
        resultVersionId: null,
        error: 'manual resolution requires a resolvedSnapshot',
      };
    }
    const manualVersion = await createDocumentVersion({
      documentId: row.document_id,
      branchId: job.targetBranchId,
      snapshot: resolution.resolvedSnapshot,
      source: 'merge',
      createdById: job.triggeredById,
      createdByType: job.triggeredByType,
      skipDuplicateCheck: true,
      skipCompaction: true,
    });
    if (isPreExistingTargetVersionId(manualVersion.id)) {
      return { status: 'skipped_noop', resultVersionId: manualVersion.id, error: null };
    }
    return { status: 'done', resultVersionId: manualVersion.id, error: null };
  }

  const resolutionResult = await resolveAllConflicts({
    sourceBranchId: job.sourceBranchId,
    targetBranchId: job.targetBranchId,
    conflicts: [{
      documentId: row.document_id,
      documentPath: row.document_path,
      conflictType: (row.conflict_type ?? 'both-modified') as 'both-modified' | 'deleted-in-source' | 'deleted-in-target',
      sourceVersionId: row.source_version_id ?? '',
      targetVersionId: row.target_version_id ?? '',
    }],
    strategy,
    resolvedById: job.triggeredById,
    resolvedByType: job.triggeredByType,
  });

  const res = resolutionResult.resolutions[0];
  if (res?.resolved !== true) {
    return {
      status: 'failed',
      resultVersionId: null,
      error: res?.error ?? 'conflict resolution failed',
    };
  }
  if (res.resultVersionId === undefined || isPreExistingTargetVersionId(res.resultVersionId)) {
    // Always true for take-target; possible for take-source when snapshots
    // match. Nothing new was written — exclude from downstream checkpoints.
    return { status: 'skipped_noop', resultVersionId: res.resultVersionId ?? null, error: null };
  }
  return { status: 'done', resultVersionId: res.resultVersionId, error: null };
}

/**
 * Claims and applies up to `chunkSize` pending ledger rows (design §6 step 2).
 * A poison document never throws out of the chunk; only infrastructure errors
 * propagate to the workflow's retry/backoff.
 */
export async function applyMergeChunk(
  jobId: string,
  options: { chunkSize?: number; wallClockMs?: number } = {},
): Promise<ApplyChunkResult> {
  const logger = getLogger();
  const chunkSize = options.chunkSize ?? CHUNK_SIZE_DEFAULT;
  const wallClockMs = options.wallClockMs ?? CHUNK_WALL_CLOCK_MS_DEFAULT;

  const job = await requireMergeJob(jobId);

  if (job.cancelRequested) {
    return { done: 0, failed: 0, noop: 0, remaining: 0, avgMsPerDoc: 0, cancelled: true };
  }

  // The clock starts before the claim query so avgMsPerDoc — the pacing
  // signal — reflects the chunk's full DB cost, not just the per-doc applies.
  // performance.now(): monotonic, and made for measuring an operation.
  const start = performance.now();

  const pending = await query<MergeJobDocumentRow>(
    `SELECT * FROM app.merge_job_documents
     WHERE job_id = $1 AND status = 'pending'
     ORDER BY document_path
     LIMIT $2`,
    [jobId, chunkSize],
  );

  let done = 0;
  let failed = 0;
  let noop = 0;
  let applied = 0;

  for (const row of pending.rows) {
    // Wall-clock guard: never hold a connection long under a degraded DB.
    if (applied > 0 && performance.now() - start > wallClockMs) {
      break;
    }
    applied++;

    try {
      const result =
        row.kind === 'copy' ? await applyCopyRow(job, row) : await applyConflictRow(job, row);
      await markLedgerRow(jobId, row.document_id, result.status, result.resultVersionId, result.error);
      if (result.status === 'done') done++;
      else if (result.status === 'skipped_noop') noop++;
      else failed++;
    } catch (error) {
      if (isInfrastructureError(error)) {
        // Let the workflow step retry with backoff; the ledger row stays
        // pending and Layer 2 covers any half-applied write.
        throw error;
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      await markLedgerRow(jobId, row.document_id, 'failed', null, message);
      failed++;
      logger.warn('merge job document failed', {
        job_id: jobId,
        document_id: row.document_id,
        reason: message,
      });
    }
  }

  await refreshJobCounters(jobId);

  const remainingResult = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM app.merge_job_documents WHERE job_id = $1 AND status = \'pending\'',
    [jobId],
  );
  const remaining = parseInt(remainingResult.rows[0]?.count ?? '0', 10);
  const avgMsPerDoc = applied > 0 ? Math.round((performance.now() - start) / applied) : 0;

  return { done, failed, noop, remaining, avgMsPerDoc, cancelled: false };
}

// =============================================================================
// Finalization steps
// =============================================================================

interface DoneLedgerEntry {
  documentId: string;
  documentVersionId: string;
  sourceVersionId: string | null;
}

async function getDoneLedgerEntries(jobId: string): Promise<DoneLedgerEntry[]> {
  const result = await query<{
    document_id: string;
    result_version_id: string | null;
    source_version_id: string | null;
  }>(
    `SELECT document_id, result_version_id, source_version_id
     FROM app.merge_job_documents
     WHERE job_id = $1 AND status = 'done' AND result_version_id IS NOT NULL
     ORDER BY document_path`,
    [jobId],
  );
  return result.rows.flatMap((r) =>
    r.result_version_id === null
      ? []
      : [{
        documentId: r.document_id,
        documentVersionId: r.result_version_id,
        sourceVersionId: r.source_version_id,
      }],
  );
}

/**
 * Whether finalization may commit the merge. All-or-nothing by default
 * (design §8 poison policy): any failed document keeps the merge un-finalized
 * and the job ends completed_with_errors with the failures listed.
 */
async function isFinalizable(job: MergeJob): Promise<boolean> {
  const counts = await query<{ failed: string; pending: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'failed') AS failed,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending
     FROM app.merge_job_documents WHERE job_id = $1`,
    [job.id],
  );
  const row = counts.rows[0];
  return row?.failed === '0' && row.pending === '0';
}

/**
 * Path promotion + post_merge checkpoint over ALL done rows across every
 * chunk (design §6 step 3), stamped for idempotency.
 */
export async function finalizeMergeCheckpoint(jobId: string): Promise<FinalizeCheckpointResult> {
  const job = await requireMergeJob(jobId);

  // Crash-window guard: checkpoint already created by a previous attempt.
  if (job.postMergeCheckpointId !== null) {
    return { checkpointId: job.postMergeCheckpointId, finalized: true, mergedCount: job.processedDocuments };
  }

  if (!(await isFinalizable(job))) {
    return { checkpointId: null, finalized: false, mergedCount: 0 };
  }

  await setJobStatus(jobId, 'finalizing');

  // Promote source-branch path overrides before the checkpoint, mirroring the
  // inline path's ordering (apply after copies, before checkpoint). Both
  // writes are idempotent (UPDATE / upsert).
  const promotion = await planPathOverridePromotion(
    job.sourceBranchId,
    job.targetBranchId,
    job.siteId,
  );
  await applyPathOverridePromotion(promotion);

  const entries = await getDoneLedgerEntries(jobId);
  if (entries.length === 0) {
    // Nothing actually merged (all no-ops) — no checkpoint to create.
    return { checkpointId: null, finalized: true, mergedCount: 0 };
  }

  const mergeTitle = await getMergeJobTitle(job);
  const checkpointResult = await createCheckpoint({
    branchId: job.targetBranchId,
    name: `Merge: ${mergeTitle}`,
    checkpointType: 'post_merge',
    createdById: job.triggeredById,
    createdByType: job.triggeredByType,
    documentVersionIds: entries.map((e) => ({
      documentId: e.documentId,
      documentVersionId: e.documentVersionId,
    })),
  });

  await query(
    'UPDATE app.merge_jobs SET post_merge_checkpoint_id = $2 WHERE id = $1',
    [jobId, checkpointResult.checkpoint.id],
  );

  return { checkpointId: checkpointResult.checkpoint.id, finalized: true, mergedCount: entries.length };
}

async function getMergeJobTitle(job: MergeJob): Promise<string> {
  if (job.mergeRequestId !== null) {
    const mergeRequest = await getMergeRequest(job.mergeRequestId);
    if (mergeRequest !== null) return mergeRequest.title;
  }
  return `branch merge ${job.sourceBranchId} -> ${job.targetBranchId}`;
}

/**
 * CAS the MR merging -> merged (design §6 step 4); on a non-finalizable job,
 * restore the MR to its prior status instead.
 */
export async function finalizeMergeStatus(jobId: string): Promise<{ finalized: boolean }> {
  const job = await requireMergeJob(jobId);

  if (!(await isFinalizable(job))) {
    await restoreMergeRequestStatus(job);
    return { finalized: false };
  }

  if (job.mergeRequestId !== null) {
    const mergeRequest = await getMergeRequest(job.mergeRequestId);
    if (mergeRequest !== null && mergeRequest.status === 'merging') {
      await updateMergeRequestStatus(job.mergeRequestId, 'merged', {
        mergedById: job.triggeredById,
        mergedByType: job.triggeredByType,
      });
    }
  }
  return { finalized: true };
}

/**
 * Auto-publish over all done rows (design §6 step 5). Only when the target is
 * main and the job finalized. Stamped for idempotency; a publish failure is
 * recorded on the job, never thrown — merge committed, error surfaced,
 * matching today's contract.
 */
export async function finalizeMergePublish(jobId: string): Promise<FinalizePublishResult> {
  const job = await requireMergeJob(jobId);

  const mainBranch = await getMainBranch(job.siteId);
  const targetIsMain = mainBranch !== null && job.targetBranchId === mainBranch.id;

  if (!targetIsMain || !(await isFinalizable(job))) {
    return { publishCheckpointId: null, publishedDocumentIds: [], publishError: null, targetIsMain };
  }

  const entries = await getDoneLedgerEntries(jobId);
  if (entries.length === 0) {
    return { publishCheckpointId: null, publishedDocumentIds: [], publishError: null, targetIsMain };
  }

  if (job.publishCheckpointId !== null) {
    return {
      publishCheckpointId: job.publishCheckpointId,
      publishedDocumentIds: entries.map((e) => e.documentId),
      publishError: null,
      targetIsMain,
    };
  }

  const mergeTitle = await getMergeJobTitle(job);
  try {
    const publishResult = await publishMergedVersions({
      siteId: job.siteId,
      mainBranchId: job.targetBranchId,
      sourceBranchId: job.sourceBranchId,
      mergedVersions: entries,
      mergedById: job.triggeredById,
      mergedByType: job.triggeredByType,
      mergeTitle,
    });
    if (publishResult.checkpointId !== undefined) {
      await query(
        'UPDATE app.merge_jobs SET publish_checkpoint_id = $2 WHERE id = $1',
        [jobId, publishResult.checkpointId],
      );
    }
    return {
      publishCheckpointId: publishResult.checkpointId ?? null,
      publishedDocumentIds: entries.map((e) => e.documentId),
      publishError: null,
      targetIsMain,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'publish failed';
    await query('UPDATE app.merge_jobs SET publish_error = $2 WHERE id = $1', [jobId, message]);
    getLogger().error('merge job publish failed', error, { job_id: jobId });
    return {
      publishCheckpointId: null,
      publishedDocumentIds: [],
      publishError: message,
      targetIsMain,
    };
  }
}

/** Template document ids from the ledger, for the notify step's migrations. */
export async function getMergedTemplateDocumentIds(jobId: string): Promise<string[]> {
  const result = await query<{ document_id: string }>(
    `SELECT document_id FROM app.merge_job_documents
     WHERE job_id = $1 AND status = 'done' AND document_path LIKE '\\_registry/templates/%' ESCAPE '\\'`,
    [jobId],
  );
  return result.rows.map((r) => r.document_id);
}

export { runPostMergeTemplateMigrations };

/** Job terminal bookkeeping (design §6 step 7). */
export async function finalizeMergeJobRecord(jobId: string): Promise<MergeJobStatus> {
  const job = await requireMergeJob(jobId);
  const finalizable = await isFinalizable(job);
  const status: MergeJobStatus = finalizable ? 'completed' : 'completed_with_errors';
  await query(
    'UPDATE app.merge_jobs SET status = $2, finished_at = NOW() WHERE id = $1',
    [jobId, status],
  );
  return status;
}

/** Cancel epilogue: job cancelled, MR restored; partial copies stay recorded
 *  in the ledger as unpublished merge versions (archive/exclude later — the
 *  platform never deletes by default). */
export async function cancelMergeJob(jobId: string): Promise<void> {
  const job = await requireMergeJob(jobId);
  await query(
    'UPDATE app.merge_jobs SET status = \'cancelled\', finished_at = NOW() WHERE id = $1',
    [jobId],
  );
  await restoreMergeRequestStatus(job);
}

/** Failure epilogue: engine retries exhausted or a non-retryable error. */
export async function failMergeJob(jobId: string, errorMessage: string): Promise<void> {
  const job = await requireMergeJob(jobId);
  await query(
    'UPDATE app.merge_jobs SET status = \'failed\', error = $2, finished_at = NOW() WHERE id = $1',
    [jobId, errorMessage],
  );
  await restoreMergeRequestStatus(job);
}
