/**
 * Phase 7.1.1b: Site API Routes
 *
 * REST API endpoints for site operations.
 * Includes deletion protection for sites with non-archived branches.
 */

import type { WorkflowSettings } from '../types';
import {
  createSite,
  getSite,
  updateSite,
  deleteSite,
  listSites,
  listBranches,
  createMainBranch,
  DuplicatePantheonSiteIdError,
  InvalidSiteParamsError,
} from '../services';
import { validatePagination } from './validation';

/**
 * Request context for site routes
 */
export interface SiteRouteContext {
  siteId?: string;
  principal: {
    id: string;
    type: 'user' | 'agent';
  };
}

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  return json as T;
}

/**
 * Request body for creating a site
 */
interface CreateSiteBody {
  pantheonSiteId?: string;
  name?: string;
  workflowSettings?: Partial<WorkflowSettings>;
}

/**
 * Request body for updating a site
 */
interface UpdateSiteBody {
  name?: string;
  workflowSettings?: Partial<WorkflowSettings>;
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
 * Handle POST /api/sites - Create Site
 *
 * Creates a new site and automatically creates the main branch.
 * The main branch represents the production state of the site.
 */
async function handleCreateSite(
  request: Request,
  context: SiteRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<CreateSiteBody>(request);

  // Validate required fields
  if (body.pantheonSiteId === undefined || body.pantheonSiteId.trim() === '') {
    return errorResponse('pantheonSiteId is required', 400);
  }

  if (body.name === undefined || body.name.trim() === '') {
    return errorResponse('name is required', 400);
  }

  const site = await createSite({
    pantheonSiteId: body.pantheonSiteId,
    name: body.name,
    workflowSettings: body.workflowSettings,
  });

  // Automatically create the main branch for the new site
  // The main branch represents the production state
  await createMainBranch({
    siteId: site.id,
    createdById: context.principal.id,
    createdByType: context.principal.type,
  });

  return jsonResponse(site, 201);
}

/**
 * Handle GET /api/sites - List Sites
 */
async function handleListSites(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  // Validate pagination parameters
  const pagination = validatePagination(limitParam, offsetParam);
  if (!pagination.valid) {
    return errorResponse(pagination.error ?? 'Invalid pagination parameters', 400);
  }

  const sites = await listSites({
    limit: pagination.limit,
    offset: pagination.offset,
  });

  return jsonResponse({ sites });
}

/**
 * Handle GET /api/sites/{siteId} - Get Site
 */
async function handleGetSite(context: SiteRouteContext): Promise<Response> {
  if (context.siteId === undefined) {
    return errorResponse('Site ID is required', 400);
  }

  const site = await getSite(context.siteId);

  if (site === null) {
    return errorResponse('Site not found', 404);
  }

  return jsonResponse(site);
}

/**
 * Handle PATCH /api/sites/{siteId} - Update Site
 */
async function handleUpdateSite(
  request: Request,
  context: SiteRouteContext,
): Promise<Response> {
  if (context.siteId === undefined) {
    return errorResponse('Site ID is required', 400);
  }

  const body = await parseJsonBody<UpdateSiteBody>(request);

  const updatedSite = await updateSite(context.siteId, {
    name: body.name,
    workflowSettings: body.workflowSettings,
  });

  if (updatedSite === null) {
    return errorResponse('Site not found', 404);
  }

  return jsonResponse(updatedSite);
}

/**
 * Handle DELETE /api/sites/{siteId} - Delete Site
 *
 * Site can only be deleted when all branches are archived.
 * Returns 409 if any non-archived branches exist.
 */
async function handleDeleteSite(context: SiteRouteContext): Promise<Response> {
  if (context.siteId === undefined) {
    return errorResponse('Site ID is required', 400);
  }

  // Check for non-archived branches
  const branches = await listBranches(context.siteId);
  const nonArchivedBranches = branches.filter(
    (b) => b.status !== 'archived' && b.status !== 'merged',
  );

  if (nonArchivedBranches.length > 0) {
    return errorResponse(
      'Cannot delete site with non-archived branches. Archive or delete all branches first.',
      409,
      { branchCount: nonArchivedBranches.length },
    );
  }

  const deleted = await deleteSite(context.siteId);

  if (!deleted) {
    return errorResponse('Site not found', 404);
  }

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for site operations
 */
export async function handleSiteRoutes(
  request: Request,
  context: SiteRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Routes with siteId (single site operations)
    if (context.siteId !== undefined) {
      switch (method) {
        case 'GET':
          return await handleGetSite(context);
        case 'PATCH':
          return await handleUpdateSite(request, context);
        case 'DELETE':
          return await handleDeleteSite(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes without siteId (collection operations)
    switch (method) {
      case 'GET':
        return await handleListSites(request);
      case 'POST':
        return await handleCreateSite(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof DuplicatePantheonSiteIdError) {
      return errorResponse('A site with this Pantheon site ID already exists', 409);
    }
    if (error instanceof InvalidSiteParamsError) {
      return errorResponse(error.message, 400);
    }

    // Log and return generic error for unknown errors
    console.error('Site API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
