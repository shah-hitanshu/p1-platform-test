/**
 * Migration Conflicts Endpoint
 *
 * API operations for reviewing and resolving template migration conflicts.
 */

import type { MigrationConflict } from '../types.js';
import type { BaseEndpoint } from './base.js';

export class MigrationConflictsEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * List conflicts for a migration job.
   */
  async list(siteId: string, branchId: string, jobId: string): Promise<MigrationConflict[]> {
    const response = await this.base.request<{ conflicts: MigrationConflict[] }>(
      `/api/sites/${siteId}/branches/${branchId}/migrations/${jobId}/conflicts`,
      { method: 'GET' },
    );
    return response.conflicts;
  }

  /**
   * Resolve a conflict with a chosen strategy.
   */
  async resolve(
    siteId: string,
    branchId: string,
    jobId: string,
    conflictId: string,
    resolution: 'apply' | 'skip' | 'manual',
  ): Promise<MigrationConflict> {
    return this.base.request<MigrationConflict>(
      `/api/sites/${siteId}/branches/${branchId}/migrations/${jobId}/conflicts/${conflictId}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      },
    );
  }
}
