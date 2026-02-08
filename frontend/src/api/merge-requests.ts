/**
 * Merge Requests API Module
 */

import type {
  MergeRequest,
  MergeRequestStatus,
  MergePreview,
  MergeExecuteResult,
  ConflictResolutionStrategy,
} from '../types';
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

interface MergeRequestsResponse {
  mergeRequests: MergeRequest[];
}

interface CreateMergeRequestParams {
  sourceBranchId: string;
  targetBranchId: string;
  title: string;
  description?: string;
}

interface UpdateMergeRequestParams {
  title?: string;
  description?: string;
  status?: MergeRequestStatus;
}

interface MergeabilityResult {
  canMerge: boolean;
  hasConflicts: boolean;
  message?: string;
}

interface MergeabilityParams {
  sourceBranchId: string;
  targetBranchId: string;
}

interface MergePreviewParams {
  sourceBranchId: string;
  targetBranchId: string;
  /** When true, includes full document snapshots and diff operations */
  includeContent?: boolean;
}

interface ConflictResolution {
  documentId: string;
  strategy: ConflictResolutionStrategy;
  resolvedSnapshot?: Record<string, unknown>;
}

interface ExecuteMergeParams {
  mergeRequestId: string;
  resolutions?: ConflictResolution[];
}

/**
 * List merge requests for a site with optional status filter
 */
export async function listMergeRequests(
  siteId: string,
  status?: MergeRequestStatus
): Promise<MergeRequest[]> {
  const url = status
    ? `/api/sites/${siteId}/merge-requests?status=${status}`
    : `/api/sites/${siteId}/merge-requests`;
  const response = await apiGet<MergeRequestsResponse>(url);
  return response.mergeRequests;
}

/**
 * Get a single merge request
 */
export async function getMergeRequest(
  siteId: string,
  requestId: string
): Promise<MergeRequest> {
  return apiGet<MergeRequest>(`/api/sites/${siteId}/merge-requests/${requestId}`);
}

/**
 * Create a new merge request
 */
export async function createMergeRequest(
  siteId: string,
  params: CreateMergeRequestParams
): Promise<MergeRequest> {
  return apiPost<MergeRequest>(`/api/sites/${siteId}/merge-requests`, params);
}

/**
 * Update a merge request
 */
export async function updateMergeRequest(
  siteId: string,
  requestId: string,
  params: UpdateMergeRequestParams
): Promise<MergeRequest> {
  return apiPatch<MergeRequest>(
    `/api/sites/${siteId}/merge-requests/${requestId}`,
    params
  );
}

/**
 * Delete a merge request
 */
export async function deleteMergeRequest(
  siteId: string,
  requestId: string
): Promise<void> {
  return apiDelete(`/api/sites/${siteId}/merge-requests/${requestId}`);
}

/**
 * Check if branches can be merged
 */
export async function checkMergeability(
  siteId: string,
  params: MergeabilityParams
): Promise<MergeabilityResult> {
  return apiPost<MergeabilityResult>(
    `/api/sites/${siteId}/merge-requests/check-mergeability`,
    params
  );
}

/**
 * Request deduplication cache for merge preview
 * Prevents duplicate requests when React Strict Mode causes double-mounting
 */
const pendingPreviews = new Map<string, Promise<MergePreview>>();

/**
 * Preview merge changes between branches
 * Deduplicates simultaneous requests with the same parameters
 */
export async function previewMerge(
  siteId: string,
  params: MergePreviewParams
): Promise<MergePreview> {
  const cacheKey = `${siteId}:${params.sourceBranchId}:${params.targetBranchId}:${params.includeContent ?? false}`;

  // If there's already a pending request for these params, return that promise
  const pending = pendingPreviews.get(cacheKey);
  if (pending) {
    return pending;
  }

  // Create new request and cache the promise
  const requestPromise = apiPost<MergePreview>(
    `/api/sites/${siteId}/merge/preview`,
    params
  ).finally(() => {
    // Remove from cache when request completes (success or error)
    pendingPreviews.delete(cacheKey);
  });

  pendingPreviews.set(cacheKey, requestPromise);
  return requestPromise;
}

/**
 * Execute a merge request
 */
export async function executeMerge(
  siteId: string,
  params: ExecuteMergeParams
): Promise<MergeExecuteResult> {
  return apiPost<MergeExecuteResult>(
    `/api/sites/${siteId}/merge-requests/${params.mergeRequestId}/execute`,
    { resolutions: params.resolutions }
  );
}

/**
 * Result of a CRDT merge preview
 */
interface CrdtPreviewResult {
  success: boolean;
  snapshot: Record<string, unknown>;
  error?: string;
}

interface CrdtPreviewParams {
  documentId: string;
  sourceBranchId: string;
  targetBranchId: string;
}

/**
 * Preview CRDT merge result without committing
 */
export async function previewCrdtMerge(
  siteId: string,
  params: CrdtPreviewParams
): Promise<CrdtPreviewResult> {
  return apiPost<CrdtPreviewResult>(
    `/api/sites/${siteId}/merge/crdt-preview`,
    params
  );
}

export type {
  CreateMergeRequestParams,
  UpdateMergeRequestParams,
  MergeabilityParams,
  MergeabilityResult,
  MergePreviewParams,
  ExecuteMergeParams,
  ConflictResolution,
  CrdtPreviewResult,
  CrdtPreviewParams,
};
