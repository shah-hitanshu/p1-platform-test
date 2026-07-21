/**
 * Collaborators API Module
 *
 * Endpoints for managing site-level collaborators (user-site roles).
 */

import type { Collaborator } from '../types';
import { apiGet, apiPost, apiDelete } from './client';

interface CollaboratorsResponse {
  collaborators: Collaborator[];
}

export interface AddCollaboratorParams {
  userId: string;
  role: string;
}

/**
 * List all collaborators for a site
 */
export async function listCollaborators(siteId: string): Promise<Collaborator[]> {
  const response = await apiGet<CollaboratorsResponse>(`/api/sites/${siteId}/collaborators`);
  return response.collaborators;
}

/**
 * Add a collaborator to a site
 */
export async function addCollaborator(
  siteId: string,
  params: AddCollaboratorParams,
): Promise<Collaborator> {
  return apiPost<Collaborator>(`/api/sites/${siteId}/collaborators`, params);
}

/**
 * Remove a collaborator from a site (local grants only)
 */
export async function removeCollaborator(
  siteId: string,
  userId: string,
): Promise<void> {
  return apiDelete(`/api/sites/${siteId}/collaborators/${userId}`);
}
