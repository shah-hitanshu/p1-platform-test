/**
 * Agent Site Role Service
 *
 * Manages per-site roles for agents.
 * Each agent can hold one active role per site (viewer, editor, or admin).
 * Roles map to PantheonRole for authorization decisions.
 */

import { query } from '../db';
import type { PantheonRole } from '../types';

// =============================================================================
// Types
// =============================================================================

export interface GrantRoleParams {
  agentId: string;
  siteId: string;
  role: 'viewer' | 'editor' | 'admin';
  grantedBy: string;
}

export interface AgentSiteRole {
  id: string;
  agentId: string;
  siteId: string;
  role: 'viewer' | 'editor' | 'admin';
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
}

interface RoleRow {
  id: string;
  agent_id: string;
  site_id: string;
  role: 'viewer' | 'editor' | 'admin';
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
}

// =============================================================================
// Constants
// =============================================================================

const VALID_ROLES: readonly string[] = ['viewer', 'editor', 'admin'];

const ROLE_MAP: Record<string, PantheonRole> = {
  viewer: 'team_member',
  editor: 'developer',
  admin: 'admin',
};

// =============================================================================
// Helpers
// =============================================================================

function mapRowToRole(row: RoleRow): AgentSiteRole {
  return {
    id: row.id,
    agentId: row.agent_id,
    siteId: row.site_id,
    role: row.role,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  };
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Grant (or update) a site role for an agent.
 *
 * If an active role already exists for the same agent+site, it is updated
 * via upsert (ON CONFLICT).
 *
 * @returns The granted/updated role
 */
export async function grantRole(
  params: GrantRoleParams,
): Promise<AgentSiteRole> {
  if (!params.agentId || params.agentId.trim() === '') {
    throw new Error('agentId is required');
  }
  if (!params.siteId || params.siteId.trim() === '') {
    throw new Error('siteId is required');
  }
  if (!VALID_ROLES.includes(params.role)) {
    throw new Error('role must be one of: viewer, editor, admin');
  }
  if (!params.grantedBy || params.grantedBy.trim() === '') {
    throw new Error('grantedBy is required');
  }

  const result = await query<RoleRow>(
    `INSERT INTO app.agent_site_roles (agent_id, site_id, role, granted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id, site_id) WHERE revoked_at IS NULL
     DO UPDATE SET role = $3, granted_by = $4, granted_at = now()
     RETURNING *`,
    [params.agentId, params.siteId, params.role, params.grantedBy],
  );

  return mapRowToRole(result.rows[0]);
}

/**
 * Revoke a site role by setting its revoked_at timestamp.
 *
 * @returns true if revoked, false if not found
 */
export async function revokeRole(
  roleId: string,
  agentId: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE app.agent_site_roles
     SET revoked_at = NOW()
     WHERE id = $1 AND agent_id = $2 AND revoked_at IS NULL`,
    [roleId, agentId],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * List active (non-revoked) site roles for an agent.
 */
export async function listRoles(agentId: string): Promise<AgentSiteRole[]> {
  const result = await query<RoleRow>(
    `SELECT * FROM app.agent_site_roles
     WHERE agent_id = $1 AND revoked_at IS NULL
     ORDER BY granted_at DESC`,
    [agentId],
  );

  return result.rows.map(mapRowToRole);
}

/**
 * Get a mapping of site IDs to PantheonRole for an agent.
 *
 * Used for authorization: maps agent roles to Pantheon equivalents.
 * - viewer  -> team_member
 * - editor  -> developer
 * - admin   -> admin
 *
 * @returns Record of siteId to PantheonRole
 */
export async function getRolesForAgent(
  agentId: string,
): Promise<Record<string, PantheonRole>> {
  const result = await query<RoleRow>(
    `SELECT * FROM app.agent_site_roles
     WHERE agent_id = $1 AND revoked_at IS NULL`,
    [agentId],
  );

  const roleMap: Record<string, PantheonRole> = {};
  for (const row of result.rows) {
    roleMap[row.site_id] = ROLE_MAP[row.role];
  }
  return roleMap;
}
