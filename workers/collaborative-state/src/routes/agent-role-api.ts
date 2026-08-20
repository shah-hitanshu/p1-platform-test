/**
 * Agent Site Role Management Routes
 *
 * REST API endpoints for managing agent site roles.
 * Only users can manage agent roles (not agents or service principals).
 *
 * POST   /api/agents/:agentId/roles          - Grant role
 * GET    /api/agents/:agentId/roles          - List roles
 * DELETE /api/agents/:agentId/roles/:roleId  - Revoke role
 */

import type { AuthenticatedPrincipal } from '../types';
import { grantRole, listRoles, revokeRole, getAgentSiteRoleById } from '../services/agent-site-role-service';
import { assertPermission, hasPermission, AuthorizationError } from '../auth/authorization';
import { getMainBranch } from '../services';

/**
 * Route context for agent role management endpoints
 */
export interface AgentRoleRouteContext {
  agentId?: string;
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
 * Main route handler for agent role operations
 */
export async function handleAgentRoleRoutes(
  request: Request,
  context: AgentRoleRouteContext,
): Promise<Response> {
  const { agentId, roleId, principal } = context;
  const method = request.method;

  // Validate agentId
  if (agentId === undefined || agentId.trim() === '') {
    return errorResponse('Agent ID is required', 400);
  }

  // Only users can manage agent roles (not agents or service principals)
  if (principal.type !== 'user') {
    return errorResponse('Only users can manage agent roles', 403);
  }

  try {
    // Route to handler
    if (roleId !== undefined && roleId !== '') {
      // Role-specific operations
      if (method === 'DELETE') {
        return await handleRevokeRole(agentId, roleId, principal);
      }
      return errorResponse('Method not allowed', 405);
    }

    // Collection operations
    switch (method) {
      case 'POST':
        return await handleGrantRole(request, agentId, principal);
      case 'GET':
        return await handleListRoles(agentId, principal);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    console.error('Agent Role API error:', error);
    return errorResponse('Internal server error', 500);
  }
}

interface GrantRoleBody {
  siteId?: string;
  role?: string;
}

async function handleGrantRole(
  request: Request,
  agentId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body: unknown = await request.json();
  const { siteId, role } = body as GrantRoleBody;

  if (siteId === undefined || siteId.trim() === '') {
    return errorResponse('siteId is required', 400);
  }

  if (role === undefined || role.trim() === '') {
    return errorResponse('role is required', 400);
  }

  if (!VALID_ROLES.includes(role)) {
    return errorResponse('role must be one of: viewer, editor, admin', 400);
  }

  // Granting an agent a role on a site requires site admin on that site
  // [PCC-3676]. siteId here comes from the request body, so this is the second
  // path (besides POST /api/sites/:siteId/agent-roles) by which an allowlisted
  // user could otherwise grant an agent admin on a site they don't administer.
  const mainBranch = await getMainBranch(siteId);
  if (mainBranch === null) {
    return errorResponse('Site not found', 404);
  }
  await assertPermission(principal, siteId, mainBranch.id, 'canManageGrants');

  const result = await grantRole({
    agentId,
    siteId,
    role: role as 'viewer' | 'editor' | 'admin',
    grantedBy: principal.dbUserId ?? principal.id,
  });

  return jsonResponse(result, 201);
}

async function handleListRoles(
  agentId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  // PCC-3676: an agent's roles span sites. Return only those on sites the caller
  // administers (canManageGrants), so this can't be used to enumerate grants —
  // and the otherwise well-protected site UUIDs — for sites the caller has no
  // access to. Mirrors the gate on GET /api/sites/:siteId/agent-roles.
  const roles = await listRoles(agentId);
  const visible: typeof roles = [];
  for (const role of roles) {
    const mainBranch = await getMainBranch(role.siteId);
    if (
      mainBranch !== null &&
      (await hasPermission(principal, role.siteId, mainBranch.id, 'canManageGrants'))
    ) {
      visible.push(role);
    }
  }
  return jsonResponse({ roles: visible });
}

async function handleRevokeRole(
  agentId: string,
  roleId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  // Revoking an agent's site role is a grant-management operation on that
  // role's site: require canManageGrants there [PCC-3676]. The site is only
  // knowable by reading the row, so resolve it before authorizing.
  const existing = await getAgentSiteRoleById(roleId, agentId);
  if (existing === null) {
    return errorResponse('Role not found', 404);
  }
  const mainBranch = await getMainBranch(existing.siteId);
  if (mainBranch === null) {
    return errorResponse('Site not found', 404);
  }
  await assertPermission(principal, existing.siteId, mainBranch.id, 'canManageGrants');

  const revoked = await revokeRole(roleId, agentId);

  if (!revoked) {
    return errorResponse('Role not found', 404);
  }

  return new Response(null, { status: 204 });
}
