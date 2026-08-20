/**
 * Migration API Routes
 *
 * REST API endpoints for migration job and conflict operations.
 * Provides read access to migration jobs and conflict resolution.
 */

import type { AuthenticatedPrincipal } from '../types';
import {
  getMigrationJob,
  listMigrationConflicts,
  resolveMigrationConflict,
} from '../services/migration-service';
import { getEffectiveRole, AuthorizationError } from '../auth/authorization';
import { getBranch, getBranchByName, getMainBranch, HttpError, InvalidBodyError } from '../services';

const VALID_PRINCIPAL_TYPES = new Set(['user', 'agent', 'system', 'service']);

function toPrincipalType(type: string): 'user' | 'agent' | 'system' | 'service' {
  if (VALID_PRINCIPAL_TYPES.has(type)) return type as 'user' | 'agent' | 'system' | 'service';
  throw new Error(`Invalid principal type: ${type}`);
}

/**
 * Request context for migration routes
 */
export interface MigrationRouteContext {
  siteId: string;
  branchId?: string;
  jobId?: string;
  conflictId?: string;
  action?: 'conflicts' | 'resolve';
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
async function parseJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new InvalidBodyError();
  }
  return json as T;
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/migrations/{jobId}
 */
async function handleGetMigrationJob(
  jobId: string,
): Promise<Response> {
  const job = await getMigrationJob(jobId);
  return jsonResponse(job);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/migrations/{jobId}/conflicts
 */
async function handleListConflicts(
  jobId: string,
): Promise<Response> {
  const conflicts = await listMigrationConflicts(jobId);
  return jsonResponse({ conflicts });
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/migrations/{jobId}/conflicts/{conflictId}/resolve
 */
async function handleResolveConflict(
  request: Request,
  jobId: string,
  conflictId: string,
  mainBranchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<{ resolution: 'apply' | 'skip' | 'manual' }>(request);

  if (!['apply', 'skip', 'manual'].includes(body.resolution)) {
    return errorResponse('resolution must be one of: apply, skip, manual', 400);
  }

  const actorType = toPrincipalType(principal.type);
  const migrationPrincipal = {
    id: principal.dbUserId ?? principal.id,
    // A service principal migrates as a system actor — the only non-human type
    // the migration audit trail records.
    type: actorType === 'service' ? 'system' : actorType,
  };

  // Treat a blank path segment as "no expected job" rather than an id to match.
  const expectedJobId = jobId.trim() === '' ? undefined : jobId;
  const conflict = await resolveMigrationConflict(
    conflictId,
    body.resolution,
    migrationPrincipal,
    expectedJobId,
    mainBranchId,
  );

  return jsonResponse(conflict);
}

/**
 * Main route handler for migration operations
 */
export async function handleMigrationRoutes(
  request: Request,
  context: MigrationRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    if (context.branchId === undefined || context.branchId === '') {
      return errorResponse('Branch ID is required', 400);
    }

    // Resolve branch by UUID or name
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const branch = uuidPattern.test(context.branchId)
      ? await getBranch(context.branchId)
      : await getBranchByName(context.siteId, context.branchId);
    if (branch?.siteId !== context.siteId) {
      return errorResponse('Branch not found', 404);
    }

    const branchId = branch.id;

    // A conflict resolved on a non-main branch advances that branch's sync
    // override, not the shared edge; resolve main so the write can target it.
    const mainBranch = branch.isMain ? null : await getMainBranch(context.siteId);
    const mainBranchId = mainBranch?.id ?? branchId;

    // All migration operations require ADMIN role
    if (context.principal.type === 'service') {
      return errorResponse('Migration operations require ADMIN role', 403);
    }
    const { role, roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
    if (!role.canManageTemplates) {
      throw new AuthorizationError('Migration operations require ADMIN role', 'canManageTemplates', roleName);
    }

    // Verify job belongs to this site/branch when jobId is present
    if (context.jobId !== undefined) {
      const job = await getMigrationJob(context.jobId);
      if (job.siteId !== context.siteId || job.branchId !== branchId) {
        return errorResponse('Migration job not found', 404);
      }
    }

    // Resolve conflict
    if (context.action === 'resolve' && context.conflictId !== undefined && context.jobId !== undefined) {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleResolveConflict(request, context.jobId, context.conflictId, mainBranchId, context.principal);
    }

    // List conflicts
    if (context.action === 'conflicts' && context.jobId !== undefined) {
      if (method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleListConflicts(context.jobId);
    }

    // Get migration job
    if (context.jobId !== undefined) {
      if (method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleGetMigrationJob(context.jobId);
    }

    return errorResponse('Not found', 404);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return errorResponse('Invalid JSON in request body', 400);
    }

    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status);
    }

    console.error('Migration API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
