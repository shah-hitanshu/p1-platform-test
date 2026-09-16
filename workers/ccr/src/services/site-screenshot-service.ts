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

import { and, eq, isNotNull, isNull, lt, ne, or, sql, type InferSelectModel } from 'drizzle-orm';
import type { SiteScreenshot, SiteScreenshotStatus } from '../types';
import { siteScreenshots, sites } from '../db/schema';
import { db } from '../db/scope';

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

function mapRowToSiteScreenshot(row: InferSelectModel<typeof siteScreenshots>): SiteScreenshot {
  return {
    siteId: row.siteId,
    r2Key: row.r2Key,
    status: row.status as SiteScreenshotStatus,
    capturedAt: row.capturedAt,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Insert or update the current screenshot row for a site.
 */
export async function upsertSiteScreenshot(
  params: UpsertSiteScreenshotParams,
): Promise<SiteScreenshot> {
  const rows = await db()
    .insert(siteScreenshots)
    .values({
      siteId: params.siteId,
      r2Key: params.r2Key,
      status: params.status,
      capturedAt: toDate(params.capturedAt),
      error: params.error ?? null,
    })
    .onConflictDoUpdate({
      target: siteScreenshots.siteId,
      set: {
        r2Key: sql`excluded.r2_key`,
        status: sql`excluded.status`,
        capturedAt: sql`excluded.captured_at`,
        error: sql`excluded.error`,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error('Failed to upsert site screenshot');
  }
  return mapRowToSiteScreenshot(row);
}

/**
 * Fetch the current screenshot row for a site. Returns null when none exists.
 */
export async function getSiteScreenshot(
  siteId: string,
): Promise<SiteScreenshot | null> {
  const rows = await db()
    .select()
    .from(siteScreenshots)
    .where(eq(siteScreenshots.siteId, siteId));

  const screenshotRow = rows[0];
  if (!screenshotRow) {
    return null;
  }

  return mapRowToSiteScreenshot(screenshotRow);
}

/**
 * Sites with a URL whose screenshot is missing, older than staleAfterDays,
 * or recorded as a non-'ok' (e.g. failed) capture. A failed capture is
 * picked up for retry on the next run regardless of how recent the failed
 * attempt was — capturedAt alone can't distinguish "just captured fine"
 * from "just failed", so status has to be checked too.
 * Used by the weekly cron handler to enqueue refreshes.
 */
export async function listSitesNeedingScreenshotRefresh(
  options: ListSitesNeedingScreenshotRefreshOptions,
): Promise<SiteNeedingScreenshotRefresh[]> {
  const rows = await db()
    // The `url IS NOT NULL` predicate below is what makes every selected url a string.
    .select({ id: sites.id, url: sql<string>`${sites.url}` })
    .from(sites)
    .leftJoin(siteScreenshots, eq(siteScreenshots.siteId, sites.id))
    .where(
      and(
        isNotNull(sites.url),
        or(
          isNull(siteScreenshots.capturedAt),
          lt(
            siteScreenshots.capturedAt,
            sql`NOW() - (${options.staleAfterDays}::int * interval '1 day')`,
          ),
          // A non-'ok' row (e.g. 'failed') is retried regardless of age; a
          // NULL status (no screenshot row yet) is already covered above.
          ne(siteScreenshots.status, 'ok'),
        ),
      ),
    )
    // A site with no screenshot at all is the stalest thing there is, so it sorts first.
    .orderBy(sql`${siteScreenshots.capturedAt} ASC NULLS FIRST`)
    .limit(options.limit);

  return rows.map((row) => ({ siteId: row.id, url: row.url }));
}
