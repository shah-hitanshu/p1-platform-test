/**
 * Users API Routes
 *
 * Platform-wide user administration: listing, adding, updating and removing
 * app.users rows across every organization. Every /api/admin/users endpoint
 * requires system admin. The one exception is GET /api/users/me, which reports
 * only on the caller and so is open to any authenticated user.
 *
 * PCC-3479: this is *not* the endpoint the dashboard uses to manage a business
 * account's people — see org-users-api.ts for that. Adding a user here mints an
 * organization for them; adding one there joins them to an existing
 * organization. Reach for this one only for platform bootstrapping.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { AuthenticatedPrincipal } from '../types';
import { query } from '../db';
import { createOrgForUser } from '../services/organization-service';
import { recordAuditEntry } from '../services/audit-log-service';
import { isAdminSystemRole, isSystemAdmin } from '../utils/admin-check';
import { normalizePrincipalIdForDb } from '../auth/principal-id-normalization';

/**
 * Request context for user admin routes
 */
export interface UsersRouteContext {
  userId?: string;
  principal: AuthenticatedPrincipal;
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

interface AddUserBody {
  email?: string;
  name?: string;
  systemRole?: string;
  spaceName?: string;
  externalSpaceId?: string;
}

/**
 * PCC-3479: `superadmin` is assignable only here, on the platform-admin
 * surface — the org-scoped user API deliberately refuses to grant it.
 *
 * The legacy `admin` value is not offered: nothing reads it any more, so
 * assigning it would grant exactly nothing. Someone who administers a business
 * account gets organization_members.role = 'admin' in that account, which is a
 * different question from being Pantheon staff.
 */
const VALID_SYSTEM_ROLES = ['member', 'superadmin'];

/**
 * Handle POST /api/admin/users - Add a user to the allowlist
 */
async function handleAddUser(
  request: Request,
  context: UsersRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<AddUserBody>(request);

  const systemRole = body.systemRole ?? 'member';
  const validRoles = VALID_SYSTEM_ROLES;
  const trimmedEmail = body.email?.trim() ?? '';

  const validationErrors: string[] = [];

  if (trimmedEmail === '') {
    validationErrors.push('email is required');
  }
  if (body.spaceName !== undefined && body.spaceName.length > 255) {
    validationErrors.push('spaceName must be 255 characters or fewer');
  }
  if (body.externalSpaceId !== undefined && body.externalSpaceId.length > 255) {
    validationErrors.push('externalSpaceId must be 255 characters or fewer');
  }
  if (!validRoles.includes(systemRole)) {
    validationErrors.push(`Invalid systemRole. Must be one of: ${validRoles.join(', ')}`);
  }

  if (validationErrors.length > 0) {
    return errorResponse(validationErrors.join('; '), 400, validationErrors);
  }

  const email = trimmedEmail.toLowerCase();
  const name = body.name?.trim() ?? null;

  // Bootstrap: if this is the first user being added, auto-add the current
  // principal as admin so they don't get locked out when the allowlist activates.
  const countResult = await query<{ populated: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM app.users) AS populated',
  );
  const isPopulated = countResult.rows[0]?.populated ?? false;

  if (!isPopulated && context.principal.email !== undefined) {
    const principalEmail = context.principal.email.toLowerCase();
    if (principalEmail !== email) {
      // PCC-3457: stamp the normalized (UUIDv5) form, never a raw OAuth
      // subject — the persistence actor resolver looks principal_id up by
      // UUIDv5 (see auth/principal-id-normalization.ts).
      await query(
        `INSERT INTO app.users (email, principal_id, auth_provider, system_role)
         VALUES ($1, $2, $3, 'superadmin')
         ON CONFLICT (email) DO NOTHING`,
        [principalEmail, await normalizePrincipalIdForDb(context.principal.id), context.principal.authProvider ?? 'unknown'],
      );
    }
  }

  // Check for duplicate email
  const existing = await query<{ id: string }>(
    'SELECT id FROM app.users WHERE email = $1',
    [email],
  );
  if (existing.rows.length > 0) {
    return errorResponse('A user with this email already exists', 409);
  }

  const result = await query<{
    id: string;
    email: string;
    name: string | null;
    principal_id: string | null;
    auth_provider: string | null;
    system_role: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO app.users (email, name, system_role)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, principal_id, auth_provider, system_role, is_active, created_at, updated_at`,
    [email, name, systemRole],
  );

  const row = result.rows[0];
  if (row === undefined) {
    return errorResponse('Failed to add user', 500);
  }

  try {
    await createOrgForUser(row.id, email, body.spaceName, body.externalSpaceId);
  } catch (orgError) {
    getLogger().error('Auto-create org failed for user', orgError, { user_id: row.id });
  }

  await recordAuditEntry({
    action: 'user.add',
    actor: context.principal,
    targetType: 'user',
    targetId: row.id,
    targetLabel: row.email,
    details: { systemRole: row.system_role },
  });

  return jsonResponse(
    {
      id: row.id,
      email: row.email,
      name: row.name,
      principalId: row.principal_id,
      authProvider: row.auth_provider,
      systemRole: row.system_role,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    201,
  );
}

/**
 * Handle GET /api/admin/users - List all users
 */
async function handleListUsers(
  _context: UsersRouteContext,
): Promise<Response> {
  const result = await query<{
    id: string;
    email: string;
    name: string | null;
    principal_id: string | null;
    auth_provider: string | null;
    system_role: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, email, name, principal_id, auth_provider, system_role, is_active, created_at, updated_at
     FROM app.users
     ORDER BY created_at ASC`,
  );

  const users = result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    principalId: row.principal_id,
    authProvider: row.auth_provider,
    systemRole: row.system_role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return jsonResponse({ users });
}

/**
 * Handle PATCH /api/admin/users/:userId - Update a user
 */
async function handleUpdateUser(
  request: Request,
  context: UsersRouteContext,
): Promise<Response> {
  if (context.userId === undefined || context.userId === '') {
    return errorResponse('userId is required', 400);
  }

  const body = await parseJsonBody<{
    name?: string;
    systemRole?: string;
    isActive?: boolean;
  }>(request);

  // Build dynamic update
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (body.name !== undefined) {
    updates.push(`name = $${String(paramIndex++)}`);
    values.push(body.name.trim());
  }

  if (body.systemRole !== undefined) {
    const validRoles = VALID_SYSTEM_ROLES;
    if (!validRoles.includes(body.systemRole)) {
      return errorResponse(
        `Invalid systemRole. Must be one of: ${validRoles.join(', ')}`,
        400,
      );
    }
    updates.push(`system_role = $${String(paramIndex++)}`);
    values.push(body.systemRole);
  }

  if (body.isActive !== undefined) {
    updates.push(`is_active = $${String(paramIndex++)}`);
    values.push(body.isActive);
  }

  if (updates.length === 0) {
    return errorResponse('No fields to update', 400);
  }

  updates.push('updated_at = NOW()');
  values.push(context.userId);

  const result = await query<{
    id: string;
    email: string;
    name: string | null;
    principal_id: string | null;
    auth_provider: string | null;
    system_role: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE app.users SET ${updates.join(', ')}
     WHERE id = $${String(paramIndex)}
     RETURNING id, email, name, principal_id, auth_provider, system_role, is_active, created_at, updated_at`,
    values,
  );

  const row = result.rows[0];
  if (row === undefined) {
    return errorResponse('User not found', 404);
  }

  await recordAuditEntry({
    action: 'user.update',
    actor: context.principal,
    targetType: 'user',
    targetId: row.id,
    targetLabel: row.email,
    // Only the fields the request actually set — an absent key means untouched.
    details: {
      ...(body.name !== undefined && { name: row.name }),
      ...(body.systemRole !== undefined && { systemRole: row.system_role }),
      ...(body.isActive !== undefined && { isActive: row.is_active }),
    },
  });

  return jsonResponse({
    id: row.id,
    email: row.email,
    name: row.name,
    principalId: row.principal_id,
    authProvider: row.auth_provider,
    systemRole: row.system_role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * Handle DELETE /api/admin/users/:userId - Remove a user
 */
async function handleRemoveUser(
  context: UsersRouteContext,
): Promise<Response> {
  if (context.userId === undefined || context.userId === '') {
    return errorResponse('userId is required', 400);
  }

  // RETURNING email so the audit entry can name who was deleted: the row is
  // gone afterwards, and the id on its own resolves to nothing.
  const result = await query<{ email: string }>(
    'DELETE FROM app.users WHERE id = $1 RETURNING email',
    [context.userId],
  );

  if (result.rowCount === 0) {
    return errorResponse('User not found', 404);
  }

  await recordAuditEntry({
    action: 'user.remove',
    actor: context.principal,
    targetType: 'user',
    targetId: context.userId,
    targetLabel: result.rows[0]?.email,
  });

  return new Response(null, { status: 204 });
}

/**
 * Handle GET /api/users/me — the caller's own record (PCC-3479).
 *
 * Unlike everything else in this file this is open to any authenticated user:
 * it only ever reports on the caller. No caller yet — the dashboard gates its
 * admin surfaces on the per-account `role` from /api/organizations/mine.
 */
export async function handleCurrentUserRoute(
  request: Request,
  context: UsersRouteContext,
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const { principal } = context;

  // Agents and service principals have no app.users row of their own; they are
  // never business-account admins, so report the shape without a role.
  if (principal.type !== 'user') {
    return jsonResponse({
      id: null,
      email: principal.email ?? null,
      name: principal.name ?? null,
      systemRole: null,
      isSystemAdmin: false,
      isActive: true,
    });
  }

  try {
    // The request gate already resolved this row, so prefer what it attached
    // and only fall back to a query for principals that bypassed enrichment.
    let row:
      | {
          id: string;
          email: string;
          name: string | null;
          system_role: string;
          is_active: boolean;
        }
      | undefined;

    if (principal.dbUserId === undefined || principal.systemRole === undefined) {
      const result = await query<{
        id: string;
        email: string;
        name: string | null;
        system_role: string;
        is_active: boolean;
      }>(
        'SELECT id, email, name, system_role, is_active FROM app.users WHERE principal_id = $1',
        [await normalizePrincipalIdForDb(principal.id)],
      );
      row = result.rows[0];
    }

    const systemRole = row?.system_role ?? principal.systemRole ?? null;

    return jsonResponse({
      id: row?.id ?? principal.dbUserId ?? null,
      email: row?.email ?? principal.email ?? null,
      name: row?.name ?? principal.name ?? null,
      systemRole,
      // Precomputed so the frontend never has to keep its own copy of which
      // roles count as administrative.
      isSystemAdmin: isAdminSystemRole(systemRole),
      isActive: row?.is_active ?? true,
    });
  } catch (error) {
    getLogger().error('Current user API error', error instanceof Error ? error : new Error(String(error)), {});
    return errorResponse('Internal server error', 500);
  }
}

/**
 * Main route handler for user admin operations
 */
export async function handleUsersRoutes(
  request: Request,
  context: UsersRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Check system admin permission
    const admin = await isSystemAdmin(context.principal);
    if (!admin) {
      return errorResponse('System admin access required', 403);
    }

    // Single user operations (with userId)
    if (context.userId !== undefined) {
      switch (method) {
        case 'PATCH':
          return await handleUpdateUser(request, context);
        case 'DELETE':
          return await handleRemoveUser(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Collection operations
    switch (method) {
      case 'GET':
        return await handleListUsers(context);
      case 'POST':
        return await handleAddUser(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    getLogger().error('Users API error', error instanceof Error ? error : new Error(String(error)), {});
    return errorResponse('Internal server error', 500);
  }
}
