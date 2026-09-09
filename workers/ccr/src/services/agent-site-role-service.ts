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

export interface ResolvedAgentSiteRole {
  role: 'viewer' | 'editor' | 'admin';
  /** True when the role comes from the global flag rather than a grant row. */
  implicit: boolean;
}

export interface AgentSiteRole {
  id: string;
  agentId: string;
  siteId: string;
  role: 'viewer' | 'editor' | 'admin';
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
  isGlobal: boolean;
}

interface RoleRow {
  id: string;
  agent_id: string;
  site_id: string;
  role: 'viewer' | 'editor' | 'admin';
  created_by_id: string;
  created_at: string;
  revoked_at: string | null;
  is_global: boolean;
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

// Access level a global agent holds on a site it was never explicitly granted.
const DEFAULT_GLOBAL_AGENT_ROLE: 'viewer' | 'editor' | 'admin' = 'editor';

// =============================================================================
// Helpers
// =============================================================================

function mapRowToRole(row: RoleRow): AgentSiteRole {
  return {
    id: row.id,
    agentId: row.agent_id,
    siteId: row.site_id,
    role: row.role,
    grantedBy: row.created_by_id,
    grantedAt: row.created_at,
    revokedAt: row.revoked_at,
    isGlobal: row.is_global,
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
    `INSERT INTO app.agent_site_roles (agent_id, site_id, role, created_by_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id, site_id) WHERE revoked_at IS NULL
     DO UPDATE SET role = $3, created_by_id = $4, created_at = now()
     RETURNING *`,
    [params.agentId, params.siteId, params.role, params.grantedBy],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to insert agent site role');
  }

  return mapRowToRole(row);
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
 * Look up a single agent site role by id and agent, including revoked rows.
 *
 * Used for authorization before a revoke: the caller must have canManageGrants
 * on the role's site, and that site id is only knowable by reading the row
 * first [PCC-3676].
 */
export async function getAgentSiteRoleById(
  roleId: string,
  agentId: string,
): Promise<AgentSiteRole | null> {
  const result = await query<RoleRow>(
    `SELECT * FROM app.agent_site_roles
     WHERE id = $1 AND agent_id = $2`,
    [roleId, agentId],
  );

  const row = result.rows[0];
  return row ? mapRowToRole(row) : null;
}

/**
 * List active (non-revoked) site roles for an agent.
 */
export async function listRoles(agentId: string): Promise<AgentSiteRole[]> {
  const result = await query<RoleRow>(
    `SELECT * FROM app.agent_site_roles
     WHERE agent_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [agentId],
  );

  return result.rows.map(mapRowToRole);
}

/**
 * List active (non-revoked) agent roles for a site, always including global
 * agents. Global agents appear even without an explicit grant so they show
 * as non-removable system entries in the UI.
 */
export async function listRolesBySite(siteId: string): Promise<(AgentSiteRole & { agentName: string })[]> {
  const result = await query<RoleRow & { agent_name: string }>(
    `-- Explicitly granted roles for non-global agents
     SELECT r.id::text, r.agent_id::text, r.site_id, r.role, r.created_by_id, r.created_at, r.revoked_at,
            a.name AS agent_name, FALSE AS is_global
     FROM app.agent_site_roles r
     JOIN app.agents a ON a.id = r.agent_id
     WHERE r.site_id = $1 AND r.revoked_at IS NULL AND a.is_global = FALSE

     UNION ALL

     -- Global agents always appear; use their explicit role if one exists,
     -- otherwise the default system access level.
     SELECT COALESCE(r.id::text, a.id::text) AS id,
            a.id AS agent_id,
            $1::uuid AS site_id,
            COALESCE(r.role, $2) AS role,
            COALESCE(r.created_by_id, '') AS created_by_id,
            COALESCE(r.created_at, a.created_at) AS created_at,
            NULL AS revoked_at,
            a.name AS agent_name,
            TRUE AS is_global
     FROM app.agents a
     LEFT JOIN app.agent_site_roles r
       ON r.agent_id = a.id AND r.site_id = $1 AND r.revoked_at IS NULL
     WHERE a.is_global = TRUE AND a.status = 'active'

     ORDER BY is_global DESC, created_at DESC`,
    [siteId, DEFAULT_GLOBAL_AGENT_ROLE],
  );

  return result.rows.map((row) => ({
    ...mapRowToRole(row),
    agentName: row.agent_name,
  }));
}

/**
 * The role an agent holds on a site: its explicit grant, or the default level
 * when the agent is global. Authorization and the site agent-access list both
 * read this, so the two cannot drift apart.
 *
 * `allowImplicit` is the acting user's presence. A global agent's implicit
 * access is delegated authority — without an acting user to bound it, one key
 * would carry the default role on every site on the platform. An explicit grant
 * row still authorizes on its own, as it did before the flag existed.
 *
 * `implicit` says which of the two it was, so a caller can bound the delegated
 * case against the acting user without narrowing a real grant.
 */
export async function resolveAgentSiteRole(
  agentId: string,
  siteId: string,
  allowImplicit: boolean,
): Promise<ResolvedAgentSiteRole | null> {
  // Revoked grants must not authorize; the partial unique index guarantees at
  // most one active row per agent and site.
  const result = await query<{ role: 'viewer' | 'editor' | 'admin'; implicit: boolean }>(
    `SELECT COALESCE(r.role, $3) AS role, r.id IS NULL AS implicit
     FROM app.agents a
     LEFT JOIN app.agent_site_roles r
       ON r.agent_id = a.id AND r.site_id = $2 AND r.revoked_at IS NULL
     WHERE a.id = $1
       AND (r.id IS NOT NULL
            OR ($4 AND a.is_global = TRUE AND a.status = 'active'))
     LIMIT 1`,
    [agentId, siteId, DEFAULT_GLOBAL_AGENT_ROLE, allowImplicit],
  );

  const row = result.rows[0];
  return row ? { role: row.role, implicit: row.implicit } : null;
}

/**
 * Whether the id belongs to an active global agent, whose implicit access
 * cannot be revoked. An explicit grant row stays revocable and drops the agent
 * back to that implicit default.
 *
 * Status is checked here because nothing upstream does: a suspended agent still
 * authenticates, so a status-blind read would let it keep enumerating sites.
 */
export async function isGlobalAgentId(id: string): Promise<boolean> {
  const result = await query<{ is_global: boolean }>(
    `SELECT is_global FROM app.agents
     WHERE id = $1 AND is_global = TRUE AND status = 'active'`,
    [id],
  );

  return result.rows[0]?.is_global === true;
}

/**
 * Revoke a site role by roleId (site-scoped, no agentId required).
 *
 * @returns true if revoked, false if not found
 */
export async function revokeRoleBySite(
  roleId: string,
  siteId: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE app.agent_site_roles
     SET revoked_at = NOW()
     WHERE id = $1 AND site_id = $2 AND revoked_at IS NULL`,
    [roleId, siteId],
  );

  return (result.rowCount ?? 0) > 0;
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
    const mapped = ROLE_MAP[row.role];
    if (mapped) {
      roleMap[row.site_id] = mapped;
    }
  }
  return roleMap;
}
