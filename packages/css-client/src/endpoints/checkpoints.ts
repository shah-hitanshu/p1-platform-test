/**
 * Checkpoints Endpoint
 *
 * API operations for checkpoints.
 */

import type {
  Checkpoint,
  CheckpointDocument,
  CreateCheckpointParams,
  PaginationOptions,
} from '../types.js';
import type { BaseEndpoint } from './base.js';

export class CheckpointsEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Get a checkpoint by ID.
   */
  async get(siteId: string, checkpointId: string): Promise<Checkpoint> {
    return this.base.request<Checkpoint>(`/api/sites/${siteId}/checkpoints/${checkpointId}`, {
      method: 'GET',
    });
  }

  /**
   * List checkpoints for a branch.
   */
  async list(
    siteId: string,
    branchId: string,
    options?: PaginationOptions
  ): Promise<Checkpoint[]> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }

    const query = params.toString();
    const path = query
      ? `/api/sites/${siteId}/branches/${branchId}/checkpoints?${query}`
      : `/api/sites/${siteId}/branches/${branchId}/checkpoints`;

    const response = await this.base.request<{ checkpoints: Checkpoint[] }>(path, {
      method: 'GET',
    });

    return response.checkpoints;
  }

  /**
   * Create a new checkpoint.
   */
  async create(siteId: string, params: CreateCheckpointParams): Promise<Checkpoint> {
    return this.base.request<Checkpoint>(
      `/api/sites/${siteId}/branches/${params.branchId}/checkpoints`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: params.name,
          type: params.type ?? 'manual',
        }),
      }
    );
  }

  /**
   * Get documents at a checkpoint.
   */
  async getDocuments(siteId: string, checkpointId: string): Promise<CheckpointDocument[]> {
    const response = await this.base.request<{ documents: CheckpointDocument[] }>(
      `/api/sites/${siteId}/checkpoints/${checkpointId}/documents`,
      { method: 'GET' }
    );

    return response.documents;
  }

  /**
   * Revert a branch to a checkpoint.
   */
  async revert(
    siteId: string,
    branchId: string,
    checkpointId: string,
    name?: string
  ): Promise<Checkpoint> {
    return this.base.request<Checkpoint>(
      `/api/sites/${siteId}/branches/${branchId}/checkpoints/${checkpointId}/revert`,
      {
        method: 'POST',
        body: JSON.stringify({ name }),
      }
    );
  }

  /**
   * Delete a checkpoint.
   */
  async delete(siteId: string, checkpointId: string): Promise<void> {
    await this.base.request<void>(`/api/sites/${siteId}/checkpoints/${checkpointId}`, {
      method: 'DELETE',
    });
  }
}
