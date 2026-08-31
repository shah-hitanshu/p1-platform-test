/**
 * Relations Endpoint
 *
 * Read operations over the derivation edges of a document (localization and
 * template). The upstream-diff endpoint classifies how the document has drifted
 * from its upstream source so an author can reconcile.
 */

import type { ChangeSummary } from '../types.js';
import type { BaseEndpoint } from './base.js';

export class RelationsEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Get the classified upstream drift for a document along one relation type.
   * `documentId` is the source of the relation edge (the current page). Rejects
   * with NotFoundError when no edge of that type exists.
   */
  async getUpstreamDiff(
    siteId: string,
    branchId: string,
    documentId: string,
    relationType: 'localization' | 'template',
  ): Promise<ChangeSummary> {
    return this.base.request<ChangeSummary>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/upstream-diff?relationType=${relationType}`,
      { method: 'GET' },
    );
  }
}
