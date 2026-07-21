/**
 * Users API Routes
 *
 * REST API endpoints for managing system-level user allowlist.
 * Supports listing, adding, updating, and removing users.
 * All endpoints require system admin role.
 */

import type { AuthenticatedPrincipal } from '../types';
import { query } from '../db';

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

/**
 * Check if the current principal is a system admin.
 * If no users exist in the table, the current principal is treated as admin.
 */
async function isSystemAdmin(principal: AuthenticatedPrincipal): Promise<boolean> {
  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM app.users',
  );
  const countRow = countResult.rows[0];
  if (countRow === undefined) {
    return false;
  }
  const userCount = parseInt(countRow.count, 10);

  // If no users exist, treat current principal as admin (bootstrap mode)
  if (userCount === 0) {
    return true;
  }

  // Check if the principal has admin role
  const adminResult = await query<{ system_role: string }>(
    'SELECT system_role FROM app.users WHERE principal_id = $1 AND is_active = true',
    [principal.id],
  );

  const adminRow = adminResult.rows[0];
  if (adminRow === undefined) {
    return false;
  }

  return adminRow.system_role === 'admin';
}

interface AddUserBody {
  email?: string;
  name?: string;
  systemRole?: string;
}

/**
 * Handle POST /api/admin/users - Add a user to the allowlist
 */
async function handleAddUser(
  request: Request,
  context: UsersRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<AddUserBody>(request);

  if (body.email === undefined || body.email.trim() === '') {
    return errorResponse('email is required', 400);
  }

  const email = body.email.trim().toLowerCase();
  const name = body.name?.trim() ?? null;
  const systemRole = body.systemRole ?? 'member';

  const validRoles = ['admin', 'member'];
  if (!validRoles.includes(systemRole)) {
    return errorResponse(
      `Invalid systemRole. Must be one of: ${validRoles.join(', ')}`,
      400,
    );
  }

  // Bootstrap: if this is the first user being added, auto-add the current
  // principal as admin so they don't get locked out when the allowlist activates.
  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM app.users',
  );
  const countRow = countResult.rows[0];
  const currentCount = countRow !== undefined ? parseInt(countRow.count, 10) : 0;

  if (currentCount === 0 && context.principal.email !== undefined) {
    const principalEmail = context.principal.email.toLowerCase();
    if (principalEmail !== email) {
      await query(
        `INSERT INTO app.users (email, principal_id, auth_provider, system_role)
         VALUES ($1, $2, $3, 'admin')
         ON CONFLICT (email) DO NOTHING`,
        [principalEmail, context.principal.id, context.principal.authProvider ?? 'unknown'],
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
    const validRoles = ['admin', 'member'];
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

  const result = await query(
    'DELETE FROM app.users WHERE id = $1',
    [context.userId],
  );

  if (result.rowCount === 0) {
    return errorResponse('User not found', 404);
  }

  return new Response(null, { status: 204 });
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
    console.error('Users API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
