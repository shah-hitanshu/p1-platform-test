/**
 * Site Settings Routes
 *
 * REST API endpoints for managing per-site settings.
 * Service principals are blocked from accessing these endpoints.
 *
 * GET   /api/sites/:siteId/settings  - Get site settings
 * PATCH /api/sites/:siteId/settings  - Update site settings
 */

import type { AuthenticatedPrincipal } from '../types';
import {
  getSiteSettings,
  updateSiteSettings,
  InvalidSettingsError,
} from '../services/site-settings-service';
import type { SiteSettingsUpdate } from '../services/site-settings-service';
import { getMainBranch } from '../services';
import { assertPermission, AuthorizationError } from '../auth/authorization';

/**
 * Route context for site settings endpoints
 */
export interface SiteSettingsRouteContext {
  siteId?: string;
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

/**
 * Main route handler for site settings operations
 */
export async function handleSiteSettingsRoutes(
  request: Request,
  context: SiteSettingsRouteContext,
): Promise<Response> {
  const { siteId, principal } = context;
  const method = request.method;

  // Service principals cannot access site settings
  if (principal.type === 'service') {
    return errorResponse('Service principals cannot manage site settings', 403);
  }

  // Validate siteId
  if (siteId === undefined || siteId.trim() === '') {
    return errorResponse('Site ID is required', 400);
  }

  try {
    // Verify site exists
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }

    switch (method) {
      case 'GET':
        return await handleGetSettings(siteId, mainBranch.id, principal);
      case 'PATCH':
        return await handleUpdateSettings(request, siteId, mainBranch.id, principal);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    if (error instanceof InvalidSettingsError) {
      return errorResponse(error.message, 400);
    }
    console.error('Site Settings API error:', error);
    return errorResponse('Internal server error', 500);
  }
}

async function handleGetSettings(
  siteId: string,
  mainBranchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  await assertPermission(principal, siteId, mainBranchId, 'canView');
  const settings = await getSiteSettings(siteId);
  return jsonResponse({ settings });
}

async function handleUpdateSettings(
  request: Request,
  siteId: string,
  mainBranchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  await assertPermission(principal, siteId, mainBranchId, 'canManageGrants');
  const body: Record<string, unknown> = await request.json();

  // Only allow known settings fields
  const filtered: SiteSettingsUpdate = {};
  if ('cacheTtlMain' in body) filtered.cacheTtlMain = body.cacheTtlMain as number | null;
  if ('cacheTtlBranch' in body) filtered.cacheTtlBranch = body.cacheTtlBranch as number | null;
  if ('ogImage' in body) filtered.ogImage = body.ogImage as string | null;
  if ('ogLocale' in body) filtered.ogLocale = body.ogLocale as string | null;

  const settings = await updateSiteSettings(siteId, filtered);

  if (settings === null) {
    return errorResponse('Site not found', 404);
  }

  return jsonResponse({ settings });
}
