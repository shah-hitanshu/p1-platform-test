/**
 * Agents API Module
 *
 * Endpoints for managing agents, their API keys, and site-level roles.
 */

import type { RegisteredAgent, AgentApiKey, AgentSiteRole } from '../types';
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// Agent CRUD
// ---------------------------------------------------------------------------

interface AgentsResponse {
  agents: RegisteredAgent[];
}

export interface RegisterAgentParams {
  name: string;
  description?: string;
  capabilities?: string[];
}

/**
 * List all agents in the default organization
 */
export async function listAgents(): Promise<RegisteredAgent[]> {
  const response = await apiGet<AgentsResponse>(
    `/api/organizations/${DEFAULT_ORG_ID}/agents`,
  );
  return response.agents;
}

/**
 * Register a new agent
 */
export async function registerAgent(
  params: RegisterAgentParams,
): Promise<RegisteredAgent> {
  return apiPost<RegisteredAgent>(
    `/api/organizations/${DEFAULT_ORG_ID}/agents`,
    params,
  );
}

/**
 * Update an agent's status
 */
export async function updateAgentStatus(
  agentId: string,
  status: 'active' | 'suspended' | 'disabled',
): Promise<RegisteredAgent> {
  return apiPatch<RegisteredAgent>(
    `/api/organizations/${DEFAULT_ORG_ID}/agents/${agentId}/status`,
    { status },
  );
}

/**
 * Delete an agent
 */
export async function deleteAgent(agentId: string): Promise<void> {
  return apiDelete(`/api/organizations/${DEFAULT_ORG_ID}/agents/${agentId}`);
}

// ---------------------------------------------------------------------------
// Agent API Keys
// ---------------------------------------------------------------------------

interface AgentKeysResponse {
  keys: AgentApiKey[];
}

export interface GenerateAgentKeyResult {
  key: string;
  metadata: AgentApiKey;
}

/**
 * List all API keys for an agent
 */
export async function listAgentKeys(agentId: string): Promise<AgentApiKey[]> {
  const response = await apiGet<AgentKeysResponse>(
    `/api/agents/${agentId}/keys`,
  );
  return response.keys;
}

/**
 * Generate a new API key for an agent
 */
export async function generateAgentKey(
  agentId: string,
  params: { name: string },
): Promise<GenerateAgentKeyResult> {
  return apiPost<GenerateAgentKeyResult>(
    `/api/agents/${agentId}/keys`,
    params,
  );
}

/**
 * Revoke an API key from an agent
 */
export async function revokeAgentKey(
  agentId: string,
  keyId: string,
): Promise<void> {
  return apiDelete(`/api/agents/${agentId}/keys/${keyId}`);
}

// ---------------------------------------------------------------------------
// Agent Site Roles
// ---------------------------------------------------------------------------

interface AgentRolesResponse {
  roles: AgentSiteRole[];
}

/**
 * List all site roles for an agent
 */
export async function listAgentRoles(
  agentId: string,
): Promise<AgentSiteRole[]> {
  const response = await apiGet<AgentRolesResponse>(
    `/api/agents/${agentId}/roles`,
  );
  return response.roles;
}

/**
 * Grant a site role to an agent
 */
export async function grantAgentRole(
  agentId: string,
  params: { siteId: string; role: 'viewer' | 'editor' | 'admin' },
): Promise<AgentSiteRole> {
  return apiPost<AgentSiteRole>(`/api/agents/${agentId}/roles`, params);
}

/**
 * Revoke a site role from an agent
 */
export async function revokeAgentRole(
  agentId: string,
  roleId: string,
): Promise<void> {
  return apiDelete(`/api/agents/${agentId}/roles/${roleId}`);
}

// ---------------------------------------------------------------------------
// Site-Scoped Agent Roles (used on SiteDetailPage)
// ---------------------------------------------------------------------------

/**
 * List agent roles on a specific site
 */
export async function listSiteAgentRoles(
  siteId: string,
): Promise<AgentSiteRole[]> {
  const response = await apiGet<AgentRolesResponse>(
    `/api/sites/${siteId}/agent-roles`,
  );
  return response.roles;
}

/**
 * Grant an agent a role on a site (site-scoped)
 */
export async function grantSiteAgentRole(
  siteId: string,
  params: { agentId: string; role: string },
): Promise<AgentSiteRole> {
  return apiPost<AgentSiteRole>(`/api/sites/${siteId}/agent-roles`, params);
}

/**
 * Revoke an agent role on a site (site-scoped)
 */
export async function revokeSiteAgentRole(
  siteId: string,
  roleId: string,
): Promise<void> {
  return apiDelete(`/api/sites/${siteId}/agent-roles/${roleId}`);
}
