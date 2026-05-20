/**
 * Agent Politeness System - Phase 1.5: Organization API Routes
 *
 * REST API endpoints for organization operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import type { OrganizationSettings } from '../types';
import {
  createOrganization,
  getOrganizationById,
  updateOrganization,
  deleteOrganization,
  archiveOrganization,
  restoreOrganization,
  listOrganizations,
  linkSiteToOrganization,
  unlinkSiteFromOrganization,
  getSitesByOrganization,
  InvalidOrganizationParamsError,
  OrganizationHasSitesError,
  OrganizationHasActiveSitesError,
} from '../services';
import { validatePagination } from './validation';

/**
 * Request context for organization routes
 */
export interface OrganizationRouteContext {
  organizationId?: string;
  action?: string;
  subResource?: 'sites';
  subResourceId?: string;
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
 * Request body for creating an organization
 */
interface CreateOrganizationBody {
  name?: string;
  settings?: Partial<OrganizationSettings>;
}

/**
 * Request body for updating an organization
 */
interface UpdateOrganizationBody {
  name?: string;
  settings?: Partial<OrganizationSettings>;
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
 * Handle POST /api/organizations - Create Organization
 */
async function handleCreateOrganization(request: Request): Promise<Response> {
  const body = await parseJsonBody<CreateOrganizationBody>(request);

  // Validate required fields
  if (body.name === undefined || body.name.trim() === '') {
    return errorResponse('name is required', 400);
  }

  const organization = await createOrganization({
    name: body.name,
    settings: body.settings,
  });

  return jsonResponse(organization, 201);
}

/**
 * Handle GET /api/organizations - List Organizations
 */
async function handleListOrganizations(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  // Validate pagination parameters
  const pagination = validatePagination(limitParam, offsetParam);
  if (!pagination.valid) {
    return errorResponse(pagination.error ?? 'Invalid pagination parameters', 400);
  }

  const archivedParam = url.searchParams.get('archived');
  const archived = archivedParam === 'true' ? true : archivedParam === 'false' ? false : undefined;

  const organizations = await listOrganizations({
    limit: pagination.limit,
    offset: pagination.offset,
    archived,
  });

  return jsonResponse({ organizations });
}

/**
 * Handle GET /api/organizations/{organizationId} - Get Organization
 */
async function handleGetOrganization(context: OrganizationRouteContext): Promise<Response> {
  if (context.organizationId === undefined) {
    return errorResponse('Organization ID is required', 400);
  }

  const organization = await getOrganizationById(context.organizationId);

  if (organization === null) {
    return errorResponse('Organization not found', 404);
  }

  return jsonResponse(organization);
}

/**
 * Handle PATCH /api/organizations/{organizationId} - Update Organization
 */
async function handleUpdateOrganization(
  request: Request,
  context: OrganizationRouteContext,
): Promise<Response> {
  if (context.organizationId === undefined) {
    return errorResponse('Organization ID is required', 400);
  }

  const body = await parseJsonBody<UpdateOrganizationBody>(request);

  const updatedOrganization = await updateOrganization(context.organizationId, {
    name: body.name,
    settings: body.settings,
  });

  if (updatedOrganization === null) {
    return errorResponse('Organization not found', 404);
  }

  return jsonResponse(updatedOrganization);
}

/**
 * Handle DELETE /api/organizations/{organizationId} - Archive Organization (soft delete)
 */
async function handleDeleteOrganization(context: OrganizationRouteContext): Promise<Response> {
  if (context.organizationId === undefined) {
    return errorResponse('Organization ID is required', 400);
  }

  const result = await archiveOrganization(context.organizationId);

  if (result === false) {
    return errorResponse('Organization not found', 404);
  }
  if (result === 'already_archived') {
    return errorResponse('Organization is already archived', 409);
  }

  return new Response(null, { status: 204 });
}

/**
 * Handle POST /api/organizations/{organizationId}/restore - Restore archived organization
 */
async function handleRestoreOrganization(context: OrganizationRouteContext): Promise<Response> {
  if (context.organizationId === undefined) {
    return errorResponse('Organization ID is required', 400);
  }

  const restored = await restoreOrganization(context.organizationId);

  if (!restored) {
    return errorResponse('Organization not found or not archived', 404);
  }

  return jsonResponse({ restored: true });
}

/**
 * Handle GET /api/organizations/{organizationId}/sites - Get Organization Sites
 */
async function handleGetOrganizationSites(context: OrganizationRouteContext): Promise<Response> {
  if (context.organizationId === undefined) {
    return errorResponse('Organization ID is required', 400);
  }

  const sites = await getSitesByOrganization(context.organizationId);

  return jsonResponse({ sites });
}

/**
 * Handle POST /api/organizations/{organizationId}/sites/{siteId} - Link Site to Organization
 */
async function handleLinkSite(context: OrganizationRouteContext): Promise<Response> {
  if (context.organizationId === undefined || context.subResourceId === undefined) {
    return errorResponse('Organization ID and Site ID are required', 400);
  }

  const linked = await linkSiteToOrganization(context.subResourceId, context.organizationId);

  if (!linked) {
    return errorResponse('Site not found', 404);
  }

  return jsonResponse({ linked: true });
}

/**
 * Handle DELETE /api/organizations/{organizationId}/sites/{siteId} - Unlink Site from Organization
 */
async function handleUnlinkSite(context: OrganizationRouteContext): Promise<Response> {
  if (context.subResourceId === undefined) {
    return errorResponse('Site ID is required', 400);
  }

  await unlinkSiteFromOrganization(context.subResourceId);

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for organization operations
 */
export async function handleOrganizationRoutes(
  request: Request,
  context: OrganizationRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Handle sub-resource routes (sites)
    if (context.subResource === 'sites') {
      if (context.subResourceId !== undefined) {
        // /api/organizations/{id}/sites/{siteId}
        switch (method) {
          case 'POST':
            return await handleLinkSite(context);
          case 'DELETE':
            return await handleUnlinkSite(context);
          default:
            return errorResponse('Method not allowed', 405);
        }
      } else {
        // /api/organizations/{id}/sites
        switch (method) {
          case 'GET':
            return await handleGetOrganizationSites(context);
          default:
            return errorResponse('Method not allowed', 405);
        }
      }
    }

    // Routes with organizationId (single organization operations)
    if (context.organizationId !== undefined) {
      // POST /api/organizations/:orgId/restore
      if (method === 'POST' && context.action === 'restore') {
        return await handleRestoreOrganization(context);
      }

      switch (method) {
        case 'GET':
          return await handleGetOrganization(context);
        case 'PATCH':
          return await handleUpdateOrganization(request, context);
        case 'DELETE':
          return await handleDeleteOrganization(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes without organizationId (collection operations)
    switch (method) {
      case 'GET':
        return await handleListOrganizations(request);
      case 'POST':
        return await handleCreateOrganization(request);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof InvalidOrganizationParamsError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof OrganizationHasSitesError) {
      return errorResponse('Cannot delete organization with linked sites', 409);
    }
    if (error instanceof OrganizationHasActiveSitesError) {
      return errorResponse('Cannot archive organization with active sites', 409);
    }

    // Log and return generic error for unknown errors
    console.error('Organization API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
