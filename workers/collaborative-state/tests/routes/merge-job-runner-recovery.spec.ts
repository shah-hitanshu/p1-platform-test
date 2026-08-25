/**
 * Merge job runner — route-level recovery paths [PCC-3737].
 *
 * The execute route must never convert a recoverable situation into a dead
 * end: once the workflow instance exists, a polling failure is not an execute
 * failure; a crashed request that left the MR claimed (or a job driverless)
 * must be repaired by the NEXT execute attempt, not by manual SQL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import { makePrincipal } from '../helpers/principal';

vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getMergeRequest: vi.fn(),
    getMainBranch: vi.fn(),
  };
});

vi.mock('../../src/auth/authorization', async () => {
  const actual = await vi.importActual('../../src/auth/authorization');
  return {
    ...actual,
    assertPermission: vi.fn(),
  };
});

vi.mock('../../src/services/merge-job-service', async () => {
  const actual = await vi.importActual('../../src/services/merge-job-service');
  return {
    ...actual,
    createMergeJob: vi.fn(),
    findActiveMergeJob: vi.fn(),
    getMergeJob: vi.fn(),
    claimMergeRequestForExecution: vi.fn(),
    restoreMergeRequestClaim: vi.fn(),
    failMergeJob: vi.fn(),
  };
});

const SITE = 'site-1';
const MR_ID = 'mr-1';

function makeMergeRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MR_ID,
    siteId: SITE,
    sourceBranchId: 'branch-src',
    targetBranchId: 'branch-main',
    title: 'Recovery spec MR',
    status: 'approved',
    hasConflicts: false,
    createdById: 'user-1',
    createdByType: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    mergeRequestId: MR_ID,
    siteId: SITE,
    sourceBranchId: 'branch-src',
    targetBranchId: 'branch-main',
    status: 'running',
    priorMrStatus: 'approved',
    resolutionStrategy: null,
    resolutions: null,
    totalDocuments: 10,
    processedDocuments: 4,
    failedDocuments: 0,
    noopDocuments: 0,
    cancelRequested: false,
    postMergeCheckpointId: null,
    publishCheckpointId: null,
    publishError: null,
    error: null,
    triggeredById: 'user-1',
    triggeredByType: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    finishedAt: null,
    ...overrides,
  };
}

interface WorkflowCreateArgs { id: string; params: { jobId: string } }

function makeWorkflowBinding(): { create: ReturnType<typeof vi.fn> } {
  return { create: vi.fn().mockResolvedValue({ id: 'instance' }) };
}

function executeRequest(): Request {
  return new Request(
    `https://api.example.com/api/sites/${SITE}/merge-requests/${MR_ID}/execute`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
}

function runnerContext(workflow: { create: ReturnType<typeof vi.fn> }): Record<string, unknown> {
  return {
    siteId: SITE,
    executeRequest: true,
    mergeRequestId: MR_ID,
    principal: makePrincipal({ id: 'user-1', type: 'user' }),
    mergeJobRunnerEnabled: true,
    mergeWorkflow: workflow,
    boundedWaitMs: 0,
  };
}

describe('merge job runner route recovery [PCC-3737]', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('answers 202 with the jobId when the status poll dies mid-bounded-wait', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');
    const jobService = await import('../../src/services/merge-job-service');

    vi.mocked(services.getMergeRequest).mockResolvedValue(makeMergeRequest() as never);
    vi.mocked(jobService.claimMergeRequestForExecution).mockResolvedValue('approved');
    vi.mocked(jobService.createMergeJob).mockImplementation(
      async (params: { jobId: string }) => makeJob({ id: params.jobId, status: 'queued' }) as never,
    );
    // The DB dies once the workflow is already running detached.
    vi.mocked(jobService.getMergeJob).mockRejectedValue(
      new Error('connection refused'),
    );
    const workflow = makeWorkflowBinding();

    const response = await handleMergeRoutes(executeRequest(), runnerContext(workflow) as never);

    // The merge IS running — a 500 here would hide the jobId the client
    // needs; the async shape is the truthful answer.
    expect(response.status).toBe(202);
    const body = await readJson<{ jobId: string; statusUrl: string }>(response);
    expect(body.jobId).toBeDefined();
    expect(body.statusUrl).toContain(`/api/sites/${SITE}/merge-jobs/`);
    expect(workflow.create).toHaveBeenCalledTimes(1);
  });

  it('adopts an orphaned merging claim (no active job) instead of 409ing forever', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');
    const jobService = await import('../../src/services/merge-job-service');

    // A previous request crashed between its CAS and its job INSERT.
    vi.mocked(services.getMergeRequest).mockResolvedValue(
      makeMergeRequest({ status: 'merging', hasConflicts: false }) as never,
    );
    vi.mocked(jobService.findActiveMergeJob).mockResolvedValue(null);
    vi.mocked(jobService.createMergeJob).mockImplementation(
      async (params: { jobId: string }) => makeJob({ id: params.jobId, status: 'queued' }) as never,
    );
    vi.mocked(jobService.getMergeJob).mockImplementation(
      async (jobId: string) =>
        makeJob({ id: jobId, status: 'completed', processedDocuments: 10, finishedAt: 'x' }) as never,
    );
    const workflow = makeWorkflowBinding();

    const response = await handleMergeRoutes(executeRequest(), runnerContext(workflow) as never);

    expect(response.status).toBe(200);
    // The adopted claim reconstructs the prior status from the MR's own
    // conflict state — hasConflicts:false means it was 'approved'.
    expect(vi.mocked(jobService.createMergeJob)).toHaveBeenCalledWith(
      expect.objectContaining({ priorMrStatus: 'approved' }),
    );
    // No CAS attempt: the MR is already claimed; adoption reuses it.
    expect(vi.mocked(jobService.claimMergeRequestForExecution)).not.toHaveBeenCalled();
    expect(workflow.create).toHaveBeenCalledTimes(1);
  });

  it('re-attaches a workflow driver to a driverless queued job on retry', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');
    const jobService = await import('../../src/services/merge-job-service');

    // A previous request committed the job row but crashed before
    // workflow.create — the job is queued with no driver.
    vi.mocked(services.getMergeRequest).mockResolvedValue(
      makeMergeRequest({ status: 'merging' }) as never,
    );
    const driverless = makeJob({ id: 'job-stranded', status: 'queued', startedAt: null });
    vi.mocked(jobService.findActiveMergeJob).mockResolvedValue(driverless as never);
    const workflow = makeWorkflowBinding();

    const response = await handleMergeRoutes(executeRequest(), runnerContext(workflow) as never);

    // The retry repaired the job AND still reports it via the 409 contract.
    expect(workflow.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-stranded' } satisfies Partial<WorkflowCreateArgs>),
    );
    expect(response.status).toBe(409);
    const body = await readJson<{ details: { jobId: string; statusUrl: string } }>(response);
    expect(body.details.jobId).toBe('job-stranded');
  });

  it('does not re-drive a job that is already running', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');
    const jobService = await import('../../src/services/merge-job-service');

    vi.mocked(services.getMergeRequest).mockResolvedValue(
      makeMergeRequest({ status: 'merging' }) as never,
    );
    vi.mocked(jobService.findActiveMergeJob).mockResolvedValue(
      makeJob({ id: 'job-live', status: 'running' }) as never,
    );
    const workflow = makeWorkflowBinding();

    const response = await handleMergeRoutes(executeRequest(), runnerContext(workflow) as never);

    expect(workflow.create).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    const body = await readJson<{ details: { jobId: string } }>(response);
    expect(body.details.jobId).toBe('job-live');
  });

  it('does not fail the job when workflow.create collides with an existing instance', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');
    const jobService = await import('../../src/services/merge-job-service');

    vi.mocked(services.getMergeRequest).mockResolvedValue(makeMergeRequest() as never);
    vi.mocked(jobService.claimMergeRequestForExecution).mockResolvedValue('approved');
    vi.mocked(jobService.createMergeJob).mockImplementation(
      async (params: { jobId: string }) => makeJob({ id: params.jobId, status: 'queued' }) as never,
    );
    vi.mocked(jobService.getMergeJob).mockImplementation(
      async (jobId: string) =>
        makeJob({ id: jobId, status: 'completed', processedDocuments: 10, finishedAt: 'x' }) as never,
    );
    // A concurrent re-drive won the create race: an instance IS driving this
    // job id. Failing the job here would strand it under a live driver.
    const workflow = {
      create: vi.fn().mockRejectedValue(new Error('instance with id already exists')),
    };

    const response = await handleMergeRoutes(executeRequest(), runnerContext(workflow) as never);

    expect(vi.mocked(jobService.failMergeJob)).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('releases the claim best-effort when the job insert fails after the CAS', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');
    const jobService = await import('../../src/services/merge-job-service');

    vi.mocked(services.getMergeRequest).mockResolvedValue(makeMergeRequest() as never);
    vi.mocked(jobService.claimMergeRequestForExecution).mockResolvedValue('approved');
    vi.mocked(jobService.createMergeJob).mockRejectedValue(new Error('connection terminated'));
    vi.mocked(jobService.restoreMergeRequestClaim).mockResolvedValue(undefined);
    const workflow = makeWorkflowBinding();

    await expect(async () => {
      const response = await handleMergeRoutes(executeRequest(), runnerContext(workflow) as never);
      // handleMergeRoutes maps unknown errors by rethrowing; if it returns,
      // it must not be a success.
      expect(response.status).toBeGreaterThanOrEqual(500);
    }).rejects.toThrow('connection terminated');

    expect(vi.mocked(jobService.restoreMergeRequestClaim)).toHaveBeenCalledWith(MR_ID, 'approved');
    expect(workflow.create).not.toHaveBeenCalled();
  });
});
