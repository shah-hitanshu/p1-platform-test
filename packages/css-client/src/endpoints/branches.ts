/**
 * Branches Endpoint
 *
 * API operations for branches.
 */

import type { Branch, CreateBranchParams, PaginationOptions } from '../types.js';
import { requirePathParams } from '../utils.js';
import type { BaseEndpoint } from './base.js';

export class BranchesEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Get a branch by ID.
   */
  async get(siteId: string, branchId: string): Promise<Branch> {
    requirePathParams({ siteId, branchId }, 'branches.get');

    return this.base.request<Branch>(`/api/sites/${siteId}/branches/${branchId}`, {
      method: 'GET',
    });
  }

  /**
   * List all branches for a site.
   */
  async list(siteId: string, options?: PaginationOptions): Promise<Branch[]> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }

    const query = params.toString();
    const path = query
      ? `/api/sites/${siteId}/branches?${query}`
      : `/api/sites/${siteId}/branches`;

    const response = await this.base.request<{ branches: Branch[] }>(path, {
      method: 'GET',
    });

    return response.branches;
  }

  /**
   * Create a new branch.
   */
  async create(params: CreateBranchParams): Promise<Branch> {
    return this.base.request<Branch>(`/api/sites/${params.siteId}/branches`, {
      method: 'POST',
      body: JSON.stringify({
        name: params.name,
        sourceBranchId: params.sourceBranchId,
      }),
    });
  }

  /**
   * Archive a branch.
   */
  async archive(siteId: string, branchId: string): Promise<Branch> {
    return this.base.request<Branch>(`/api/sites/${siteId}/branches/${branchId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    });
  }

  /**
   * Delete a branch.
   */
  async delete(siteId: string, branchId: string): Promise<void> {
    await this.base.request<void>(`/api/sites/${siteId}/branches/${branchId}`, {
      method: 'DELETE',
    });
  }
}
