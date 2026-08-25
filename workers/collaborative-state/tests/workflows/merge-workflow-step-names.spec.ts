/**
 * MergeWorkflow step-name pinning [PCC-3737].
 *
 * Workflows replay completed steps BY NAME when an in-flight instance resumes
 * on newly deployed code — renaming or reordering steps strands running
 * merges in production. Step naming is APPEND-ONLY: this test failing means
 * you are about to change the step structure, which must ship behind a drain
 * (let active instances finish, or terminate-and-re-execute). Update this
 * list only as part of that deliberate procedure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/merge-job-service', () => ({
  planMergeJob: vi.fn(),
  applyMergeChunk: vi.fn(),
  finalizeMergeCheckpoint: vi.fn(),
  finalizeMergeStatus: vi.fn(),
  finalizeMergePublish: vi.fn(),
  finalizeMergeJobRecord: vi.fn(),
  cancelMergeJob: vi.fn(),
  failMergeJob: vi.fn(),
  getMergeJob: vi.fn(),
  getMergedTemplateDocumentIds: vi.fn(),
  runPostMergeTemplateMigrations: vi.fn(),
}));

vi.mock('../../src/services/branch-invalidation-service', () => ({
  writeBranchInvalidation: vi.fn(),
}));

vi.mock('../../src/services/document-session-reload', () => ({
  reloadDocumentSessions: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  // Step bodies are mocked; the connection wrapper just runs them.
  runWithEnvConnection: vi.fn(async (_env: unknown, fn: () => Promise<unknown>) => fn()),
}));

interface StepRecorder {
  names: string[];
  do: (name: string, cfg: unknown, fn: () => Promise<unknown>) => Promise<unknown>;
  sleep: (name: string, duration: string) => Promise<void>;
}

function makeStep(): StepRecorder {
  const names: string[] = [];
  return {
    names,
    do: async (name, _cfg, fn) => {
      names.push(name);
      return await fn();
    },
    sleep: async (name) => {
      names.push(name);
    },
  };
}

function makeEnv(): Record<string, unknown> {
  return {
    ENVIRONMENT: 'local',
    POSTGRES_CONNECTION_STRING: 'postgres://unused',
    CONFIG_KV: {},
    DOCUMENT_STATE: {},
  };
}

describe('MergeWorkflow step naming (append-only) [PCC-3737]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pins the happy-path step sequence, including a pacing sleep', async () => {
    const { MergeWorkflow } = await import('../../src/workflows/merge-workflow');
    const jobService = await import('../../src/services/merge-job-service');

    vi.mocked(jobService.planMergeJob).mockResolvedValue({
      outcome: 'planned', totalDocuments: 50, copyCount: 50, conflictCount: 0,
    } as never);
    vi.mocked(jobService.applyMergeChunk)
      // Slow chunk with work remaining -> the workflow paces before chunk 1.
      .mockResolvedValueOnce({ done: 25, failed: 0, noop: 0, remaining: 25, avgMsPerDoc: 400, cancelled: false })
      .mockResolvedValueOnce({ done: 25, failed: 0, noop: 0, remaining: 0, avgMsPerDoc: 10, cancelled: false });
    vi.mocked(jobService.finalizeMergeCheckpoint).mockResolvedValue({ checkpointId: 'cp-1', finalized: true, mergedCount: 50 });
    vi.mocked(jobService.finalizeMergeStatus).mockResolvedValue({ finalized: true });
    vi.mocked(jobService.finalizeMergePublish).mockResolvedValue({
      publishCheckpointId: 'cp-2', publishedDocumentIds: [], publishError: null, targetIsMain: true,
    });
    vi.mocked(jobService.finalizeMergeJobRecord).mockResolvedValue('completed');
    vi.mocked(jobService.getMergeJob).mockResolvedValue({
      id: 'job-1', siteId: 's', targetBranchId: 'b', triggeredById: 'u', triggeredByType: 'user',
    } as never);
    vi.mocked(jobService.getMergedTemplateDocumentIds).mockResolvedValue([] as never);

    const step = makeStep();
    const workflow = new MergeWorkflow({} as never, makeEnv() as never);
    await workflow.run({ payload: { jobId: 'job-1' } } as never, step as never);

    // APPEND-ONLY. A diff on this list = a step-structure change = drain
    // in-flight instances first (see the workflow file header).
    expect(step.names).toEqual([
      'plan',
      'apply-chunk-0',
      'pace-0',
      'apply-chunk-1',
      'finalize-checkpoint',
      'finalize-status',
      'finalize-publish',
      'finalize-notify',
      'finalize-job',
    ]);
  });

  it('pins the cancellation and failure epilogue step names', async () => {
    const { MergeWorkflow } = await import('../../src/workflows/merge-workflow');
    const jobService = await import('../../src/services/merge-job-service');

    // Cancellation path.
    vi.mocked(jobService.planMergeJob).mockResolvedValue({
      outcome: 'planned', totalDocuments: 5, copyCount: 5, conflictCount: 0,
    } as never);
    vi.mocked(jobService.applyMergeChunk).mockResolvedValue(
      { done: 0, failed: 0, noop: 0, remaining: 0, avgMsPerDoc: 0, cancelled: true },
    );
    vi.mocked(jobService.cancelMergeJob).mockResolvedValue(undefined);

    const cancelStep = makeStep();
    const workflow = new MergeWorkflow({} as never, makeEnv() as never);
    await workflow.run({ payload: { jobId: 'job-1' } } as never, cancelStep as never);
    expect(cancelStep.names).toEqual(['plan', 'apply-chunk-0', 'cancel-job']);

    // Failure epilogue path.
    vi.mocked(jobService.planMergeJob).mockRejectedValue(new Error('engine retries exhausted'));
    vi.mocked(jobService.failMergeJob).mockResolvedValue(undefined);

    const failStep = makeStep();
    await expect(
      workflow.run({ payload: { jobId: 'job-1' } } as never, failStep as never),
    ).rejects.toThrow('engine retries exhausted');
    expect(failStep.names).toEqual(['plan', 'fail-job']);
  });
});
