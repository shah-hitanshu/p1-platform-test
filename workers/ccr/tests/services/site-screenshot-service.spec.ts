/**
 * Site Screenshot Service Tests
 *
 * Tests for CRUD on app.site_screenshots and the cron-side staleness query.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { InferSelectModel } from 'drizzle-orm';
import { siteScreenshots, sites } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  upsertSiteScreenshot,
  getSiteScreenshot,
  listSitesNeedingScreenshotRefresh,
} from '../../src/services/site-screenshot-service';

type ScreenshotRow = InferSelectModel<typeof siteScreenshots>;

function createRow(overrides: Partial<ScreenshotRow> = {}): ScreenshotRow {
  return {
    siteId: 'site-uuid-123',
    r2Key: 'screenshots/site-uuid-123.png',
    status: 'ok',
    capturedAt: new Date('2026-05-08T10:00:00.000Z'),
    error: null,
    createdAt: new Date('2026-05-08T10:00:00.000Z'),
    updatedAt: new Date('2026-05-08T10:00:00.000Z'),
    ...overrides,
  };
}

describe('Site Screenshot Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  describe('upsertSiteScreenshot', () => {
    it('keeps one row per site, replacing the previous capture and refreshing updated_at', async () => {
      database.on(siteScreenshots).insert.returns([createRow()]);

      await upsertSiteScreenshot({
        siteId: 'site-uuid-123',
        r2Key: 'screenshots/site-uuid-123.png',
        status: 'ok',
        capturedAt: '2026-05-08T10:00:00.000Z',
      });

      const statement = database.calls(siteScreenshots).insert[0]?.sql ?? '';
      expect(statement).toMatch(/on conflict\s*\("site_id"\)\s*do update/i);
      expect(statement).toMatch(/"updated_at"\s*=\s*NOW\(\)/i);
    });

    it('writes the site id, R2 key, status, capture time, and error', async () => {
      database.on(siteScreenshots).insert.returns([createRow({ status: 'failed', error: 'HTTP 404' })]);

      await upsertSiteScreenshot({
        siteId: 'site-uuid-123',
        r2Key: 'screenshots/site-uuid-123.png',
        status: 'failed',
        capturedAt: '2026-05-08T10:00:00.000Z',
        error: 'HTTP 404',
      });

      expect(database.calls(siteScreenshots).insert[0]?.params).toEqual([
        'site-uuid-123',
        'screenshots/site-uuid-123.png',
        'failed',
        '2026-05-08T10:00:00.000Z',
        'HTTP 404',
      ]);
    });

    it('writes NULL for the error when the capture succeeded', async () => {
      database.on(siteScreenshots).insert.returns([createRow()]);

      await upsertSiteScreenshot({
        siteId: 'site-uuid-123',
        r2Key: 'screenshots/site-uuid-123.png',
        status: 'ok',
        capturedAt: '2026-05-08T10:00:00.000Z',
      });

      expect(database.calls(siteScreenshots).insert[0]?.params).toContain(null);
    });

    it('returns the stored row as a SiteScreenshot', async () => {
      database.on(siteScreenshots).insert.returns([
        createRow({
          siteId: 'site-uuid-456',
          r2Key: 'screenshots/site-uuid-456.png',
          status: 'failed',
          capturedAt: new Date('2026-05-08T11:00:00.000Z'),
          error: 'auth_gated: title looked like a login page',
          createdAt: new Date('2026-05-01T10:00:00.000Z'),
          updatedAt: new Date('2026-05-08T11:00:00.000Z'),
        }),
      ]);

      const result = await upsertSiteScreenshot({
        siteId: 'site-uuid-456',
        r2Key: 'screenshots/site-uuid-456.png',
        status: 'failed',
        capturedAt: '2026-05-08T11:00:00.000Z',
        error: 'auth_gated: title looked like a login page',
      });

      expect(result).toEqual({
        siteId: 'site-uuid-456',
        r2Key: 'screenshots/site-uuid-456.png',
        status: 'failed',
        capturedAt: new Date('2026-05-08T11:00:00.000Z'),
        error: 'auth_gated: title looked like a login page',
        createdAt: new Date('2026-05-01T10:00:00.000Z'),
        updatedAt: new Date('2026-05-08T11:00:00.000Z'),
      });
    });
  });

  describe('getSiteScreenshot', () => {
    it('returns null when no row exists', async () => {
      const result = await getSiteScreenshot('site-uuid-123');
      expect(result).toBeNull();
    });

    it('returns the mapped SiteScreenshot when a row exists', async () => {
      database.on(siteScreenshots).select.returns([createRow({ siteId: 'site-uuid-789' })]);

      const result = await getSiteScreenshot('site-uuid-789');

      expect(result).not.toBeNull();
      expect(result?.siteId).toBe('site-uuid-789');
      expect(result?.r2Key).toBe('screenshots/site-uuid-123.png');
      expect(result?.status).toBe('ok');
    });

    it('maps a NULL error column to undefined', async () => {
      database.on(siteScreenshots).select.returns([createRow({ error: null })]);

      const result = await getSiteScreenshot('site-uuid-123');
      expect(result?.error).toBeUndefined();
    });

    it('looks the row up by site id', async () => {
      await getSiteScreenshot('site-uuid-abc');

      expect(database.calls(siteScreenshots).select[0]?.params).toEqual(['site-uuid-abc']);
    });
  });

  describe('listSitesNeedingScreenshotRefresh', () => {
    it('selects sites with a URL whose screenshot is missing or past the staleness window', async () => {
      await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });

      const statement = database.calls(sites).select[0]?.sql ?? '';
      expect(statement).toMatch(/left join "app"\."site_screenshots"/i);
      expect(statement).toMatch(/"url" is not null/i);
      expect(statement).toMatch(/"captured_at" is null/i);
      expect(statement).toMatch(/interval '1 day'/i);
    });

    it('orders the never-captured sites ahead of the merely stale ones', async () => {
      await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });

      const statement = database.calls(sites).select[0]?.sql ?? '';
      expect(statement).toMatch(/order by "app"\."site_screenshots"\."captured_at" ASC NULLS FIRST/i);
    });

    it('passes staleAfterDays and limit as parameters', async () => {
      await listSitesNeedingScreenshotRefresh({ staleAfterDays: 14, limit: 100 });

      expect(database.calls(sites).select[0]?.params).toEqual([14, 'ok', 100]);
    });

    it('returns the site id and URL of every stale site', async () => {
      database.on(sites).select.returns([
        { id: 'site-1', url: 'https://one.example.com' },
        { id: 'site-2', url: 'https://two.example.com' },
      ]);

      const result = await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });

      expect(result).toEqual([
        { siteId: 'site-1', url: 'https://one.example.com' },
        { siteId: 'site-2', url: 'https://two.example.com' },
      ]);
    });

    it('returns an empty list when nothing is stale', async () => {
      const result = await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });
      expect(result).toEqual([]);
    });

    it('picks up a failed capture for retry regardless of capturedAt age', async () => {
      await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });

      const statement = database.calls(sites).select[0]?.sql ?? '';
      // A freshly-failed row (capturedAt just now) must still be selected,
      // so the query has to check status independently of the age check.
      expect(statement).toMatch(/"status"\s*<>\s*\$\d+/i);
      expect(database.calls(sites).select[0]?.params).toContain('ok');
    });
  });
});
