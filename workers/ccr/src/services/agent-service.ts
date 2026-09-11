/**
 * Agent Politeness System - Phase 1.4: Agent Registry Service
 *
 * CRUD operations for Registered Agents.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * @see collaborative-state-system-architecture-v2.3.md Section "Agent Politeness System"
 */

import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { RegisteredAgent, AgentSettings, AgentStatus } from '../types';
import { driverErrorCode } from '../db/driver-error';
import { agents } from '../db/schema';
import { db } from '../db/scope';
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
 * Maps a database row to a RegisteredAgent domain object.
 */
function mapRowToAgent(row: typeof agents.$inferSelect): RegisteredAgent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description ?? undefined,
    capabilities: row.capabilities,
    status: row.status as AgentStatus,
    settings: row.settings as AgentSettings,
    isGlobal: row.isGlobal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Checks if an error is a PostgreSQL foreign key constraint violation.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return driverErrorCode(error) === '23503';
}

/**
 * Checks if an error is a PostgreSQL unique constraint violation.
 */
function isUniqueViolation(error: unknown): boolean {
  return driverErrorCode(error) === '23505';
}

/**
 * The constraint a rejected query violated.
 *
 * Postgres names it in its own error, which Drizzle puts on `cause` alongside the
 * SQLSTATE. It is what tells two unique constraints on the same table apart, and
 * unlike the wrapper's message it carries no statement text.
 */
function violatedConstraint(error: unknown): string | undefined {
  for (let candidate: unknown = error; candidate instanceof Error; candidate = candidate.cause) {
    if ('constraint_name' in candidate && typeof candidate.constraint_name === 'string') {
      return candidate.constraint_name;
    }
  }
  return undefined;
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
export async function createAgent(
  params: CreateAgentParams,
): Promise<RegisteredAgent> {
  validateName(params.name);

  const settings: AgentSettings = {
    ...DEFAULT_AGENT_SETTINGS,
    ...params.settings,
  };

  const capabilities = params.capabilities ?? DEFAULT_CAPABILITIES;

  try {
    // An omitted id takes the column's generated default.
    const hasCustomId = params.id !== undefined && params.id !== '';

    const rows = await db()
      .insert(agents)
      .values({
        ...(hasCustomId ? { id: params.id } : {}),
        organizationId: params.organizationId,
        name: params.name,
        description: params.description ?? null,
        capabilities,
        settings,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('Failed to insert agent');
    }

    return mapRowToAgent(row);
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new OrganizationNotFoundError(params.organizationId);
    }
    if (isUniqueViolation(error)) {
      if (violatedConstraint(error) === 'agents_pkey') {
        throw new DuplicateAgentIdError(params.id ?? 'unknown');
      }
      throw new DuplicateAgentNameError(params.organizationId, params.name);
    }
    throw error;
  }
}

/**
 * A uuid-shaped id in canonical lowercase-hyphenated form, which is what the
 * agents table stores and what a uuid column canonicalizes an id to on write.
 * Any other id is returned unchanged.
 */
function canonicalAgentId(id: string): string {
  const hex = id.replace(/[{}-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    return id;
  }
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * Gets an agent by ID.
 *
 * A differently-spelled uuid resolves to the same agent, so a guard that reads
 * this cannot be spelled around while the write path canonicalizes.
 *
 * @param id - Agent ID
 * @returns The agent or null if not found
 */
export async function getAgentById(id: string): Promise<RegisteredAgent | null> {
  const rows = await db().select().from(agents).where(eq(agents.id, canonicalAgentId(id)));

  const row = rows[0];
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
  const rows = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.organizationId, organizationId), eq(agents.name, name)));

  const row = rows[0];
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

  const updates: PgUpdateSetSource<typeof agents> = {};

  if (params.name !== undefined) {
    updates.name = params.name;
  }

  if (params.description !== undefined) {
    updates.description = params.description;
  }

  if (params.capabilities !== undefined) {
    updates.capabilities = params.capabilities;
  }

  if (params.settings !== undefined) {
    // Merge with existing settings
    updates.settings = sql`${agents.settings} || ${JSON.stringify(params.settings)}::jsonb`;
  }

  if (Object.keys(updates).length === 0) {
    // No updates to apply, just return current state
    return getAgentById(id);
  }

  updates.updatedAt = sql`NOW()`;

  try {
    const rows = await db().update(agents).set(updates).where(eq(agents.id, id)).returning();

    const row = rows[0];
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
  const rows = await db()
    .update(agents)
    .set({ status, updatedAt: sql`NOW()` })
    .where(eq(agents.id, id))
    .returning();

  const row = rows[0];
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
  const rows = await db().delete(agents).where(eq(agents.id, id)).returning({ id: agents.id });

  return rows.length > 0;
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

  const rows = await db()
    .select()
    .from(agents)
    .where(status === undefined ? undefined : eq(agents.status, status))
    .orderBy(desc(agents.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(mapRowToAgent);
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

  const rows = await db()
    .select()
    .from(agents)
    .where(
      and(
        or(eq(agents.organizationId, organizationId), eq(agents.isGlobal, true)),
        status === undefined ? undefined : eq(agents.status, status),
      ),
    )
    .orderBy(asc(agents.name));

  return rows.map(mapRowToAgent);
}

/**
 * Gets the count of active agents for an organization.
 *
 * @param organizationId - Organization ID
 * @returns Count of active agents
 */
export async function getActiveAgentCount(organizationId: string): Promise<number> {
  const rows = await db()
    .select({ count: count() })
    .from(agents)
    .where(and(eq(agents.organizationId, organizationId), eq(agents.status, 'active')));

  const row = rows[0];
  if (!row) {
    return 0;
  }

  return row.count;
}
