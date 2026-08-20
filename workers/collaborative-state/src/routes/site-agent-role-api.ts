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
import { grantRole, listRolesBySite, revokeRoleBySite } from '../services/agent-site-role-service';
import { assertPermission, AuthorizationError } from '../auth/authorization';
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

const VALID_ROLES = ['viewer', 'editor', 'admin'];

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
    // Granting an agent a role on a site, listing those roles, or revoking one
    // are all grant-management operations: require site admin (canManageGrants),
    // mirroring collaborator-api [PCC-3676]. Without this, any allowlisted user
    // could grant an agent admin on a site they don't administer and then act
    // through that agent — a cross-site privilege escalation.
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }
    await assertPermission(principal, siteId, mainBranch.id, 'canManageGrants');

    if (roleId !== undefined && roleId !== '') {
      if (method === 'DELETE') {
        return await handleRevokeRole(siteId, roleId);
      }
      return errorResponse('Method not allowed', 405);
    }

    switch (method) {
      case 'POST':
        return await handleGrantRole(request, siteId, principal);
      case 'GET':
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

  const result = await grantRole({
    agentId,
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
  const revoked = await revokeRoleBySite(roleId, siteId);

  if (!revoked) {
    return errorResponse('Role not found', 404);
  }

  return new Response(null, { status: 204 });
}
