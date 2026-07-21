/**
 * Site Settings API Module
 *
 * Endpoints for managing per-site configuration (cache TTLs, etc.).
 */

import { apiGet, apiPatch } from './client';

export interface SiteSettings {
  cacheTtlMain?: number;
  cacheTtlBranch?: number;
}

/**
 * Get settings for a site
 */
export async function getSiteSettings(siteId: string): Promise<SiteSettings> {
  return apiGet<SiteSettings>(`/api/sites/${siteId}/settings`);
}

/**
 * Update settings for a site (partial update)
 */
export async function updateSiteSettings(
  siteId: string,
  settings: Partial<SiteSettings>,
): Promise<SiteSettings> {
  return apiPatch<SiteSettings>(`/api/sites/${siteId}/settings`, settings);
}
