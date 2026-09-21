/**
 * Collaborator API Routes
 *
 * REST API endpoints for managing site collaborators (user-site roles).
 * Supports granting, listing, and revoking local site access.
 */

import type { AuthenticatedPrincipal, PantheonRole } from '../types';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { userSiteRoles, users } from '../db/schema';
import { db } from '../db/scope';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { GRANTABLE_USER_ROLES } from '../auth/role-catalog';
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

  if (!GRANTABLE_USER_ROLES.includes(body.role)) {
    return errorResponse(
      `Invalid role. Must be one of: ${GRANTABLE_USER_ROLES.join(', ')}`,
      400,
    );
  }

  // Upsert into user_site_roles with source='local'
  const rows = await db()
    .insert(userSiteRoles)
    .values({
      userId: body.userId,
      siteId: context.siteId,
      role: body.role,
      source: 'local',
      createdById: context.principal.id,
      updatedAt: sql`NOW()`,
    })
    .onConflictDoUpdate({
      target: [userSiteRoles.userId, userSiteRoles.siteId, userSiteRoles.source],
      set: { role: sql`excluded.role`, updatedAt: sql`NOW()` },
    })
    .returning();

  const row = rows[0];
  if (!row) {
    return errorResponse('Failed to grant access', 500);
  }
  return jsonResponse(
    {
      id: row.id,
      userId: row.userId,
      siteId: row.siteId,
      role: row.role,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
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
  const rows = await db()
    .select({
      id: userSiteRoles.id,
      userId: userSiteRoles.userId,
      siteId: userSiteRoles.siteId,
      role: userSiteRoles.role,
      source: userSiteRoles.source,
      createdAt: userSiteRoles.createdAt,
      updatedAt: userSiteRoles.updatedAt,
      email: users.email,
      name: users.name,
    })
    .from(userSiteRoles)
    .leftJoin(users, sql`${users.id}::text = ${userSiteRoles.userId}`)
    .where(eq(userSiteRoles.siteId, context.siteId))
    .orderBy(asc(userSiteRoles.createdAt));

  const collaborators = rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    siteId: row.siteId,
    role: row.role,
    source: row.source,
    email: row.email ?? null,
    name: row.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

  // Prevent removing the last owner — the site would become unmanageable
  const ownerCountRows = await db()
    .select({ count: count() })
    .from(userSiteRoles)
    .where(and(eq(userSiteRoles.siteId, context.siteId), eq(userSiteRoles.role, 'owner')));
  const ownerCount = ownerCountRows[0]?.count ?? 0;
  if (ownerCount <= 1) {
    // Check if the user being removed is an owner
    const targetRoleRows = await db()
      .select({ role: userSiteRoles.role })
      .from(userSiteRoles)
      .where(and(eq(userSiteRoles.userId, context.userId), eq(userSiteRoles.siteId, context.siteId)));
    if (targetRoleRows[0]?.role === 'owner') {
      return errorResponse('Cannot remove the last owner of a site', 409);
    }
  }

  const deleted = await db()
    .delete(userSiteRoles)
    .where(
      and(
        eq(userSiteRoles.userId, context.userId),
        eq(userSiteRoles.siteId, context.siteId),
        eq(userSiteRoles.source, 'local'),
      ),
    )
    .returning({ id: userSiteRoles.id });

  if (deleted.length === 0) {
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
    const mainBranch = await getMainBranch(context.siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }

    // Single collaborator operations (with userId) — writes only, require canManageGrants
    if (context.userId !== undefined) {
      await assertPermission(
        context.principal,
        context.siteId,
        mainBranch.id,
        'canManageGrants',
        context.masClient,
      );
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
        // All site members may list collaborators; writes require canManageGrants.
        await assertPermission(
          context.principal,
          context.siteId,
          mainBranch.id,
          'canView',
          context.masClient,
        );
        return await handleListCollaborators(context);
      case 'POST':
        await assertPermission(
          context.principal,
          context.siteId,
          mainBranch.id,
          'canManageGrants',
          context.masClient,
        );
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
