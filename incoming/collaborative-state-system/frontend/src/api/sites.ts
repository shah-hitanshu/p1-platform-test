/**
 * Sites API Module
 */

import type { Site } from '../types';
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

interface SitesResponse {
  sites: Site[];
}

export interface CreateSiteParams {
  name: string;
  pantheonSiteId?: string;
  url?: string;
}

export interface UpdateSiteParams {
  name?: string;
  /** `null` clears the column; omit to leave it unchanged. */
  url?: string | null;
  allowedOrigins?: string[];
}

/**
 * List all sites
 */
export async function listSites(): Promise<Site[]> {
  const response = await apiGet<SitesResponse>('/api/sites');
  return response.sites;
}

/**
 * Get a single site
 */
export async function getSite(siteId: string): Promise<Site> {
  return apiGet<Site>(`/api/sites/${siteId}`);
}

/**
 * Create a new site
 */
export async function createSite(params: CreateSiteParams): Promise<Site> {
  return apiPost<Site>('/api/sites', params);
}

/**
 * Update a site
 */
export async function updateSite(
  siteId: string,
  params: UpdateSiteParams
): Promise<Site> {
  return apiPatch<Site>(`/api/sites/${siteId}`, params);
}

/**
 * Delete a site
 */
export async function deleteSite(siteId: string): Promise<void> {
  return apiDelete(`/api/sites/${siteId}`);
}

/**
 * Sites API object for convenient imports
 */
export const sitesApi = {
  list: listSites,
  get: getSite,
  create: createSite,
  update: updateSite,
  delete: deleteSite,
};
