/**
 * Merge Job Runner routes [PCC-3737].
 *
 * The HTTP surface of the merge job runner, split out of merge-api.ts so the
 * request/response shaping for jobs lives in one place: flag-gated execute
 * paths (CAS -> job -> workflow -> bounded wait), the job status/cancel
 * endpoints, and the self-healing recovery for execute-route crash windows.
 * The merge logic itself lives in services/merge-job-service (step bodies)
 * and workflows/merge-workflow (the durable driver).
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import { getMergeRequest } from '../services';
import { assertPermission } from '../auth/authorization';
import {
  createMergeJob,
  findActiveMergeJob,
  getMergeJob,
  getMergeJobProjection,
  requestMergeJobCancel,
  claimMergeRequestForExecution,
  restoreMergeRequestClaim,
  failMergeJob,
  ActiveMergeJobExistsError,
  TERMINAL_MERGE_JOB_STATUSES,
} from '../services/merge-job-service';
import type { MergeJob } from '../services/merge-job-service';
import type { ConflictResolutionStrategy } from '../types';
import type {
  MergeRouteContext,
  MergeExecuteBody,
  ExecuteMergeRequestBody,
} from './merge-api';

/** Same per-file response helpers as every route module in this worker. */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status: number, details?: unknown): Response {
  return jsonResponse({ error, details }, status);
}

async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  return json as T;
}

const BOUNDED_WAIT_MS_DEFAULT = 15_000;
const BOUNDED_WAIT_POLL_MS = 1_000;
const BOUNDED_WAIT_POLL_MAX_MS = 5_000;

/**
 * Poll the job row until it reaches a terminal state or the window closes.
 * Small merges finish inside the window and keep the legacy response shape;
 * large merges get a 202 + jobId. Stays well inside the 30 s GCLB window.
 */
async function waitForTerminalJob(
  jobId: string,
  boundedWaitMs: number,
): Promise<MergeJob | null> {
  const deadline = Date.now() + boundedWaitMs;
  // Backoff (1s, 2s, … capped at 5s): the wait runs on the request's own
  // pooled connection, so fewer idle polls while it is held.
  let pollMs = BOUNDED_WAIT_POLL_MS;
  for (;;) {
    const job = await getMergeJob(jobId);
    if (job !== null && (TERMINAL_MERGE_JOB_STATUSES as readonly string[]).includes(job.status)) {
      return job;
    }
    if (Date.now() + pollMs > deadline) {
      return job;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, pollMs);
    });
    pollMs = Math.min(pollMs + BOUNDED_WAIT_POLL_MS, BOUNDED_WAIT_POLL_MAX_MS);
  }
}

/**
 * The one shape every async answer uses: the 202 accepted body and the
 * details of every 409 are this same pointer, so clients implement exactly
 * one "a job is running, here is how to follow it" contract.
 */
interface MergeJobPointerBody {
  jobId: string;
  status: string;
  totalDocuments: number;
  processedDocuments: number;
  statusUrl: string;
}

function mergeJobPointer(
  context: MergeRouteContext,
  job: MergeJob | null,
  jobId: string,
): MergeJobPointerBody {
  return {
    jobId,
    status: job?.status ?? 'queued',
    totalDocuments: job?.totalDocuments ?? 0,
    processedDocuments: job?.processedDocuments ?? 0,
    statusUrl: `/api/sites/${context.siteId}/merge-jobs/${jobId}`,
  };
}

function acceptedJobResponse(context: MergeRouteContext, job: MergeJob | null, jobId: string): Response {
  return jsonResponse(mergeJobPointer(context, job, jobId), 202);
}

/**
 * 409 body for the collision error, resolved to the full pointer shape.
 * Message is merge-request-agnostic: this collision also fires for MR-less
 * direct merges (the branch-pair unique index). The point read is best-effort
 * — a DB hiccup here must not turn a well-understood 409 into a 500.
 */
export async function activeMergeJobConflictResponse(
  context: MergeRouteContext,
  error: ActiveMergeJobExistsError,
): Promise<Response> {
  let active: MergeJob | null = null;
  if (error.activeJobId !== null) {
    try {
      active = await getMergeJob(error.activeJobId);
    } catch {
      // Fall through to the id-only details below.
    }
  }
  return errorResponse(
    'A merge job is already running for this merge',
    409,
    active !== null
      ? mergeJobPointer(context, active, active.id)
      : { jobId: error.activeJobId },
  );
}

/** Renders a terminal job in the legacy execute-response shape (+ jobId). */
async function terminalJobResponse(
  context: MergeRouteContext,
  job: MergeJob,
): Promise<Response> {
  switch (job.status) {
    case 'completed':
      return jsonResponse({
        success: true,
        ...(job.mergeRequestId !== null ? { mergeRequestId: job.mergeRequestId } : {}),
        jobId: job.id,
        checkpointId: job.postMergeCheckpointId ?? undefined,
        documentsUpdated: job.processedDocuments,
        ...(job.publishCheckpointId !== null ? { publishCheckpointId: job.publishCheckpointId } : {}),
        ...(job.publishError !== null ? { publishError: job.publishError } : {}),
      });
    case 'completed_with_errors': {
      // Not a success: nothing finalized, MR restored. Non-2xx because every
      // existing caller (css-client resolves any 2xx; MCP throws on !ok)
      // gates on the status code alone — a 200 {success:false} reads as a
      // successful merge to all of them. 500 matches the inline path's
      // MergeExecutionError contract.
      const projection = await getMergeJobProjection(job.id, context.siteId);
      return errorResponse('Merge completed with document failures; merge not finalized', 500, {
        ...mergeJobPointer(context, job, job.id),
        ...(projection !== null ? { failedDocuments: projection.failedDocumentDetails } : {}),
      });
    }
    case 'blocked_on_conflicts': {
      // Mirror the inline path's MergeConflictsError contract.
      let conflictCount = 0;
      if (job.mergeRequestId !== null) {
        const mergeRequest = await getMergeRequest(job.mergeRequestId);
        conflictCount = mergeRequest?.conflictDetails?.documentConflicts.length ?? 0;
      }
      return errorResponse('Merge has unresolved conflicts', 409, {
        ...(job.mergeRequestId !== null ? { mergeRequestId: job.mergeRequestId } : {}),
        jobId: job.id,
        conflictCount,
      });
    }
    case 'failed':
      return errorResponse(job.error ?? 'Merge job failed', 500, { jobId: job.id });
    case 'cancelled':
      return jsonResponse({ jobId: job.id, status: 'cancelled' });
    default:
      return acceptedJobResponse(context, job, job.id);
  }
}

/**
 * Another job holds the active slot. If it lost its driver (crash between its
 * INSERT and workflow.create), re-attach one — the retry is the repair. The
 * active job owns the MR status from here; its own epilogues restore it.
 */
async function recoverFromCreateCollision(
  context: MergeRouteContext,
  error: ActiveMergeJobExistsError,
): Promise<void> {
  if (error.activeJobId === null) {
    return;
  }
  const active = await getMergeJob(error.activeJobId);
  if (active !== null) {
    await redriveIfDriverless(context, active);
  }
}

/**
 * Releases this request's 'merging' claim without masking the original
 * failure. (The rare race where the claim is released under a live adopter
 * self-corrects: the next execute re-claims and its probes absorb all
 * completed work.)
 */
async function releaseClaimBestEffort(params: RunnerExecuteParams): Promise<void> {
  if (params.mergeRequestId === undefined || params.priorMrStatus === undefined) {
    return;
  }
  try {
    await restoreMergeRequestClaim(params.mergeRequestId, params.priorMrStatus);
  } catch (error) {
    getLogger().warn('merge claim release failed; adoption on retry covers it', {
      merge_request_id: params.mergeRequestId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }
}

interface RunnerExecuteParams {
  mergeRequestId?: string;
  priorMrStatus?: 'approved' | 'conflicted';
  sourceBranchId: string;
  targetBranchId: string;
  resolutionStrategy?: ConflictResolutionStrategy;
  resolutions?: {
    documentId: string;
    strategy: ConflictResolutionStrategy;
    resolvedSnapshot?: Record<string, unknown>;
  }[];
}

/**
 * Shared runner trigger: job row + workflow instance + bounded wait.
 * The workflow instance id IS the job id, so a lost response followed by a
 * client retry collides on create() instead of double-running (design §7).
 */
async function executeViaRunner(
  context: MergeRouteContext,
  params: RunnerExecuteParams,
): Promise<Response> {
  if (context.mergeWorkflow === undefined) {
    return errorResponse('Merge job runner is not configured', 503);
  }

  const jobId = crypto.randomUUID();
  let job: MergeJob;
  try {
    job = await createMergeJob({
      jobId,
      mergeRequestId: params.mergeRequestId,
      siteId: context.siteId,
      sourceBranchId: params.sourceBranchId,
      targetBranchId: params.targetBranchId,
      priorMrStatus: params.priorMrStatus,
      resolutionStrategy: params.resolutionStrategy,
      resolutions: params.resolutions,
      triggeredById: context.principal.dbUserId ?? context.principal.id,
      triggeredByType: context.principal.type as 'user' | 'agent',
    });
  } catch (error) {
    if (error instanceof ActiveMergeJobExistsError) {
      await recoverFromCreateCollision(context, error);
    }
    // Whatever failed, this request's claim must not strand the MR in
    // 'merging'. If the DB is fully down the release fails too, and the
    // orphaned claim is adopted by the next execute attempt instead of
    // needing manual repair.
    await releaseClaimBestEffort(params);
    throw error; // ActiveMergeJobExistsError maps to a pointer-shaped 409
  }

  try {
    await context.mergeWorkflow.create({ id: jobId, params: { jobId } });
  } catch (error) {
    if (error instanceof Error && /already exists/i.test(error.message)) {
      // A concurrent request's re-drive won the create race: an instance IS
      // driving this exact job id. Proceed to the wait — failing the job here
      // would strand it under a live driver.
      getLogger().warn('merge workflow instance already existed at create', { job_id: jobId });
    } else {
      // Job row exists but no engine will drive it: mark failed (restores the
      // MR to its prior status) and let the client retry cleanly.
      getLogger().error('merge workflow create failed', error, { job_id: jobId });
      await failMergeJob(jobId, 'workflow create failed');
      return errorResponse('Failed to start merge job', 503, { jobId });
    }
  }

  // From here on the workflow is running detached: a failure while POLLING is
  // not an execute failure. If the DB (or anything else) dies mid-wait,
  // answer with the async shape — the client has the jobId and the workflow
  // rides out the outage on its own retries.
  try {
    const terminal = await waitForTerminalJob(
      jobId,
      context.boundedWaitMs ?? BOUNDED_WAIT_MS_DEFAULT,
    );
    if (terminal !== null && (TERMINAL_MERGE_JOB_STATUSES as readonly string[]).includes(terminal.status)) {
      return await terminalJobResponse(context, terminal);
    }
    return acceptedJobResponse(context, terminal ?? job, jobId);
  } catch (error) {
    getLogger().warn('merge job status poll failed during bounded wait', {
      job_id: jobId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return acceptedJobResponse(context, job, jobId);
  }
}

/**
 * A queued job whose plan step never stamped started_at may have lost its
 * workflow driver (a crash between the job INSERT and workflow.create()).
 * create() with the job id is idempotent — an existing instance makes it
 * throw — so re-attaching a driver from a later request is always safe, and
 * the retry itself becomes the repair (design §7 gate 3).
 */
async function redriveIfDriverless(context: MergeRouteContext, job: MergeJob): Promise<void> {
  if (job.status !== 'queued' || job.startedAt !== null || context.mergeWorkflow === undefined) {
    return;
  }
  try {
    await context.mergeWorkflow.create({ id: job.id, params: { jobId: job.id } });
    getLogger().warn('re-attached workflow driver to a driverless merge job', { job_id: job.id });
  } catch (error) {
    // Usually: an instance already exists (another request re-drove first, or
    // the original create actually landed) and the job is being driven. The
    // exception is an instance that errored out terminally with the job row
    // still queued — instance ids are never reusable, so that job cannot be
    // re-driven and stays visible via this warn until ops fail it.
    getLogger().warn('merge job re-drive did not attach', {
      job_id: job.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }
}

/**
 * 409 for an MR with an active job, carrying the job id so the caller can
 * poll it (design §7) — without this, a client whose execute response was
 * lost has no way to recover the job id. Returns null when NO active job
 * exists, so the caller can adopt an orphaned 'merging' claim instead of
 * 409ing forever.
 */
async function respondForActiveMergeJob(
  context: MergeRouteContext,
  mergeRequest: { id: string; sourceBranchId: string; targetBranchId: string },
): Promise<Response | null> {
  const active = await findActiveMergeJob({
    mergeRequestId: mergeRequest.id,
    siteId: context.siteId,
    sourceBranchId: mergeRequest.sourceBranchId,
    targetBranchId: mergeRequest.targetBranchId,
  });
  if (active === null) {
    return null;
  }
  await redriveIfDriverless(context, active);
  return errorResponse(
    'Merge request is already being executed',
    409,
    mergeJobPointer(context, active, active.id),
  );
}

/** Runner path for POST /merge-requests/{id}/execute. */
export async function handleExecuteMergeRequestViaRunner(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  if (context.mergeRequestId === undefined) {
    return errorResponse('Merge request ID is required', 400);
  }

  const mergeRequest = await getMergeRequest(context.mergeRequestId);
  if (mergeRequest === null) {
    return errorResponse('Merge request not found', 404);
  }

  await assertPermission(context.principal, context.siteId, mergeRequest.sourceBranchId, 'canMerge');

  let resolutions: ExecuteMergeRequestBody['resolutions'];
  try {
    const body = await parseJsonBody<ExecuteMergeRequestBody>(request);
    resolutions = body.resolutions;
  } catch {
    resolutions = undefined;
  }

  let priorStatus: 'approved' | 'conflicted';
  if (mergeRequest.status === 'approved' || mergeRequest.status === 'conflicted') {
    // Route-level CAS: the primary serialization gate (design §7). The loser
    // of a race 409s with the active job when one exists.
    const claimed = await claimMergeRequestForExecution(context.mergeRequestId);
    if (claimed === null) {
      const activeResponse = await respondForActiveMergeJob(context, mergeRequest);
      if (activeResponse !== null) {
        return activeResponse;
      }
      // Claim lost but no job visible yet: the winner is between its CAS and
      // its job INSERT (milliseconds). Retrying lands on the 409-with-jobId
      // or, if the winner crashed in that window, on the adoption path below.
      return errorResponse('Merge request is already being executed; retry shortly', 409);
    }
    priorStatus = claimed;
  } else if (mergeRequest.status === 'merging') {
    const activeResponse = await respondForActiveMergeJob(context, mergeRequest);
    if (activeResponse !== null) {
      return activeResponse;
    }
    // Orphaned claim: 'merging' with no active job means a previous request
    // crashed between its CAS and its job INSERT. Adopt the claim and
    // re-drive — the active-job unique index still serializes concurrent
    // adopters. The prior status is reconstructed the way the system assigns
    // it: an MR carrying conflict state was 'conflicted'.
    getLogger().warn('adopting orphaned merging claim', {
      merge_request_id: mergeRequest.id,
    });
    priorStatus = mergeRequest.hasConflicts ? 'conflicted' : 'approved';
  } else {
    return errorResponse(
      `Cannot execute merge request with status '${mergeRequest.status}'. Must be 'approved' or 'conflicted'.`,
      400,
    );
  }

  return await executeViaRunner(context, {
    mergeRequestId: context.mergeRequestId,
    priorMrStatus: priorStatus,
    sourceBranchId: mergeRequest.sourceBranchId,
    targetBranchId: mergeRequest.targetBranchId,
    ...(resolutions !== undefined && resolutions.length > 0
      ? {
        // Default for conflicts without a per-document resolution, matching
        // the inline path's behavior.
        resolutionStrategy: 'take-source',
        resolutions,
      }
      : {}),
  });
}

/** Runner path for POST /merge/execute (direct branch merge, MR-less job). */
export async function handleExecuteMergeViaRunner(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<MergeExecuteBody>(request);

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  await assertPermission(context.principal, context.siteId, body.sourceBranchId, 'canMerge');

  return await executeViaRunner(context, {
    sourceBranchId: body.sourceBranchId,
    targetBranchId: body.targetBranchId,
    ...(body.conflictResolutions !== undefined && body.conflictResolutions.length > 0
      ? { resolutions: body.conflictResolutions }
      : {}),
  });
}

/** GET /api/sites/{siteId}/merge-jobs/{jobId} — the status projection. */
export async function handleGetMergeJob(
  context: MergeRouteContext,
  mainBranchId: string,
): Promise<Response> {
  if (context.mergeJobId === undefined) {
    return errorResponse('Merge job ID is required', 400);
  }
  await assertPermission(context.principal, context.siteId, mainBranchId, 'canView');

  const projection = await getMergeJobProjection(context.mergeJobId, context.siteId);
  if (projection === null) {
    return errorResponse('Merge job not found', 404);
  }
  return jsonResponse(projection);
}

/** POST /api/sites/{siteId}/merge-jobs/{jobId}/cancel — cooperative cancel. */
export async function handleCancelMergeJob(
  context: MergeRouteContext,
  mainBranchId: string,
): Promise<Response> {
  if (context.mergeJobId === undefined) {
    return errorResponse('Merge job ID is required', 400);
  }
  await assertPermission(context.principal, context.siteId, mainBranchId, 'canMerge');

  const projection = await getMergeJobProjection(context.mergeJobId, context.siteId);
  if (projection === null) {
    return errorResponse('Merge job not found', 404);
  }
  const requested = await requestMergeJobCancel(context.mergeJobId, context.siteId);
  if (!requested) {
    return errorResponse('Merge job is not active', 409, { status: projection.status });
  }
  return jsonResponse({ jobId: context.mergeJobId, cancelRequested: true });
}
