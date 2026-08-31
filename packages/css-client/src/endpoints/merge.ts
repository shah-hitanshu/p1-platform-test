/**
 * Merge Endpoint
 *
 * API operations for merge checks, previews, execution, and merge requests.
 */

import type {
  MergeabilityResult,
  MergePreview,
  MergeExecuteParams,
  MergeExecuteResult,
  MergeJob,
  MergeRequest,
  CreateMergeRequestParams,
  UpdateMergeRequestParams,
  ListMergeRequestsOptions,
  ExecuteMergeRequestOptions,
} from '../types.js';
import { TERMINAL_MERGE_JOB_STATUSES } from '../types.js';
import { requirePathParams } from '../utils.js';
import type { BaseEndpoint } from './base.js';

export class MergeEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Check mergeability between two branches.
   */
  async checkMergeability(
    siteId: string,
    sourceBranchId: string,
    targetBranchId: string
  ): Promise<MergeabilityResult> {
    return this.base.request<MergeabilityResult>(
      `/api/sites/${siteId}/merge/check`,
      {
        method: 'POST',
        body: JSON.stringify({ sourceBranchId, targetBranchId }),
      }
    );
  }

  /**
   * Preview a merge between two branches.
   */
  async preview(
    siteId: string,
    sourceBranchId: string,
    targetBranchId: string,
    options?: { includeContent?: boolean; excludePathPrefixes?: string[] }
  ): Promise<MergePreview> {
    return this.base.request<MergePreview>(
      `/api/sites/${siteId}/merge/preview`,
      {
        method: 'POST',
        body: JSON.stringify({
          sourceBranchId,
          targetBranchId,
          ...(options?.includeContent !== undefined && { includeContent: options.includeContent }),
          ...(options?.excludePathPrefixes !== undefined && { excludePathPrefixes: options.excludePathPrefixes }),
        }),
      }
    );
  }

  /**
   * Execute a merge between two branches.
   */
  async execute(
    siteId: string,
    params: MergeExecuteParams
  ): Promise<MergeExecuteResult> {
    return this.base.request<MergeExecuteResult>(
      `/api/sites/${siteId}/merge/execute`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
  }

  /**
   * Create a merge request.
   */
  async createRequest(
    siteId: string,
    params: CreateMergeRequestParams
  ): Promise<MergeRequest> {
    return this.base.request<MergeRequest>(
      `/api/sites/${siteId}/merge-requests`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
  }

  /**
   * Get a merge request by ID.
   */
  async getRequest(
    siteId: string,
    requestId: string
  ): Promise<MergeRequest> {
    requirePathParams({ siteId, requestId }, 'merge.getRequest');

    return this.base.request<MergeRequest>(
      `/api/sites/${siteId}/merge-requests/${requestId}`,
      {
        method: 'GET',
      }
    );
  }

  /**
   * List merge requests for a site.
   */
  async listRequests(
    siteId: string,
    options?: ListMergeRequestsOptions
  ): Promise<MergeRequest[]> {
    const params = new URLSearchParams();
    if (options?.status) {
      params.set('status', options.status);
    }

    const query = params.toString();
    const path = query
      ? `/api/sites/${siteId}/merge-requests?${query}`
      : `/api/sites/${siteId}/merge-requests`;

    const response = await this.base.request<{ mergeRequests: MergeRequest[] }>(path, {
      method: 'GET',
    });

    return response.mergeRequests;
  }

  /**
   * Update a merge request.
   */
  async updateRequest(
    siteId: string,
    requestId: string,
    params: UpdateMergeRequestParams
  ): Promise<MergeRequest> {
    return this.base.request<MergeRequest>(
      `/api/sites/${siteId}/merge-requests/${requestId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(params),
      }
    );
  }

  /**
   * Delete a merge request.
   */
  async deleteRequest(
    siteId: string,
    requestId: string
  ): Promise<void> {
    await this.base.request<void>(
      `/api/sites/${siteId}/merge-requests/${requestId}`,
      {
        method: 'DELETE',
      }
    );
  }

  /**
   * Execute a merge request.
   */
  async executeRequest(
    siteId: string,
    requestId: string,
    options?: ExecuteMergeRequestOptions
  ): Promise<MergeExecuteResult> {
    return this.base.request<MergeExecuteResult>(
      `/api/sites/${siteId}/merge-requests/${requestId}/execute`,
      {
        method: 'POST',
        body: JSON.stringify(options ?? {}),
      }
    );
  }

  /**
   * Get a merge job's status projection.
   */
  async getJob(siteId: string, jobId: string): Promise<MergeJob> {
    return this.base.request<MergeJob>(
      `/api/sites/${siteId}/merge-jobs/${jobId}`,
      { method: 'GET' }
    );
  }

  /**
   * Poll a merge job until it reaches a terminal status.
   *
   * Resolves with the job when it completes; throws when it ends in any
   * other terminal state (failed, completed_with_errors, blocked_on_conflicts,
   * cancelled) or when `timeoutMs` elapses. Use after executeRequest returns
   * the async shape (a jobId with a non-terminal status).
   */
  async waitForJob(
    siteId: string,
    jobId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {}
  ): Promise<MergeJob> {
    const intervalMs = options.intervalMs ?? 2_000;
    const timeoutMs = options.timeoutMs ?? 10 * 60_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const job = await this.getJob(siteId, jobId);
      if (TERMINAL_MERGE_JOB_STATUSES.includes(job.status)) {
        if (job.status === 'completed') {
          return job;
        }
        const failedPaths = job.failedDocumentDetails.map((d) => d.path).join(', ');
        throw new Error(
          `Merge job ${job.status}${job.error !== null ? `: ${job.error}` : ''}` +
            (failedPaths !== '' ? ` (failed documents: ${failedPaths})` : '')
        );
      }
      if (Date.now() + intervalMs > deadline) {
        throw new Error(
          `Timed out waiting for merge job ${jobId} (last status: ${job.status})`
        );
      }
      await new Promise((resolve) => {
        setTimeout(resolve, intervalMs);
      });
    }
  }
}
