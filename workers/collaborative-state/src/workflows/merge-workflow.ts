/**
 * MergeWorkflow [PCC-3737] — durable driver for merge execution.
 *
 * Thin shell over the step bodies in services/merge-job-service.ts (which is
 * where the logic and the tests live); the Postgres job ledger — not workflow
 * state — is the source of truth the status API and operators read. Design:
 * docs/merge-job-runner-architecture-2026-08-21.md §6.
 *
 * STEP NAMING IS APPEND-ONLY. In-flight instances resume on newly deployed
 * code with completed step results replayed by name, so renaming or reordering
 * steps strands running merges. Chunk steps are data-driven
 * (`apply-chunk-{i}`), which keeps the shape stable across deploys. A deploy
 * that must change the step structure ships behind a drain: let active
 * instances finish, or terminate and re-execute (cheap — resume is free of
 * duplicates by design).
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { contextForTask, withRequestContext } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../env';
import { ensureLogger } from '../telemetry';
import { runWithEnvConnection } from '../db';
import {
  planMergeJob,
  applyMergeChunk,
  finalizeMergeCheckpoint,
  finalizeMergeStatus,
  finalizeMergePublish,
  finalizeMergeJobRecord,
  cancelMergeJob,
  failMergeJob,
  getMergeJob,
  getMergedTemplateDocumentIds,
  runPostMergeTemplateMigrations,
} from '../services/merge-job-service';
import { writeBranchInvalidation } from '../services/branch-invalidation-service';
import { reloadDocumentSessions } from '../services/document-session-reload';

export interface MergeWorkflowParams {
  jobId: string;
}

type SleepDuration = Parameters<WorkflowStep['sleep']>[1];

/**
 * Chunking and backpressure tuning, env-overridable so staging soak (design
 * open question 5) can tune without a code change. Defaults per the design:
 * 25-doc chunks, ~10s wall-clock guard, pace above 150ms/doc, 15s sleeps.
 */
interface MergePacingConfig {
  chunkSize: number;
  wallClockMs: number;
  pacingTriggerMsPerDoc: number;
  pacingSleep: SleepDuration;
}

function intVar(value: string | undefined, fallback: number): number {
  const parsed = value !== undefined ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pacingConfig(env: Env): MergePacingConfig {
  return {
    chunkSize: intVar(env.MERGE_CHUNK_SIZE, 25),
    wallClockMs: intVar(env.MERGE_CHUNK_WALL_CLOCK_MS, 10_000),
    pacingTriggerMsPerDoc: intVar(env.MERGE_PACING_TRIGGER_MS_PER_DOC, 150),
    pacingSleep: `${String(intVar(env.MERGE_PACING_SLEEP_SECONDS, 15))} seconds` as SleepDuration,
  };
}

/** One pool slot per running job: every step opens exactly one connection. */
function withJobConnection<T>(env: Env, fn: () => Promise<T>): Promise<T> {
  return runWithEnvConnection(env, fn);
}

export class MergeWorkflow extends WorkflowEntrypoint<Env, MergeWorkflowParams> {
  async run(event: WorkflowEvent<MergeWorkflowParams>, step: WorkflowStep): Promise<void> {
    const logger = ensureLogger(this.env);
    const { jobId } = event.payload;
    const pacing = pacingConfig(this.env);

    await withRequestContext(contextForTask({ route: 'workflow:merge' }), async () => {
      try {
        const plan = await step.do(
          'plan',
          { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
          () => withJobConnection(this.env, () => planMergeJob(jobId)),
        );

        if (plan.outcome !== 'planned') {
          // blocked_on_conflicts / superseded are job outcomes, not engine
          // errors — the instance ends successfully (design §6 step 1).
          logger.info('merge job ended at plan', { job_id: jobId, outcome: plan.outcome });
          return;
        }

        // Chunk loop: rows are claimed from the ledger, so the loop bound is
        // data-driven and the step count stays proportional to the work left.
        // Retries ride out a multi-minute DB incident (8 tries, exp from 30s).
        let chunkIndex = 0;
        for (;;) {
          const chunk = await step.do(
            `apply-chunk-${String(chunkIndex)}`,
            { retries: { limit: 8, delay: '30 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
            () => withJobConnection(this.env, () =>
              applyMergeChunk(jobId, { chunkSize: pacing.chunkSize, wallClockMs: pacing.wallClockMs })),
          );

          if (chunk.cancelled) {
            await step.do(
              'cancel-job',
              { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '1 minute' },
              () => withJobConnection(this.env, () => cancelMergeJob(jobId)),
            );
            logger.info('merge job cancelled', { job_id: jobId, chunks_run: chunkIndex });
            return;
          }

          if (chunk.remaining === 0) {
            break;
          }

          // Backpressure: a saturated pool slows this merge down instead of
          // the merge pinning the pool (sleep is free of step-count limits).
          if (chunk.avgMsPerDoc > pacing.pacingTriggerMsPerDoc) {
            await step.sleep(`pace-${String(chunkIndex)}`, pacing.pacingSleep);
          }
          chunkIndex++;
        }

        const checkpoint = await step.do(
          'finalize-checkpoint',
          { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
          () => withJobConnection(this.env, () => finalizeMergeCheckpoint(jobId)),
        );

        const status = await step.do(
          'finalize-status',
          { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '1 minute' },
          () => withJobConnection(this.env, () => finalizeMergeStatus(jobId)),
        );

        let publishedDocumentIds: string[] = [];
        if (status.finalized) {
          const publish = await step.do(
            'finalize-publish',
            { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
            () => withJobConnection(this.env, () => finalizeMergePublish(jobId)),
          );
          publishedDocumentIds = publish.publishedDocumentIds;

          // Best-effort: bounded retries, never fails the job (design §6
          // step 6). Gated on finalization — a completed_with_errors job has
          // published nothing and must not invalidate caches or run template
          // migrations; the retry job that does finalize notifies then.
          try {
            await step.do(
              'finalize-notify',
              { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '5 minutes' },
              () => this.notify(jobId, publishedDocumentIds),
            );
          } catch (error) {
            logger.error('merge job notify failed', error, { job_id: jobId });
          }
        }

        const finalStatus = await step.do(
          'finalize-job',
          { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '1 minute' },
          () => withJobConnection(this.env, () => finalizeMergeJobRecord(jobId)),
        );

        logger.info('merge job finished', {
          job_id: jobId,
          job_status: finalStatus,
          checkpoint_id: checkpoint.checkpointId ?? 'none',
          published_count: publishedDocumentIds.length,
        });
      } catch (error) {
        // Engine retries exhausted or a non-retryable error: record the
        // failure and restore the MR, then rethrow so the instance surfaces
        // as errored in the Workflows dashboard.
        const message = error instanceof Error ? error.message : 'merge workflow failed';
        try {
          await step.do(
            'fail-job',
            { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '1 minute' },
            () => withJobConnection(this.env, () => failMergeJob(jobId, message)),
          );
        } catch (epilogueError) {
          logger.error('merge job failure epilogue failed', epilogueError, { job_id: jobId });
        }
        logger.unhandled('merge job failed', error, { job_id: jobId });
        throw error;
      }
    });
  }

  /**
   * KV branch invalidation, DO reloads for published docs, and post-merge
   * template migrations, now free of the request deadline. The cache purge is
   * NOT here: publishMergedVersions already issues the single site/branch
   * purge in its finally, and a second call would double spend against the
   * account-wide 5/min purge budget.
   */
  private async notify(jobId: string, publishedDocumentIds: string[]): Promise<void> {
    const logger = ensureLogger(this.env);

    const job = await withJobConnection(this.env, () => getMergeJob(jobId));
    if (job === null) return;

    try {
      await writeBranchInvalidation(this.env.CONFIG_KV, job.targetBranchId);
    } catch (error) {
      logger.warn('merge job branch invalidation failed', {
        job_id: jobId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }

    await reloadDocumentSessions(
      this.env.DOCUMENT_STATE,
      job.siteId,
      job.targetBranchId,
      publishedDocumentIds,
      { job_id: jobId },
    );

    const templateIds = await withJobConnection(this.env, () => getMergedTemplateDocumentIds(jobId));
    if (templateIds.length > 0) {
      await withJobConnection(this.env, () =>
        runPostMergeTemplateMigrations({
          siteId: job.siteId,
          targetBranchId: job.targetBranchId,
          templateDocumentIds: templateIds,
          mergedById: job.triggeredById,
          mergedByType: job.triggeredByType,
          // No request deadline here; the step timeout bounds the whole pass.
        }),
      );
    }
  }
}
