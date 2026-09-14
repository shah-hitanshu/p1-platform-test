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
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { mergeJobDocuments, mergeJobs } from '../db/schema';
import { db } from '../db/scope';
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
  carryUpstreamResolutionsForMerge,
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
    const rows = await db()
      .insert(mergeJobs)
      .values({
        id: params.jobId,
        mergeRequestId: params.mergeRequestId ?? null,
        siteId: params.siteId,
        sourceBranchId: params.sourceBranchId,
        targetBranchId: params.targetBranchId,
        priorMrStatus: params.priorMrStatus ?? null,
        resolutionStrategy: params.resolutionStrategy ?? null,
        resolutions: params.resolutions ?? null,
        triggeredById: params.triggeredById,
        triggeredByType: params.triggeredByType,
      })
      .returning();
    const row = rows[0];
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
  const rows =
    params.mergeRequestId !== undefined
      ? await db()
        .select()
        .from(mergeJobs)
        .where(and(eq(mergeJobs.mergeRequestId, params.mergeRequestId), inArray(mergeJobs.status, statuses)))
        .limit(1)
      : await db()
        .select()
        .from(mergeJobs)
        .where(
          and(
            isNull(mergeJobs.mergeRequestId),
            eq(mergeJobs.siteId, params.siteId),
            eq(mergeJobs.sourceBranchId, params.sourceBranchId),
            eq(mergeJobs.targetBranchId, params.targetBranchId),
            inArray(mergeJobs.status, statuses),
          ),
        )
        .limit(1);
  const row = rows[0];
  return row ? rowToMergeJob(row) : null;
}

export async function getMergeJob(jobId: string): Promise<MergeJob | null> {
  const rows = await db().select().from(mergeJobs).where(eq(mergeJobs.id, jobId));
  const row = rows[0];
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
  const failed = await db()
    .select({
      documentId: mergeJobDocuments.documentId,
      documentPath: mergeJobDocuments.documentPath,
      error: mergeJobDocuments.error,
    })
    .from(mergeJobDocuments)
    .where(and(eq(mergeJobDocuments.jobId, jobId), eq(mergeJobDocuments.status, 'failed')))
    .orderBy(asc(mergeJobDocuments.documentPath));
  return {
    ...job,
    failedDocumentDetails: failed.map((r) => ({
      documentId: r.documentId,
      path: r.documentPath,
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
  const rows = await db()
    .update(mergeJobs)
    .set({ cancelRequested: true })
    .where(
      and(
        eq(mergeJobs.id, jobId),
        eq(mergeJobs.siteId, siteId),
        inArray(mergeJobs.status, ['queued', 'planning', 'running']),
      ),
    )
    .returning({ id: mergeJobs.id });
  return rows.length > 0;
}

async function setJobStatus(jobId: string, status: MergeJobStatus): Promise<void> {
  await db().update(mergeJobs).set({ status }).where(eq(mergeJobs.id, jobId));
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

  await db()
    .update(mergeJobs)
    .set({ status: 'planning', startedAt: sql`COALESCE(started_at, NOW())` })
    .where(and(eq(mergeJobs.id, jobId), eq(mergeJobs.status, 'queued')));

  // MR-backed jobs must still own the 'merging' claim; anything else means a
  // second actor moved the MR and this job is superseded (ends successfully
  // as a job outcome, not an engine error).
  if (job.mergeRequestId !== null) {
    const mergeRequest = await getMergeRequest(job.mergeRequestId);
    if (mergeRequest?.status !== 'merging') {
      await db()
        .update(mergeJobs)
        .set({
          status: 'failed',
          error: 'superseded: merge request is no longer in merging status',
          finishedAt: sql`NOW()`,
        })
        .where(eq(mergeJobs.id, jobId));
      return { outcome: 'superseded' };
    }
  }

  // Retry fence: once the work list is frozen, NEVER re-run detection — the
  // source branch may have moved, and re-freezing would mix snapshots and
  // overwrite total_documents out of sync with the ledger. Resume from the
  // ledger instead.
  const frozen = await db()
    .select({
      total: sql<number>`COUNT(*)::int`,
      conflicts: sql<number>`(COUNT(*) FILTER (WHERE ${mergeJobDocuments.kind} = 'conflict'))::int`,
    })
    .from(mergeJobDocuments)
    .where(eq(mergeJobDocuments.jobId, jobId));
  const frozenTotal = frozen[0]?.total ?? 0;
  if (frozenTotal > 0) {
    const frozenConflicts = frozen[0]?.conflicts ?? 0;
    await db()
      .update(mergeJobs)
      .set({ status: 'running', totalDocuments: frozenTotal })
      .where(and(eq(mergeJobs.id, jobId), inArray(mergeJobs.status, ['queued', 'planning', 'running'])));
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
      await db()
        .update(mergeJobs)
        .set({
          status: 'blocked_on_conflicts',
          error: `${String(uncovered.length)} unresolved conflict(s)`,
          finishedAt: sql`NOW()`,
        })
        .where(eq(mergeJobs.id, jobId));
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
    // A bulk INSERT...SELECT sourced from unnest() has no builder equivalent,
    // so this stays a raw statement (D6). ON CONFLICT DO NOTHING keeps a
    // plan-step retry idempotent: rows frozen by a previous attempt (and
    // possibly already applied) are never reset.
    // A bare array interpolated into `sql` is spread as a parenthesized,
    // comma-joined parameter list (built for `IN (...)`) rather than bound as
    // one array-typed parameter, so unnest()'s array arguments need
    // sql.param() to reach the driver as real Postgres arrays.
    await db().execute(sql`
      INSERT INTO app.merge_job_documents
         (job_id, document_id, document_path, kind, resolution_strategy,
          conflict_type, source_version_id, target_version_id)
       SELECT ${jobId}, * FROM unnest(
         ${sql.param(rows.map((r) => r.documentId))}::uuid[],
         ${sql.param(rows.map((r) => r.path))}::text[],
         ${sql.param(rows.map((r) => r.kind))}::text[],
         ${sql.param(rows.map((r) => r.strategy))}::text[],
         ${sql.param(rows.map((r) => r.conflictType))}::text[],
         ${sql.param(rows.map((r) => r.sourceVersionId))}::uuid[],
         ${sql.param(rows.map((r) => r.targetVersionId))}::uuid[]
       ) AS t(document_id, document_path, kind, resolution_strategy,
              conflict_type, source_version_id, target_version_id)
       ON CONFLICT (job_id, document_id) DO NOTHING`);
  }

  await db()
    .update(mergeJobs)
    .set({ status: 'running', totalDocuments: rows.length })
    .where(eq(mergeJobs.id, jobId));

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
  await db()
    .update(mergeJobDocuments)
    .set({
      status,
      resultVersionId,
      error,
      attempts: sql`${mergeJobDocuments.attempts} + 1`,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(mergeJobDocuments.jobId, jobId), eq(mergeJobDocuments.documentId, documentId)));
}

/** Recounts job counters from the ledger — idempotent, no drift on retries. */
async function refreshJobCounters(jobId: string): Promise<void> {
  const countByStatus = (status: string): ReturnType<typeof sql> =>
    sql`(SELECT COUNT(*) FROM app.merge_job_documents WHERE job_id = ${jobId} AND status = ${status})`;

  await db()
    .update(mergeJobs)
    .set({
      processedDocuments: countByStatus('done'),
      failedDocuments: countByStatus('failed'),
      noopDocuments: countByStatus('skipped_noop'),
    })
    .where(eq(mergeJobs.id, jobId));
}

async function applyCopyRow(job: MergeJob, row: MergeJobDocumentRow): Promise<{
  status: 'done' | 'skipped_noop' | 'failed';
  resultVersionId: string | null;
  error: string | null;
}> {
  if (row.sourceVersionId === null) {
    return { status: 'failed', resultVersionId: null, error: 'copy row has no source version id' };
  }

  // One read serves both idempotency layers: the Layer-2 replay probe and the
  // pre-existing-latest no-op check (checkpoint-pollution guard).
  const latest = await getLatestDocumentVersion(row.documentId, job.targetBranchId);

  // Layer-2 probe: the latest target version is already this exact planned
  // write — a replay across the INSERT-vs-ledger crash window or a fresh job
  // resuming after a failed one. Record, insert nothing.
  if (
    latest !== null &&
    latest.source === 'merge' &&
    latest.sourceVersionId === row.sourceVersionId
  ) {
    return { status: 'done', resultVersionId: latest.id, error: null };
  }

  const sourceVersion = await getDocumentVersion(row.sourceVersionId);
  if (sourceVersion === null) {
    return { status: 'failed', resultVersionId: null, error: 'source version no longer exists' };
  }

  const newVersion = await createDocumentVersion({
    documentId: row.documentId,
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
    sourceVersionId: row.sourceVersionId,
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
  const strategy = row.resolutionStrategy as ConflictResolutionStrategy | null;
  if (strategy === null) {
    return { status: 'failed', resultVersionId: null, error: 'conflict row has no resolution strategy' };
  }

  const latest = await getLatestDocumentVersion(row.documentId, job.targetBranchId);
  const isPreExistingTargetVersionId = (versionId: string): boolean =>
    latest?.id === versionId || row.targetVersionId === versionId;

  // Layer-2 probe for take-source, mirroring copy rows: the latest target
  // version already IS this planned write (a crash-window replay). Without
  // this, the replay would fall through to the pre-existing no-op check and
  // be misclassified skipped_noop — silently dropping a genuinely merged
  // document from the checkpoint and publish.
  if (
    strategy === 'take-source' &&
    row.sourceVersionId !== null &&
    latest !== null &&
    latest.source === 'merge' &&
    latest.sourceVersionId === row.sourceVersionId
  ) {
    return { status: 'done', resultVersionId: latest.id, error: null };
  }

  if (strategy === 'manual') {
    const resolution = (job.resolutions ?? []).find((r) => r.documentId === row.documentId);
    if (resolution?.resolvedSnapshot === undefined) {
      return {
        status: 'failed',
        resultVersionId: null,
        error: 'manual resolution requires a resolvedSnapshot',
      };
    }
    const manualVersion = await createDocumentVersion({
      documentId: row.documentId,
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
      documentId: row.documentId,
      documentPath: row.documentPath,
      conflictType: (row.conflictType ?? 'both-modified') as 'both-modified' | 'deleted-in-source' | 'deleted-in-target',
      sourceVersionId: row.sourceVersionId ?? '',
      targetVersionId: row.targetVersionId ?? '',
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

  const pending = await db()
    .select()
    .from(mergeJobDocuments)
    .where(and(eq(mergeJobDocuments.jobId, jobId), eq(mergeJobDocuments.status, 'pending')))
    .orderBy(asc(mergeJobDocuments.documentPath))
    .limit(chunkSize);

  let done = 0;
  let failed = 0;
  let noop = 0;
  let applied = 0;

  for (const row of pending) {
    // Wall-clock guard: never hold a connection long under a degraded DB.
    if (applied > 0 && performance.now() - start > wallClockMs) {
      break;
    }
    applied++;

    try {
      const result =
        row.kind === 'copy' ? await applyCopyRow(job, row) : await applyConflictRow(job, row);
      await markLedgerRow(jobId, row.documentId, result.status, result.resultVersionId, result.error);
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
      await markLedgerRow(jobId, row.documentId, 'failed', null, message);
      failed++;
      logger.warn('merge job document failed', {
        job_id: jobId,
        document_id: row.documentId,
        reason: message,
      });
    }
  }

  await refreshJobCounters(jobId);

  const remainingRows = await db()
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(mergeJobDocuments)
    .where(and(eq(mergeJobDocuments.jobId, jobId), eq(mergeJobDocuments.status, 'pending')));
  const remaining = remainingRows[0]?.count ?? 0;
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
  const rows = await db()
    .select({
      documentId: mergeJobDocuments.documentId,
      resultVersionId: mergeJobDocuments.resultVersionId,
      sourceVersionId: mergeJobDocuments.sourceVersionId,
    })
    .from(mergeJobDocuments)
    .where(
      and(
        eq(mergeJobDocuments.jobId, jobId),
        eq(mergeJobDocuments.status, 'done'),
        isNotNull(mergeJobDocuments.resultVersionId),
      ),
    )
    .orderBy(asc(mergeJobDocuments.documentPath));
  return rows.flatMap((r) =>
    r.resultVersionId === null
      ? []
      : [{
        documentId: r.documentId,
        documentVersionId: r.resultVersionId,
        sourceVersionId: r.sourceVersionId,
      }],
  );
}

/**
 * The conflicted documents whose resolution kept the target's content rather than
 * the source branch's. Keeping the target writes no version, so these carry no
 * ledger result to be recognised by.
 */
async function getConflictsKeepingTarget(jobId: string): Promise<string[]> {
  const rows = await db()
    .select({ documentId: mergeJobDocuments.documentId })
    .from(mergeJobDocuments)
    .where(
      and(
        eq(mergeJobDocuments.jobId, jobId),
        eq(mergeJobDocuments.kind, 'conflict'),
        inArray(mergeJobDocuments.resolutionStrategy, ['manual', 'take-target']),
      ),
    );
  return rows.map((r) => r.documentId);
}

/**
 * Whether finalization may commit the merge. All-or-nothing by default
 * (design §8 poison policy): any failed document keeps the merge un-finalized
 * and the job ends completed_with_errors with the failures listed.
 */
async function isFinalizable(job: MergeJob): Promise<boolean> {
  const counts = await db()
    .select({
      failed: sql<number>`(COUNT(*) FILTER (WHERE ${mergeJobDocuments.status} = 'failed'))::int`,
      pending: sql<number>`(COUNT(*) FILTER (WHERE ${mergeJobDocuments.status} = 'pending'))::int`,
    })
    .from(mergeJobDocuments)
    .where(eq(mergeJobDocuments.jobId, job.id));
  const row = counts[0];
  return row?.failed === 0 && row.pending === 0;
}

/**
 * Path promotion + post_merge checkpoint over ALL done rows across every
 * chunk (design §6 step 3), stamped for idempotency.
 */
export async function finalizeMergeCheckpoint(
  jobId: string,
): Promise<FinalizeCheckpointResult> {
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

  const [entries, conflictsKeepingTarget] = await Promise.all([
    getDoneLedgerEntries(jobId),
    getConflictsKeepingTarget(jobId),
  ]);

  await carryUpstreamResolutionsForMerge(
    job.sourceBranchId,
    job.targetBranchId,
    entries,
    conflictsKeepingTarget,
  );

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

  await db()
    .update(mergeJobs)
    .set({ postMergeCheckpointId: checkpointResult.checkpoint.id })
    .where(eq(mergeJobs.id, jobId));

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
      await db()
        .update(mergeJobs)
        .set({ publishCheckpointId: publishResult.checkpointId })
        .where(eq(mergeJobs.id, jobId));
    }
    return {
      publishCheckpointId: publishResult.checkpointId ?? null,
      publishedDocumentIds: entries.map((e) => e.documentId),
      publishError: null,
      targetIsMain,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'publish failed';
    await db().update(mergeJobs).set({ publishError: message }).where(eq(mergeJobs.id, jobId));
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
  const rows = await db()
    .select({ documentId: mergeJobDocuments.documentId })
    .from(mergeJobDocuments)
    .where(
      and(
        eq(mergeJobDocuments.jobId, jobId),
        eq(mergeJobDocuments.status, 'done'),
        // LIKE's escape character has no dedicated builder operator, so this
        // one predicate stays a sql fragment (D1).
        sql`${mergeJobDocuments.documentPath} LIKE '\\_registry/templates/%' ESCAPE '\\'`,
      ),
    );
  return rows.map((r) => r.documentId);
}

export { runPostMergeTemplateMigrations };

/** Job terminal bookkeeping (design §6 step 7). */
export async function finalizeMergeJobRecord(jobId: string): Promise<MergeJobStatus> {
  const job = await requireMergeJob(jobId);
  const finalizable = await isFinalizable(job);
  const status: MergeJobStatus = finalizable ? 'completed' : 'completed_with_errors';
  await db()
    .update(mergeJobs)
    .set({ status, finishedAt: sql`NOW()` })
    .where(eq(mergeJobs.id, jobId));
  return status;
}

/** Cancel epilogue: job cancelled, MR restored; partial copies stay recorded
 *  in the ledger as unpublished merge versions (archive/exclude later — the
 *  platform never deletes by default). */
export async function cancelMergeJob(jobId: string): Promise<void> {
  const job = await requireMergeJob(jobId);
  await db()
    .update(mergeJobs)
    .set({ status: 'cancelled', finishedAt: sql`NOW()` })
    .where(eq(mergeJobs.id, jobId));
  await restoreMergeRequestStatus(job);
}

/** Failure epilogue: engine retries exhausted or a non-retryable error. */
export async function failMergeJob(jobId: string, errorMessage: string): Promise<void> {
  const job = await requireMergeJob(jobId);
  await db()
    .update(mergeJobs)
    .set({ status: 'failed', error: errorMessage, finishedAt: sql`NOW()` })
    .where(eq(mergeJobs.id, jobId));
  await restoreMergeRequestStatus(job);
}
