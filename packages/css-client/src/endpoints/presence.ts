/**
 * Presence Endpoint
 *
 * API endpoints for querying presence data at site, branch, and agent levels.
 */

import type { BaseEndpoint } from './base.js';
import type {
  SitePresence,
  BranchPresence,
  AgentGlobalPresence,
  UpdateFocusRegionsResponse,
} from '../types.js';

/**
 * Presence endpoint for querying actor presence data.
 */
export class PresenceEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Get site-level presence rollup.
   *
   * Returns summary of all actors present across all branches in a site.
   */
  async getSitePresence(siteId: string): Promise<SitePresence> {
    return this.base.request<SitePresence>(`/api/sites/${siteId}/presence`, {
      method: 'GET',
    });
  }

  /**
   * Get branch-level presence rollup.
   *
   * Returns all actors present on a branch with their current state,
   * intent, and focus regions.
   */
  async getBranchPresence(siteId: string, branchId: string): Promise<BranchPresence> {
    return this.base.request<BranchPresence>(
      `/api/sites/${siteId}/branches/${branchId}/presence`,
      { method: 'GET' }
    );
  }

  /**
   * Get an agent's global presence across an organization.
   *
   * Returns all locations where an agent is currently present.
   */
  async getAgentPresence(orgId: string, agentId: string): Promise<AgentGlobalPresence> {
    return this.base.request<AgentGlobalPresence>(
      `/api/organizations/${orgId}/agents/${agentId}/presence`,
      { method: 'GET' }
    );
  }

  /**
   * Update focus regions for a human user in a document session.
   *
   * Reports which components/regions the user has selected in the editor.
   * This is used for proactive collision detection - agents will avoid
   * editing regions where a human has focus, even if no edits have been made.
   *
   * @param siteId - The site ID
   * @param branchId - The branch ID
   * @param documentPath - The document path (will be URL-encoded)
   * @param actorId - The user's actor ID (identifies who is updating focus)
   * @param focusRegions - Array of JSON paths representing focused regions.
   *                       Pass empty array to clear focus.
   * @returns The confirmed focus regions from the server
   *
   * @remarks
   * - Only users (not agents) can call this endpoint
   * - Maximum 50 focus regions per request
   * - Focus regions expire after 30 seconds without a heartbeat
   */
  async updateFocusRegions(
    siteId: string,
    branchId: string,
    documentPath: string,
    actorId: string,
    focusRegions: string[]
  ): Promise<UpdateFocusRegionsResponse> {
    const encodedPath = encodeURIComponent(documentPath);
    return this.base.request<UpdateFocusRegionsResponse>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}/focus-regions`,
      {
        method: 'POST',
        body: JSON.stringify({ actorId, focusRegions }),
        headers: {
          'X-Actor-Type': 'user',
        },
      }
    );
  }
}
