/**
 * Site Settings Routes
 *
 * REST API endpoints for managing per-site settings.
 * Service principals are blocked from accessing these endpoints.
 *
 * GET   /api/sites/:siteId/settings  - Get site settings
 * PATCH /api/sites/:siteId/settings  - Update site settings
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { AuthenticatedPrincipal } from '../types';
import {
  getSiteSettings,
  updateSiteSettings,
  localeCountsForRegistry,
} from '../services/site-settings-service';
import type {
  SiteLocales,
  SiteSettingsUpdate,
} from '../services/site-settings-service';
import { countDocumentsByLocale, getMainBranch, HttpError } from '../services';
import { assertPermission } from '../auth/authorization';

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
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status);
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

  // A localized site also gets the per-locale document counts, which is what
  // tells an admin what dropping a market would strand. They decorate one
  // interstitial, so losing them leaves the rest of the settings readable.
  if (settings?.locales === undefined) {
    return jsonResponse({ settings });
  }

  let localeCounts: Record<string, number> | undefined;
  try {
    localeCounts = localeCountsForRegistry(
      settings.locales,
      await countDocumentsByLocale(siteId),
    );
  } catch (error) {
    getLogger().error('Locale document counts unavailable', error, { siteId });
  }

  return jsonResponse(
    localeCounts === undefined ? { settings } : { settings, localeCounts },
  );
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
  if ('locales' in body) filtered.locales = body.locales as SiteLocales | null;

  const settings = await updateSiteSettings(siteId, filtered);

  if (settings === null) {
    return errorResponse('Site not found', 404);
  }

  return jsonResponse({ settings });
}
