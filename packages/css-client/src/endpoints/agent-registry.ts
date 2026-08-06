/**
 * Agent Registry Endpoint
 *
 * API endpoints for managing registered agents in an organization.
 */

import type {
  RegisteredAgent,
  CreateAgentParams,
  UpdateAgentParams,
  ListAgentsOptions,
  AgentStatus,
} from '../types.js';
import type { BaseEndpoint } from './base.js';

/**
 * Agent registry endpoint for managing organization agents.
 */
export class AgentRegistryEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * List all agents in an organization.
   *
   * @param orgId - Organization ID
   * @param options - Optional filters (status)
   */
  async list(orgId: string, options?: ListAgentsOptions): Promise<RegisteredAgent[]> {
    let path = `/api/organizations/${orgId}/agents`;

    if (options?.status) {
      const params = new URLSearchParams();
      params.set('status', options.status);
      path += `?${params.toString()}`;
    }

    const response = await this.base.request<{ agents: RegisteredAgent[] }>(path, {
      method: 'GET',
    });

    return response.agents;
  }

  /**
   * Get a specific agent by ID.
   *
   * @param orgId - Organization ID
   * @param agentId - Agent ID
   */
  async get(orgId: string, agentId: string): Promise<RegisteredAgent> {
    return this.base.request<RegisteredAgent>(
      `/api/organizations/${orgId}/agents/${agentId}`,
      { method: 'GET' }
    );
  }

  /**
   * Create a new agent in an organization.
   *
   * @param orgId - Organization ID
   * @param params - Agent creation parameters
   */
  async create(orgId: string, params: CreateAgentParams): Promise<RegisteredAgent> {
    return this.base.request<RegisteredAgent>(`/api/organizations/${orgId}/agents`, {
      method: 'POST',
      body: JSON.stringify({
        name: params.name,
        description: params.description,
        capabilities: params.capabilities,
        settings: params.settings,
      }),
    });
  }

  /**
   * Update an agent's properties.
   *
   * @param orgId - Organization ID
   * @param agentId - Agent ID
   * @param params - Properties to update
   */
  async update(
    orgId: string,
    agentId: string,
    params: UpdateAgentParams
  ): Promise<RegisteredAgent> {
    return this.base.request<RegisteredAgent>(
      `/api/organizations/${orgId}/agents/${agentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(params),
      }
    );
  }

  /**
   * Update an agent's status.
   *
   * @param orgId - Organization ID
   * @param agentId - Agent ID
   * @param status - New status (active, suspended, disabled)
   */
  async updateStatus(
    orgId: string,
    agentId: string,
    status: AgentStatus
  ): Promise<RegisteredAgent> {
    return this.base.request<RegisteredAgent>(
      `/api/organizations/${orgId}/agents/${agentId}/status`,
      {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }
    );
  }

  /**
   * Delete an agent.
   *
   * @param orgId - Organization ID
   * @param agentId - Agent ID
   */
  async delete(orgId: string, agentId: string): Promise<void> {
    await this.base.request<void>(`/api/organizations/${orgId}/agents/${agentId}`, {
      method: 'DELETE',
    });
  }
}
