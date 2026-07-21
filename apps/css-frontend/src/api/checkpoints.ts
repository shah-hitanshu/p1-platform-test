/**
 * Checkpoints API Module
 */

import type { Checkpoint } from '../types';
import { apiGet, apiPost, apiDelete } from './client';

interface CheckpointsResponse {
  checkpoints: Checkpoint[];
}

interface CreateCheckpointParams {
  name?: string;
  type?: 'manual' | 'auto' | 'merge';
}

/**
 * List checkpoints for a branch
 */
export async function listCheckpoints(
  siteId: string,
  branchId: string
): Promise<Checkpoint[]> {
  const response = await apiGet<CheckpointsResponse>(
    `/api/sites/${siteId}/branches/${branchId}/checkpoints`
  );
  return response.checkpoints;
}

/**
 * Get a single checkpoint
 */
export async function getCheckpoint(
  siteId: string,
  checkpointId: string
): Promise<Checkpoint> {
  return apiGet<Checkpoint>(`/api/sites/${siteId}/checkpoints/${checkpointId}`);
}

/**
 * Create a new checkpoint
 */
export async function createCheckpoint(
  siteId: string,
  branchId: string,
  params?: CreateCheckpointParams
): Promise<Checkpoint> {
  return apiPost<Checkpoint>(
    `/api/sites/${siteId}/branches/${branchId}/checkpoints`,
    params ?? {}
  );
}

/**
 * Delete a checkpoint
 */
export async function deleteCheckpoint(
  siteId: string,
  checkpointId: string
): Promise<void> {
  return apiDelete(`/api/sites/${siteId}/checkpoints/${checkpointId}`);
}

/**
 * Revert branch to a checkpoint
 */
export async function revertToCheckpoint(
  siteId: string,
  branchId: string,
  checkpointId: string,
  name?: string
): Promise<Checkpoint> {
  return apiPost<Checkpoint>(
    `/api/sites/${siteId}/branches/${branchId}/checkpoints/${checkpointId}/revert`,
    name ? { name } : {}
  );
}
