/**
 * Screenshots API Module
 */

import { API_BASE_URL, getToken, ApiClientError } from './client';

export interface ScreenshotOk {
  kind: 'ok';
  url: string;
  expiresAt: string;
  capturedAt: string;
}

export interface ScreenshotMissing {
  kind: 'missing';
  error: string;
}

export interface ScreenshotFailed {
  kind: 'failed';
  error: string;
  capturedAt?: string;
}

export type SiteScreenshotResponse = ScreenshotOk | ScreenshotMissing | ScreenshotFailed;

interface ScreenshotOkBody {
  url: string;
  expiresAt: string;
  capturedAt: string;
}

interface ScreenshotErrorBody {
  status?: string;
  error?: string;
  capturedAt?: string;
}

/**
 * Fetch the current screenshot metadata for a site.
 *
 * 200 → presigned URL payload (kind: 'ok')
 * 404 → structured "missing" or "failed" payload — resolved, not thrown,
 *       since the absence of a screenshot is a normal UI state.
 * Any other non-2xx → throws ApiClientError so the generic error path runs.
 */
export async function getSiteScreenshot(siteId: string): Promise<SiteScreenshotResponse> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}/api/sites/${siteId}/screenshot`, { headers });

  if (response.ok) {
    const body = (await response.json()) as ScreenshotOkBody;
    return { kind: 'ok', url: body.url, expiresAt: body.expiresAt, capturedAt: body.capturedAt };
  }

  if (response.status === 404) {
    const body = (await response.json().catch(() => ({}))) as ScreenshotErrorBody;
    if (body.status === 'failed') {
      return {
        kind: 'failed',
        error: body.error ?? 'Capture failed',
        capturedAt: body.capturedAt,
      };
    }
    return { kind: 'missing', error: body.error ?? 'No screenshot has been captured yet' };
  }

  const errorText = await response.text().catch(() => '');
  throw new ApiClientError(errorText || 'Failed to load screenshot', response.status);
}
