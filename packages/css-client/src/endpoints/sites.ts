/**
 * Sites Endpoint
 *
 * API operations for sites.
 */

import type { Site, PaginationOptions } from '../types.js';
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
