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
import { grantRole, listRoles, revokeRole } from '../services/agent-site-role-service';

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
        return await handleRevokeRole(agentId, roleId);
      }
      return errorResponse('Method not allowed', 405);
    }

    // Collection operations
    switch (method) {
      case 'POST':
        return await handleGrantRole(request, agentId, principal);
      case 'GET':
        return await handleListRoles(agentId);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
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

  const result = await grantRole({
    agentId,
    siteId,
    role,
    grantedBy: principal.dbUserId ?? principal.id,
  });

  return jsonResponse(result, 201);
}

async function handleListRoles(agentId: string): Promise<Response> {
  const roles = await listRoles(agentId);
  return jsonResponse({ roles });
}

async function handleRevokeRole(
  agentId: string,
  roleId: string,
): Promise<Response> {
  const revoked = await revokeRole(roleId, agentId);

  if (!revoked) {
    return errorResponse('Role not found', 404);
  }

  return new Response(null, { status: 204 });
}
