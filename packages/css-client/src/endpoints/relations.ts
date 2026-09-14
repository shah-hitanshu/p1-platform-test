/**
 * Relations Endpoint
 *
 * Operations over the derivation edges of a document (localization and template).
 * The upstream-diff endpoint classifies how the document has drifted from its
 * upstream source so an author can reconcile, and the resolution endpoints record
 * which props have been dealt with so a change is not reported forever.
 */

import type {
  ChangeSummary,
  UpstreamResolutions,
  UpstreamResolutionTarget,
} from '../types.js';
import type { BaseEndpoint } from './base.js';

export class RelationsEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Get the classified upstream drift for a document along one relation type.
   * `documentId` is the derived side of the relation edge (the current page). Rejects
   * with NotFoundError when no edge of that type exists.
   */
  async getUpstreamDiff(
    siteId: string,
    branchId: string,
    documentId: string,
    relationType: 'localization' | 'template',
    includeResolved = false,
  ): Promise<ChangeSummary> {
    const query = new URLSearchParams({ relationType });
    if (includeResolved) {
      query.set('includeResolved', 'true');
    }
    return this.base.request<ChangeSummary>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/upstream-diff?${query.toString()}`,
      { method: 'GET' },
    );
  }

  /**
   * Which of a translation's reported changes have been reconciled against their
   * canonical, and at what canonical version. Rejects with NotFoundError when the
   * document is not a translation.
   */
  async getUpstreamResolutions(
    siteId: string,
    branchId: string,
    documentId: string,
  ): Promise<UpstreamResolutions> {
    return this.base.request<UpstreamResolutions>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/upstream-resolutions`,
      { method: 'GET' },
    );
  }

  /**
   * Records that reported changes have been reconciled, so they stop being
   * reported. Taking the canonical value, writing your own translation of it, and
   * deciding the translation keeps what it has all count as reconciling.
   *
   * `upstreamVersion` is the `toVersion` of the summary the changes were read
   * from, so what gets settled is the state that was shown; a change the canonical
   * made after that stays outstanding. Rejects a version the canonical has not
   * reached, and a slot it no longer holds.
   *
   * Recorded per branch, so reconciling on one branch leaves the others as they
   * were.
   */
  async setUpstreamResolutions(
    siteId: string,
    branchId: string,
    documentId: string,
    targets: UpstreamResolutionTarget[],
    upstreamVersion: number,
  ): Promise<UpstreamResolutions> {
    return this.base.request<UpstreamResolutions>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/upstream-resolutions`,
      { method: 'PUT', body: JSON.stringify({ targets, upstreamVersion }) },
    );
  }

  /** Clears the changes' resolutions, returning them to the outstanding list. */
  async clearUpstreamResolutions(
    siteId: string,
    branchId: string,
    documentId: string,
    targets: UpstreamResolutionTarget[],
  ): Promise<UpstreamResolutions> {
    return this.base.request<UpstreamResolutions>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/upstream-resolutions`,
      { method: 'DELETE', body: JSON.stringify({ targets }) },
    );
  }
}
