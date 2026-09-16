import type { ViewerRole } from '../auth.js';
import { requirePathParams } from '../utils.js';
import type { BaseEndpoint } from './base.js';

export class AuthEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  async getRole(siteId: string, branchId: string): Promise<ViewerRole> {
    requirePathParams({ siteId, branchId }, 'auth.getRole');
    return this.base.request<ViewerRole>(
      `/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/auth/role`,
      { method: 'GET' },
    );
  }
}
