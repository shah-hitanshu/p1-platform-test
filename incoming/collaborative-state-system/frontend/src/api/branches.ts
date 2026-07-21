/**
 * Branches API Module
 */

import type { Branch } from '../types';
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

interface BranchesResponse {
  branches: Branch[];
}

interface CreateBranchParams {
  name: string;
}

interface UpdateBranchParams {
  name?: string;
  status?: Branch['status'];
}

/**
 * List branches for a site
 */
export async function listBranches(siteId: string): Promise<Branch[]> {
  const response = await apiGet<BranchesResponse>(
    `/api/sites/${siteId}/branches`
  );
  return response.branches;
}

/**
 * Get a single branch
 */
export async function getBranch(
  siteId: string,
  branchId: string
): Promise<Branch> {
  return apiGet<Branch>(`/api/sites/${siteId}/branches/${branchId}`);
}

/**
 * Create a new branch
 */
export async function createBranch(
  siteId: string,
  params: CreateBranchParams
): Promise<Branch> {
  return apiPost<Branch>(`/api/sites/${siteId}/branches`, params);
}

/**
 * Update a branch
 */
export async function updateBranch(
  siteId: string,
  branchId: string,
  params: UpdateBranchParams
): Promise<Branch> {
  return apiPatch<Branch>(`/api/sites/${siteId}/branches/${branchId}`, params);
}

/**
 * Delete a branch
 */
export async function deleteBranch(
  siteId: string,
  branchId: string
): Promise<void> {
  return apiDelete(`/api/sites/${siteId}/branches/${branchId}`);
}
