/**
 * Site-Scoped Agent Role Management Routes
 *
 * REST API endpoints for managing agent roles on a specific site.
 * These are site-scoped views of agent_site_roles, complementing
 * the agent-scoped routes in agent-role-api.ts.
 *
 * POST   /api/sites/:siteId/agent-roles          - Grant agent role on site
 * GET    /api/sites/:siteId/agent-roles          - List agent roles on site
 * DELETE /api/sites/:siteId/agent-roles/:roleId  - Revoke agent role
 */

import type { AuthenticatedPrincipal } from '../types';
import {
  grantRole,
  isGlobalAgentId,
  listRolesBySite,
  revokeRoleBySite,
} from '../services/agent-site-role-service';
import { getAgentById } from '../services/agent-service';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { GRANTABLE_AGENT_ROLES } from '../auth/role-catalog';
import { getMainBranch } from '../services';

/**
 * Route context for site agent role endpoints
 */
export interface SiteAgentRoleRouteContext {
  siteId?: string;
  roleId?: string;
  principal: AuthenticatedPrincipal;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}

const VALID_ROLES: readonly string[] = GRANTABLE_AGENT_ROLES;

/**
 * Main route handler for site-scoped agent role operations
 */
export async function handleSiteAgentRoleRoutes(
  request: Request,
  context: SiteAgentRoleRouteContext,
): Promise<Response> {
  const { siteId, roleId, principal } = context;
  const method = request.method;

  if (siteId === undefined || siteId.trim() === '') {
    return errorResponse('Site ID is required', 400);
  }

  if (principal.type !== 'user') {
    return errorResponse('Only users can manage agent roles', 403);
  }

  try {
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }

    // Granting or revoking is site administration (canManageGrants); anyone who
    // can view the site may see which agents already have access.
    if (roleId !== undefined && roleId !== '') {
      await assertPermission(principal, siteId, mainBranch.id, 'canManageGrants');
      if (method === 'DELETE') {
        return await handleRevokeRole(siteId, roleId);
      }
      return errorResponse('Method not allowed', 405);
    }

    switch (method) {
      case 'POST':
        await assertPermission(principal, siteId, mainBranch.id, 'canManageGrants');
        return await handleGrantRole(request, siteId, principal);
      case 'GET':
        await assertPermission(principal, siteId, mainBranch.id, 'canView');
        return await handleListRoles(siteId);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    console.error('Site Agent Role API error:', error);
    return errorResponse('Internal server error', 500);
  }
}

interface GrantRoleBody {
  agentId?: string;
  role?: string;
}

async function handleGrantRole(
  request: Request,
  siteId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body: unknown = await request.json();
  const { agentId, role } = body as GrantRoleBody;

  if (agentId === undefined || agentId.trim() === '') {
    return errorResponse('agentId is required', 400);
  }

  if (role === undefined || role.trim() === '') {
    return errorResponse('role is required', 400);
  }

  if (!VALID_ROLES.includes(role)) {
    return errorResponse('role must be one of: viewer, editor, admin', 400);
  }

  // A global agent already reaches every site, so an explicit grant would only
  // add a row that raises its access above the system default. Resolve the agent
  // rather than trusting the id, and grant to the id that resolved.
  const agent = await getAgentById(agentId);
  if (agent === null) {
    return errorResponse('Agent not found', 404);
  }
  if (agent.isGlobal) {
    return errorResponse('Cannot grant a site role to a system agent', 403);
  }

  const result = await grantRole({
    agentId: agent.id,
    siteId,
    role: role as 'viewer' | 'editor' | 'admin',
    grantedBy: principal.dbUserId ?? principal.id,
  });

  return jsonResponse(result, 201);
}

async function handleListRoles(siteId: string): Promise<Response> {
  const roles = await listRolesBySite(siteId);
  return jsonResponse({ roles });
}

async function handleRevokeRole(
  siteId: string,
  roleId: string,
): Promise<Response> {
  // Only the implicit access is non-removable: a global agent with no explicit
  // grant is listed under its own agent id, which is what arrives here.
  if (await isGlobalAgentId(roleId)) {
    return errorResponse('Cannot revoke access for a system agent', 403);
  }

  const revoked = await revokeRoleBySite(roleId, siteId);

  if (!revoked) {
    return errorResponse('Role not found', 404);
  }

  return new Response(null, { status: 204 });
}
