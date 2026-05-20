/**
 * Site Screenshot Routes
 *
 * GET /api/sites/{siteId}/screenshot — returns an R2 presigned URL for
 * the site's current screenshot, or a 404 with a structured status
 * payload when nothing is available (never captured, or last attempt
 * failed). The URL is valid for 24 hours.
 */

import type { AuthenticatedPrincipal } from '../types';
import { getSiteScreenshot } from '../services/site-screenshot-service';
import { getMainBranch } from '../services';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { signR2GetUrl } from '../storage/r2-presign';
import { jsonResponse, errorResponse } from '../utils/http-helpers';

export interface SiteScreenshotRouteContext {
  siteId?: string;
  principal: AuthenticatedPrincipal;
}

export interface SiteScreenshotEnv {
  R2_SCREENSHOTS_BUCKET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

const PRESIGN_TTL_SECONDS = 24 * 60 * 60;

export async function handleSiteScreenshotRoutes(
  request: Request,
  context: SiteScreenshotRouteContext,
  env: SiteScreenshotEnv,
): Promise<Response> {
  const { siteId, principal } = context;

  if (siteId === undefined || siteId.trim() === '') {
    return errorResponse('Site ID is required', 400);
  }

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }

    await assertPermission(principal, siteId, mainBranch.id, 'canView');

    const screenshot = await getSiteScreenshot(siteId);
    if (screenshot === null) {
      return jsonResponse({ status: 'missing', error: 'No screenshot has been captured yet' }, 404);
    }
    if (screenshot.status !== 'ok') {
      return jsonResponse({
        status: screenshot.status,
        error: screenshot.error ?? 'Capture failed',
        capturedAt: screenshot.capturedAt,
      }, 404);
    }

    const { R2_SCREENSHOTS_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
    if (
      R2_SCREENSHOTS_BUCKET === undefined || R2_SCREENSHOTS_BUCKET === '' ||
      R2_ACCOUNT_ID === undefined || R2_ACCOUNT_ID === '' ||
      R2_ACCESS_KEY_ID === undefined || R2_ACCESS_KEY_ID === '' ||
      R2_SECRET_ACCESS_KEY === undefined || R2_SECRET_ACCESS_KEY === ''
    ) {
      console.error('Site screenshot route: R2 presigning credentials are not configured');
      return errorResponse('Internal server error', 500);
    }

    const signed = await signR2GetUrl({
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: R2_SCREENSHOTS_BUCKET,
      key: screenshot.r2Key,
      ttlSeconds: PRESIGN_TTL_SECONDS,
    });

    return jsonResponse({
      url: signed.url,
      expiresAt: signed.expiresAt,
      capturedAt: screenshot.capturedAt,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    console.error('Site screenshot API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
