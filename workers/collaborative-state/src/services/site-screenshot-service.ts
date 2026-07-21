/**
 * Site Screenshot Service
 *
 * Persistence for app.site_screenshots: one row per site, holding the
 * outcome of the most recent capture attempt and the R2 key for the
 * stored PNG (when status='ok').
 *
 * The capture pipeline UPSERTs after every attempt; the cron-side
 * staleness query selects sites whose URL is set and whose screenshot
 * is missing or older than the configured staleness window.
 */

import type { SiteScreenshot, SiteScreenshotStatus } from '../types';
import { query } from '../db';

export interface UpsertSiteScreenshotParams {
  siteId: string;
  r2Key: string;
  status: SiteScreenshotStatus;
  capturedAt: string | Date;
  error?: string;
}

export interface ListSitesNeedingScreenshotRefreshOptions {
  staleAfterDays: number;
  limit: number;
}

export interface SiteNeedingScreenshotRefresh {
  siteId: string;
  url: string;
}

interface SiteScreenshotRow {
  site_id: string;
  r2_key: string;
  status: string;
  captured_at: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToSiteScreenshot(row: SiteScreenshotRow): SiteScreenshot {
  return {
    siteId: row.site_id,
    r2Key: row.r2_key,
    status: row.status as SiteScreenshotStatus,
    capturedAt: row.captured_at,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Insert or update the current screenshot row for a site.
 */
export async function upsertSiteScreenshot(
  params: UpsertSiteScreenshotParams,
): Promise<SiteScreenshot> {
  const result = await query<SiteScreenshotRow>(
    `INSERT INTO app.site_screenshots
       (site_id, r2_key, status, captured_at, error)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (site_id) DO UPDATE
       SET r2_key      = EXCLUDED.r2_key,
           status      = EXCLUDED.status,
           captured_at = EXCLUDED.captured_at,
           error       = EXCLUDED.error,
           updated_at  = NOW()
     RETURNING *`,
    [
      params.siteId,
      params.r2Key,
      params.status,
      toIsoString(params.capturedAt),
      params.error ?? null,
    ],
  );

  return mapRowToSiteScreenshot(result.rows[0]);
}

/**
 * Fetch the current screenshot row for a site. Returns null when none exists.
 */
export async function getSiteScreenshot(
  siteId: string,
): Promise<SiteScreenshot | null> {
  const result = await query<SiteScreenshotRow>(
    'SELECT * FROM app.site_screenshots WHERE site_id = $1',
    [siteId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToSiteScreenshot(result.rows[0]);
}

/**
 * Sites with a URL whose screenshot is missing or older than staleAfterDays.
 * Used by the weekly cron handler to enqueue refreshes.
 */
export async function listSitesNeedingScreenshotRefresh(
  options: ListSitesNeedingScreenshotRefreshOptions,
): Promise<SiteNeedingScreenshotRefresh[]> {
  const result = await query<{ id: string; url: string }>(
    `SELECT s.id, s.url
       FROM app.sites s
       LEFT JOIN app.site_screenshots ss ON ss.site_id = s.id
      WHERE s.url IS NOT NULL
        AND (ss.captured_at IS NULL
             OR ss.captured_at < NOW() - ($1::int * interval '1 day'))
      ORDER BY ss.captured_at ASC NULLS FIRST
      LIMIT $2`,
    [options.staleAfterDays, options.limit],
  );

  return result.rows.map((row) => ({ siteId: row.id, url: row.url }));
}
