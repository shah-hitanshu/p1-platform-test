/**
 * Sites Endpoint
 *
 * API operations for sites.
 */

import type { Site, PaginationOptions, SiteMembers, SiteSettingsResult } from '../types/index.js';
import { requirePathParams } from '../utils.js';
import type { BaseEndpoint } from './base.js';

export class SitesEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Get a site by ID.
   */
  async get(siteId: string): Promise<Site> {
    requirePathParams({ siteId }, 'sites.get');

    return this.base.request<Site>(`/api/sites/${siteId}`, {
      method: 'GET',
    });
  }

  /**
   * Get a site's settings, including the locales it publishes in.
   */
  async getSettings(siteId: string): Promise<SiteSettingsResult> {
    requirePathParams({ siteId }, 'sites.getSettings');

    return this.base.request<SiteSettingsResult>(`/api/sites/${siteId}/settings`, {
      method: 'GET',
    });
  }

  /**
   * The people and agents on a site, for pickers. Anyone who can view the site
   * can read its roster.
   */
  async members(siteId: string): Promise<SiteMembers> {
    requirePathParams({ siteId }, 'sites.members');

    return this.base.request<SiteMembers>(`/api/sites/${siteId}/members`, {
      method: 'GET',
    });
  }

  /**
   * List all sites.
   */
  async list(options?: PaginationOptions): Promise<Site[]> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }

    const query = params.toString();
    const path = query ? `/api/sites?${query}` : '/api/sites';

    const response = await this.base.request<{ sites: Site[] }>(path, {
      method: 'GET',
    });

    return response.sites;
  }
}
