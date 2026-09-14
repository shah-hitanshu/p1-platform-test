/**
 * Agent Site Role Service
 *
 * Manages per-site roles for agents.
 * Each agent can hold one active role per site (viewer, editor, or admin).
 * Roles map to PantheonRole for authorization decisions.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { query } from '../db';
import { agentSiteRoles, agents } from '../db/schema';
import { db } from '../db/scope';
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
  agentId: string;
  siteId: string;
  role: string;
  createdById: string | null;
  createdAt: Date | null;
  revokedAt: Date | null;
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

function mapRowToRole(row: RoleRow, isGlobal: boolean): AgentSiteRole {
  return {
    id: row.id,
    agentId: row.agentId,
    siteId: row.siteId,
    role: row.role as 'viewer' | 'editor' | 'admin',
    grantedBy: row.createdById ?? '',
    grantedAt: row.createdAt?.toISOString() ?? '',
    revokedAt: row.revokedAt?.toISOString() ?? null,
    isGlobal,
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

  // Kept on the legacy query() connection deliberately: site-service.ts's
  // createSite calls this from inside a raw BEGIN/COMMIT block on that same
  // connection. A Drizzle db() insert here would run on the separate Drizzle
  // connection and could not see the just-inserted, not-yet-committed site
  // row, failing its site_id foreign key. Convert this alongside site-service.ts.
  const result = await query<{
    id: string;
    agent_id: string;
    site_id: string;
    role: 'viewer' | 'editor' | 'admin';
    created_by_id: string;
    created_at: string;
    revoked_at: string | null;
  }>(
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

  return {
    id: row.id,
    agentId: row.agent_id,
    siteId: row.site_id,
    role: row.role,
    grantedBy: row.created_by_id,
    grantedAt: row.created_at,
    revokedAt: row.revoked_at,
    isGlobal: false,
  };
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
  const rows = await db()
    .update(agentSiteRoles)
    .set({ revokedAt: sql`now()` })
    .where(and(
      eq(agentSiteRoles.id, roleId),
      eq(agentSiteRoles.agentId, agentId),
      isNull(agentSiteRoles.revokedAt),
    ))
    .returning({ id: agentSiteRoles.id });

  return rows.length > 0;
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
  const [row] = await db()
    .select()
    .from(agentSiteRoles)
    .where(and(eq(agentSiteRoles.id, roleId), eq(agentSiteRoles.agentId, agentId)));

  return row ? mapRowToRole(row, false) : null;
}

/**
 * List active (non-revoked) site roles for an agent.
 */
export async function listRoles(agentId: string): Promise<AgentSiteRole[]> {
  const rows = await db()
    .select()
    .from(agentSiteRoles)
    .where(and(eq(agentSiteRoles.agentId, agentId), isNull(agentSiteRoles.revokedAt)))
    .orderBy(desc(agentSiteRoles.createdAt));

  return rows.map((row) => mapRowToRole(row, false));
}

/**
 * List active (non-revoked) agent roles for a site, always including global
 * agents. Global agents appear even without an explicit grant so they show
 * as non-removable system entries in the UI.
 *
 * UNION ALL over two differently-shaped virtual rows (an explicit grant row,
 * and a synthesized row per implicit global agent via COALESCE over a left
 * join) — no natural select-builder form; kept raw.
 */
export async function listRolesBySite(siteId: string): Promise<(AgentSiteRole & { agentName: string })[]> {
  const statement = sql`
    -- Explicitly granted roles for non-global agents
    SELECT r.id::text, r.agent_id::text, r.site_id, r.role, r.created_by_id, r.created_at, r.revoked_at,
           a.name AS agent_name, FALSE AS is_global
    FROM app.agent_site_roles r
    JOIN app.agents a ON a.id = r.agent_id
    WHERE r.site_id = ${siteId} AND r.revoked_at IS NULL AND a.is_global = FALSE

    UNION ALL

    -- Global agents always appear; use their explicit role if one exists,
    -- otherwise the default system access level.
    SELECT COALESCE(r.id::text, a.id::text) AS id,
           a.id AS agent_id,
           ${siteId}::uuid AS site_id,
           COALESCE(r.role, ${DEFAULT_GLOBAL_AGENT_ROLE}) AS role,
           COALESCE(r.created_by_id, '') AS created_by_id,
           COALESCE(r.created_at, a.created_at) AS created_at,
           NULL AS revoked_at,
           a.name AS agent_name,
           TRUE AS is_global
    FROM app.agents a
    LEFT JOIN app.agent_site_roles r
      ON r.agent_id = a.id AND r.site_id = ${siteId} AND r.revoked_at IS NULL
    WHERE a.is_global = TRUE AND a.status = 'active'

    ORDER BY is_global DESC, created_at DESC
  `;

  const rows = await db().execute<{
    id: string;
    agent_id: string;
    site_id: string;
    role: 'viewer' | 'editor' | 'admin';
    created_by_id: string;
    created_at: string;
    revoked_at: string | null;
    agent_name: string;
    is_global: boolean;
  }>(statement);

  return rows.map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    siteId: row.site_id,
    role: row.role,
    grantedBy: row.created_by_id,
    grantedAt: row.created_at,
    revokedAt: row.revoked_at,
    isGlobal: row.is_global,
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
  const [row] = await db()
    .select({
      role: sql<'viewer' | 'editor' | 'admin'>`coalesce(${agentSiteRoles.role}, ${DEFAULT_GLOBAL_AGENT_ROLE})`,
      implicit: sql<boolean>`${agentSiteRoles.id} IS NULL`,
    })
    .from(agents)
    .leftJoin(agentSiteRoles, and(
      eq(agentSiteRoles.agentId, agents.id),
      eq(agentSiteRoles.siteId, siteId),
      isNull(agentSiteRoles.revokedAt),
    ))
    .where(and(
      eq(agents.id, agentId),
      sql`(${agentSiteRoles.id} IS NOT NULL
        OR (${allowImplicit} AND ${agents.isGlobal} = TRUE AND ${agents.status} = 'active'))`,
    ))
    .limit(1);

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
  const [row] = await db()
    .select({ isGlobal: agents.isGlobal })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.isGlobal, true), eq(agents.status, 'active')));

  return row?.isGlobal === true;
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
  const rows = await db()
    .update(agentSiteRoles)
    .set({ revokedAt: sql`now()` })
    .where(and(
      eq(agentSiteRoles.id, roleId),
      eq(agentSiteRoles.siteId, siteId),
      isNull(agentSiteRoles.revokedAt),
    ))
    .returning({ id: agentSiteRoles.id });

  return rows.length > 0;
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
  const rows = await db()
    .select()
    .from(agentSiteRoles)
    .where(and(eq(agentSiteRoles.agentId, agentId), isNull(agentSiteRoles.revokedAt)));

  const roleMap: Record<string, PantheonRole> = {};
  for (const row of rows) {
    const mapped = ROLE_MAP[row.role];
    if (mapped) {
      roleMap[row.siteId] = mapped;
    }
  }
  return roleMap;
}
