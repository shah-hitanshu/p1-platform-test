/**
 * Collaborator API Routes
 *
 * REST API endpoints for managing site collaborators (user-site roles).
 * Supports granting, listing, and revoking local site access.
 */

import type { AuthenticatedPrincipal, PantheonRole } from '../types';
import { query } from '../db';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { getMainBranch } from '../services';
import type { MASClient } from '../services/mas-client';

/**
 * Request context for collaborator routes
 */
export interface CollaboratorRouteContext {
  siteId: string;
  userId?: string;
  principal: AuthenticatedPrincipal;
  masClient?: MASClient;
}

/**
 * JSON response helper
 */
function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Error response helper
 */
function errorResponse(
  error: string,
  status: number,
  details?: unknown,
): Response {
  return jsonResponse({ error, details }, status);
}

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  return json as T;
}

interface GrantAccessBody {
  userId?: string;
  role?: PantheonRole;
}

/**
 * Handle POST /api/sites/{siteId}/collaborators - Grant site access
 */
async function handleGrantAccess(
  request: Request,
  context: CollaboratorRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<GrantAccessBody>(request);

  if (body.userId === undefined || body.userId.trim() === '') {
    return errorResponse('userId is required', 400);
  }

  if (body.role === undefined || body.role.trim() === '') {
    return errorResponse('role is required', 400);
  }

  const validRoles: PantheonRole[] = ['owner', 'admin', 'developer', 'team_member'];
  if (!validRoles.includes(body.role)) {
    return errorResponse(
      `Invalid role. Must be one of: ${validRoles.join(', ')}`,
      400,
    );
  }

  // Upsert into user_site_roles with source='local'
  const result = await query<{
    id: string;
    user_id: string;
    site_id: string;
    role: string;
    source: string;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO app.user_site_roles (user_id, site_id, role, source, created_by_id, updated_at)
     VALUES ($1, $2, $3, 'local', $4, NOW())
     ON CONFLICT (user_id, site_id, source)
     DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
     RETURNING id, user_id, site_id, role, source, created_at, updated_at`,
    [body.userId, context.siteId, body.role, context.principal.id],
  );

  if (result.rows.length === 0) {
    return errorResponse('Failed to grant access', 500);
  }

  const row = result.rows[0];
  return jsonResponse(
    {
      id: row.id,
      userId: row.user_id,
      siteId: row.site_id,
      role: row.role,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    201,
  );
}

/**
 * Handle GET /api/sites/{siteId}/collaborators - List all collaborators
 */
async function handleListCollaborators(
  context: CollaboratorRouteContext,
): Promise<Response> {
  const result = await query<{
    id: string;
    user_id: string;
    site_id: string;
    role: string;
    source: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, user_id, site_id, role, source, created_at, updated_at
     FROM app.user_site_roles
     WHERE site_id = $1
     ORDER BY created_at ASC`,
    [context.siteId],
  );

  const collaborators = result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    siteId: row.site_id,
    role: row.role,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return jsonResponse({ collaborators });
}

/**
 * Handle DELETE /api/sites/{siteId}/collaborators/{userId} - Remove local grant
 */
async function handleRemoveCollaborator(
  context: CollaboratorRouteContext,
): Promise<Response> {
  if (context.userId === undefined || context.userId === '') {
    return errorResponse('userId is required', 400);
  }

  const result = await query(
    `DELETE FROM app.user_site_roles
     WHERE user_id = $1 AND site_id = $2 AND source = 'local'`,
    [context.userId, context.siteId],
  );

  if (result.rowCount === 0) {
    return errorResponse('Local collaborator grant not found', 404);
  }

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for collaborator operations
 */
export async function handleCollaboratorRoutes(
  request: Request,
  context: CollaboratorRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Require ADMIN role on the site for all collaborator operations
    const mainBranch = await getMainBranch(context.siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }

    await assertPermission(
      context.principal, context.siteId, mainBranch.id, 'canManageGrants', context.masClient,
    );

    // Single collaborator operations (with userId)
    if (context.userId !== undefined) {
      switch (method) {
        case 'DELETE':
          return await handleRemoveCollaborator(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Collection operations
    switch (method) {
      case 'GET':
        return await handleListCollaborators(context);
      case 'POST':
        return await handleGrantAccess(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    console.error('Collaborator API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
