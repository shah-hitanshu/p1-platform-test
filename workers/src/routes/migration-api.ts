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
  MigrationJobNotFoundError,
} from '../services/migration-service';
import { getEffectiveRole, assertPermission, AuthorizationError } from '../auth/authorization';
import { getBranch, getBranchByName } from '../services';

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

class InvalidBodyError extends Error {
  constructor() { super('Request body must be a JSON object'); }
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
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<{ resolution: 'apply' | 'skip' | 'manual' }>(request);

  if (!['apply', 'skip', 'manual'].includes(body.resolution)) {
    return errorResponse('resolution must be one of: apply, skip, manual', 400);
  }

  const migrationPrincipal = {
    id: principal.dbUserId ?? principal.id,
    type: toPrincipalType(principal.type),
  };

  const conflict = await resolveMigrationConflict(conflictId, body.resolution, migrationPrincipal, jobId);

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

    // All migration operations require ADMIN role
    if (context.principal.type === 'service') {
      await assertPermission(context.principal, context.siteId, branchId, 'canEditDocuments');
    } else {
      const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
      if (roleName !== 'ADMIN') {
        throw new AuthorizationError('Migration operations require ADMIN role', 'canEditDocuments', roleName);
      }
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
      return await handleResolveConflict(request, context.jobId, context.conflictId, context.principal);
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
    if (error instanceof InvalidBodyError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    if (error instanceof MigrationJobNotFoundError) {
      return errorResponse(error.message, 404);
    }

    if (error instanceof SyntaxError) {
      return errorResponse('Invalid JSON in request body', 400);
    }

    console.error('Migration API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
