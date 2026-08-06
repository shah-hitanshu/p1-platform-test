/**
 * Agent Edit Endpoint
 *
 * API endpoints for the agent edit workflow (politeness protocol).
 */

import type {
  AgentEditContext,
  AgentEditPermission,
  AgentEditSession,
  AgentEditCompleteResult,
  AgentEditAbortResult,
  AgentStopResult,
} from '../types.js';
import type { BaseEndpoint } from './base.js';

/**
 * Agent edit endpoint for managing agent edit sessions.
 */
export class AgentEditEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Encode document path for URL.
   * Document paths start with / which needs proper encoding.
   */
  private encodeDocumentPath(documentPath: string): string {
    return encodeURIComponent(documentPath);
  }

  /**
   * Check if an agent can edit a document.
   *
   * Returns whether the agent can proceed and, if not, the reason why.
   *
   * @param siteId - Site ID
   * @param branchId - Branch ID
   * @param documentPath - Document path (e.g., "/home")
   * @param context - Agent edit context (agentId, trigger, intent, targetRegions)
   */
  async canEdit(
    siteId: string,
    branchId: string,
    documentPath: string,
    context: AgentEditContext
  ): Promise<AgentEditPermission> {
    const encodedPath = this.encodeDocumentPath(documentPath);

    return this.base.request<AgentEditPermission>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}/can-agent-edit`,
      {
        method: 'POST',
        body: JSON.stringify({
          agentId: context.agentId,
          trigger: context.trigger,
          requestedById: context.requestedById,
          intent: context.intent,
          targetRegions: context.targetRegions,
          operationType: context.operationType,
        }),
      }
    );
  }

  /**
   * Start an agent edit session.
   *
   * Reserves the edit session, sets focus regions, and optionally creates
   * a checkpoint for autonomous edits.
   *
   * @param siteId - Site ID
   * @param branchId - Branch ID
   * @param documentPath - Document path
   * @param context - Agent edit context
   */
  async startEdit(
    siteId: string,
    branchId: string,
    documentPath: string,
    context: AgentEditContext
  ): Promise<AgentEditSession> {
    const encodedPath = this.encodeDocumentPath(documentPath);

    return this.base.request<AgentEditSession>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}/agent-edit-start`,
      {
        method: 'POST',
        body: JSON.stringify({
          agentId: context.agentId,
          trigger: context.trigger,
          requestedById: context.requestedById,
          intent: context.intent,
          targetRegions: context.targetRegions,
          operationType: context.operationType,
        }),
      }
    );
  }

  /**
   * Complete an agent edit session.
   *
   * Clears focus regions and updates checkpoint status.
   *
   * @param siteId - Site ID
   * @param branchId - Branch ID
   * @param documentPath - Document path
   * @param agentId - Agent ID
   */
  async completeEdit(
    siteId: string,
    branchId: string,
    documentPath: string,
    agentId: string
  ): Promise<AgentEditCompleteResult> {
    const encodedPath = this.encodeDocumentPath(documentPath);

    return this.base.request<AgentEditCompleteResult>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}/agent-edit-complete`,
      {
        method: 'POST',
        body: JSON.stringify({ agentId }),
      }
    );
  }

  /**
   * Abort an agent edit session.
   *
   * Rolls back to the checkpoint created at edit-start.
   *
   * @param siteId - Site ID
   * @param branchId - Branch ID
   * @param documentPath - Document path
   * @param agentId - Agent ID
   * @param checkpointId - Checkpoint to rollback to
   */
  async abortEdit(
    siteId: string,
    branchId: string,
    documentPath: string,
    agentId: string,
    checkpointId: string
  ): Promise<AgentEditAbortResult> {
    const encodedPath = this.encodeDocumentPath(documentPath);

    return this.base.request<AgentEditAbortResult>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}/agent-edit-abort`,
      {
        method: 'POST',
        body: JSON.stringify({ agentId, checkpointId }),
      }
    );
  }

  /**
   * Stop an agent's edit session (human-initiated).
   *
   * Server looks up the agent's active session and rolls back
   * to the checkpoint created at edit-start. This allows humans
   * to stop an agent without knowing the session/checkpoint IDs.
   *
   * @param siteId - Site ID
   * @param branchId - Branch ID
   * @param documentPath - Document path
   * @param agentId - Agent ID to stop
   */
  async stopAgent(
    siteId: string,
    branchId: string,
    documentPath: string,
    agentId: string
  ): Promise<AgentStopResult> {
    const encodedPath = this.encodeDocumentPath(documentPath);

    return this.base.request<AgentStopResult>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}/agent-stop`,
      {
        method: 'POST',
        body: JSON.stringify({ agentId }),
      }
    );
  }
}
