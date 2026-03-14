/**
 * Merge Endpoint
 *
 * API operations for merge checks, previews, execution, and merge requests.
 */

import type {
  MergeabilityResult,
  MergePreview,
  CrdtPreviewResult,
  MergeExecuteParams,
  MergeExecuteResult,
  MergeRequest,
  CreateMergeRequestParams,
  UpdateMergeRequestParams,
  ListMergeRequestsOptions,
  ExecuteMergeRequestOptions,
} from '../types.js';
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
    options?: { includeContent?: boolean }
  ): Promise<MergePreview> {
    return this.base.request<MergePreview>(
      `/api/sites/${siteId}/merge/preview`,
      {
        method: 'POST',
        body: JSON.stringify({
          sourceBranchId,
          targetBranchId,
          ...(options?.includeContent !== undefined && { includeContent: options.includeContent }),
        }),
      }
    );
  }

  /**
   * Get a CRDT auto-merge preview for a single document.
   */
  async crdtPreview(
    siteId: string,
    documentId: string,
    sourceBranchId: string,
    targetBranchId: string
  ): Promise<CrdtPreviewResult> {
    return this.base.request<CrdtPreviewResult>(
      `/api/sites/${siteId}/merge/crdt-preview`,
      {
        method: 'POST',
        body: JSON.stringify({ documentId, sourceBranchId, targetBranchId }),
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
}
