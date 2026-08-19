/**
 * Agent Politeness System - Phase 1.4: Agent Registry Service
 *
 * CRUD operations for Registered Agents.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * @see collaborative-state-system-architecture-v2.3.md Section "Agent Politeness System"
 */

import type { RegisteredAgent, AgentSettings, AgentStatus } from '../types';
import { query } from '../db';
import {
  InvalidAgentParamsError,
  DuplicateAgentNameError,
  OrganizationNotFoundError,
  DuplicateAgentIdError,
} from './errors';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new agent.
 */
export interface CreateAgentParams {
  /** Optional custom ID. If not provided, a UUID will be auto-generated. */
  id?: string;
  organizationId: string;
  name: string;
  description?: string;
  capabilities?: string[];
  settings?: Partial<AgentSettings>;
}

/**
 * Parameters for updating an agent.
 */
export interface UpdateAgentParams {
  name?: string;
  description?: string;
  capabilities?: string[];
  settings?: Partial<AgentSettings>;
}

/**
 * Options for listing agents.
 */
export interface ListAgentsOptions {
  limit?: number;
  offset?: number;
  status?: AgentStatus;
}

/**
 * Options for getting agents by organization.
 */
export interface GetAgentsByOrganizationOptions {
  status?: AgentStatus;
}

/**
 * Database row format for agents.
 */
interface AgentRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  capabilities: string[];
  status: AgentStatus;
  settings: AgentSettings | string;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default agent settings.
 */
const DEFAULT_AGENT_SETTINGS: AgentSettings = {};

/**
 * Default agent capabilities.
 */
const DEFAULT_CAPABILITIES: string[] = [];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parses agent settings from database.
 * Handles both string and object formats for JSONB columns.
 */
function parseSettings(value: AgentSettings | string): AgentSettings {
  if (typeof value === 'string') {
    return JSON.parse(value) as AgentSettings;
  }
  return value;
}

/**
 * Maps a database row to a RegisteredAgent domain object.
 */
function mapRowToAgent(row: AgentRow): RegisteredAgent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description ?? undefined,
    capabilities: row.capabilities,
    status: row.status,
    settings: parseSettings(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Checks if an error is a PostgreSQL foreign key constraint violation.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23503'
  );
}

/**
 * Checks if an error is a PostgreSQL unique constraint violation.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23505'
  );
}

/**
 * Validates agent name.
 */
function validateName(name: string | undefined): void {
  if (name?.trim() === '') {
    throw new InvalidAgentParamsError('Agent name cannot be empty.');
  }
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Creates a new agent.
 *
 * @param params - Agent creation parameters (id is optional - if not provided, a UUID is generated)
 * @returns The created agent
 * @throws InvalidAgentParamsError if name is empty
 * @throws OrganizationNotFoundError if organization does not exist
 * @throws DuplicateAgentIdError if custom agent ID already exists
 * @throws DuplicateAgentNameError if agent name already exists in organization
 */
export async function createAgent(params: CreateAgentParams): Promise<RegisteredAgent> {
  validateName(params.name);

  const settings: AgentSettings = {
    ...DEFAULT_AGENT_SETTINGS,
    ...params.settings,
  };

  const capabilities = params.capabilities ?? DEFAULT_CAPABILITIES;

  try {
    // If custom ID is provided, include it in the INSERT
    // Otherwise, let the database generate a UUID
    const hasCustomId = params.id !== undefined && params.id !== '';

    const sql = hasCustomId
      ? `INSERT INTO app.agents (id, organization_id, name, description, capabilities, settings)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, organization_id, name, description, capabilities, status, settings, created_at, updated_at`
      : `INSERT INTO app.agents (organization_id, name, description, capabilities, settings)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, name, description, capabilities, status, settings, created_at, updated_at`;

    const queryParams = hasCustomId
      ? [
        params.id,
        params.organizationId,
        params.name,
        params.description ?? null,
        capabilities,
        JSON.stringify(settings),
      ]
      : [
        params.organizationId,
        params.name,
        params.description ?? null,
        capabilities,
        JSON.stringify(settings),
      ];

    const result = await query<AgentRow>(sql, queryParams);

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert agent');
    }

    return mapRowToAgent(row);
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new OrganizationNotFoundError(params.organizationId);
    }
    if (isUniqueViolation(error)) {
      // Check if this is a primary key (ID) violation or a name uniqueness violation
      // PostgreSQL includes constraint name in the error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('agents_pkey') || (params.id !== undefined && errorMessage.includes(params.id))) {
        throw new DuplicateAgentIdError(params.id ?? 'unknown');
      }
      throw new DuplicateAgentNameError(params.organizationId, params.name);
    }
    throw error;
  }
}

/**
 * Gets an agent by ID.
 *
 * @param id - Agent ID
 * @returns The agent or null if not found
 */
export async function getAgentById(id: string): Promise<RegisteredAgent | null> {
  const result = await query<AgentRow>(`
    SELECT id, organization_id, name, description, capabilities, status, settings, created_at, updated_at
    FROM app.agents
    WHERE id = $1
  `, [id]);

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return mapRowToAgent(row);
}

/**
 * Gets an agent by organization and name.
 *
 * @param organizationId - Organization ID
 * @param name - Agent name
 * @returns The agent or null if not found
 */
export async function getAgentByName(
  organizationId: string,
  name: string,
): Promise<RegisteredAgent | null> {
  const result = await query<AgentRow>(`
    SELECT id, organization_id, name, description, capabilities, status, settings, created_at, updated_at
    FROM app.agents
    WHERE organization_id = $1 AND name = $2
  `, [organizationId, name]);

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return mapRowToAgent(row);
}

/**
 * Updates an agent.
 *
 * @param id - Agent ID
 * @param params - Update parameters
 * @returns The updated agent or null if not found
 * @throws InvalidAgentParamsError if name is empty
 * @throws DuplicateAgentNameError if name conflicts with another agent
 */
export async function updateAgent(
  id: string,
  params: UpdateAgentParams,
): Promise<RegisteredAgent | null> {
  validateName(params.name);

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.name !== undefined) {
    updates.push(`name = $${String(paramIndex)}`);
    values.push(params.name);
    paramIndex++;
  }

  if (params.description !== undefined) {
    updates.push(`description = $${String(paramIndex)}`);
    values.push(params.description);
    paramIndex++;
  }

  if (params.capabilities !== undefined) {
    updates.push(`capabilities = $${String(paramIndex)}`);
    values.push(params.capabilities);
    paramIndex++;
  }

  if (params.settings !== undefined) {
    // Merge with existing settings
    updates.push(`settings = settings || $${String(paramIndex)}::jsonb`);
    values.push(JSON.stringify(params.settings));
    paramIndex++;
  }

  if (updates.length === 0) {
    // No updates to apply, just return current state
    return getAgentById(id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  try {
    const result = await query<AgentRow>(`
      UPDATE app.agents
      SET ${updates.join(', ')}
      WHERE id = $${String(paramIndex)}
      RETURNING id, organization_id, name, description, capabilities, status, settings, created_at, updated_at
    `, values);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return mapRowToAgent(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateAgentNameError('unknown', params.name ?? 'unknown');
    }
    throw error;
  }
}

/**
 * Updates an agent's status.
 *
 * @param id - Agent ID
 * @param status - New status
 * @returns The updated agent or null if not found
 */
export async function updateAgentStatus(
  id: string,
  status: AgentStatus,
): Promise<RegisteredAgent | null> {
  const result = await query<AgentRow>(`
    UPDATE app.agents
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING id, organization_id, name, description, capabilities, status, settings, created_at, updated_at
  `, [status, id]);

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return mapRowToAgent(row);
}

/**
 * Deletes an agent.
 *
 * @param id - Agent ID
 * @returns true if deleted, false if not found
 */
export async function deleteAgent(id: string): Promise<boolean> {
  const result = await query<{ id: string }>(`
    DELETE FROM app.agents
    WHERE id = $1
    RETURNING id
  `, [id]);

  return result.rows.length > 0;
}

/**
 * Lists all agents with optional pagination and filtering.
 *
 * @param options - Pagination and filter options
 * @returns Array of agents
 */
export async function listAgents(
  options: ListAgentsOptions = {},
): Promise<RegisteredAgent[]> {
  const { limit = 100, offset = 0, status } = options;

  let sql = `
    SELECT id, organization_id, name, description, capabilities, status, settings, created_at, updated_at
    FROM app.agents
  `;
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status !== undefined) {
    sql += ` WHERE status = $${String(paramIndex)}`;
    params.push(status);
    paramIndex++;
  }

  sql += ' ORDER BY created_at DESC';
  sql += ` LIMIT $${String(paramIndex)} OFFSET $${String(paramIndex + 1)}`;
  params.push(limit, offset);

  const result = await query<AgentRow>(sql, params);

  return result.rows.map(mapRowToAgent);
}

/**
 * Gets all agents for an organization.
 *
 * @param organizationId - Organization ID
 * @param options - Filter options
 * @returns Array of agents
 */
export async function getAgentsByOrganization(
  organizationId: string,
  options: GetAgentsByOrganizationOptions = {},
): Promise<RegisteredAgent[]> {
  const { status } = options;

  let sql = `
    SELECT id, organization_id, name, description, capabilities, status, settings, created_at, updated_at
    FROM app.agents
    WHERE organization_id = $1
  `;
  const params: unknown[] = [organizationId];
  const paramIndex = 2;

  if (status !== undefined) {
    sql += ` AND status = $${String(paramIndex)}`;
    params.push(status);
  }

  sql += ' ORDER BY name ASC';

  const result = await query<AgentRow>(sql, params);

  return result.rows.map(mapRowToAgent);
}

/**
 * Gets the count of active agents for an organization.
 *
 * @param organizationId - Organization ID
 * @returns Count of active agents
 */
export async function getActiveAgentCount(organizationId: string): Promise<number> {
  const result = await query<{ count: string }>(`
    SELECT COUNT(*) as count
    FROM app.agents
    WHERE organization_id = $1 AND status = 'active'
  `, [organizationId]);

  const row = result.rows[0];
  if (!row) {
    return 0;
  }

  return parseInt(row.count, 10);
}
