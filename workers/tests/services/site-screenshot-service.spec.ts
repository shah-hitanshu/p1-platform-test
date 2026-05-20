/**
 * Site Screenshot Service Tests (TDD)
 *
 * Tests for CRUD on app.site_screenshots and the cron-side staleness query.
 * Written before implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Site Screenshot Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  interface MockSiteScreenshotRow {
    site_id: string;
    r2_key: string;
    status: string;
    captured_at: string;
    error: string | null;
    created_at: string;
    updated_at: string;
  }

  function createMockRow(overrides: Partial<MockSiteScreenshotRow> = {}): MockSiteScreenshotRow {
    return {
      site_id: 'site-uuid-123',
      r2_key: 'screenshots/site-uuid-123.png',
      status: 'ok',
      captured_at: '2026-05-08T10:00:00.000Z',
      error: null,
      created_at: '2026-05-08T10:00:00.000Z',
      updated_at: '2026-05-08T10:00:00.000Z',
      ...overrides,
    };
  }

  describe('upsertSiteScreenshot', () => {
    it('should issue INSERT ... ON CONFLICT (site_id) DO UPDATE', async () => {
      const { upsertSiteScreenshot } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [createMockRow()] });

      await upsertSiteScreenshot({
        siteId: 'site-uuid-123',
        r2Key: 'screenshots/site-uuid-123.png',
        status: 'ok',
        capturedAt: '2026-05-08T10:00:00.000Z',
      });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('INSERT INTO app.site_screenshots');
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('site_id');
      expect(sql).toContain('DO UPDATE');
    });

    it('should pass status, r2Key, capturedAt, and error as parameters', async () => {
      const { upsertSiteScreenshot } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [createMockRow({ status: 'failed', error: 'HTTP 404' })] });

      await upsertSiteScreenshot({
        siteId: 'site-uuid-123',
        r2Key: 'screenshots/site-uuid-123.png',
        status: 'failed',
        capturedAt: '2026-05-08T10:00:00.000Z',
        error: 'HTTP 404',
      });

      const params = vi.mocked(db.query).mock.calls[0][1];
      expect(params).toEqual(expect.arrayContaining([
        'site-uuid-123',
        'screenshots/site-uuid-123.png',
        'failed',
        'HTTP 404',
      ]));
    });

    it('should pass null when error is omitted', async () => {
      const { upsertSiteScreenshot } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [createMockRow()] });

      await upsertSiteScreenshot({
        siteId: 'site-uuid-123',
        r2Key: 'screenshots/site-uuid-123.png',
        status: 'ok',
        capturedAt: '2026-05-08T10:00:00.000Z',
      });

      const params = vi.mocked(db.query).mock.calls[0][1];
      expect(params).toContain(null);
    });

    it('should return the mapped SiteScreenshot from the returned row', async () => {
      const { upsertSiteScreenshot } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [createMockRow({
          site_id: 'site-uuid-456',
          r2_key: 'screenshots/site-uuid-456.png',
          status: 'failed',
          captured_at: '2026-05-08T11:00:00.000Z',
          error: 'auth_gated: title looked like a login page',
          created_at: '2026-05-01T10:00:00.000Z',
          updated_at: '2026-05-08T11:00:00.000Z',
        })],
      });

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
        capturedAt: '2026-05-08T11:00:00.000Z',
        error: 'auth_gated: title looked like a login page',
        createdAt: '2026-05-01T10:00:00.000Z',
        updatedAt: '2026-05-08T11:00:00.000Z',
      });
    });

    it('should refresh updated_at on conflict via NOW() in DO UPDATE', async () => {
      const { upsertSiteScreenshot } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [createMockRow()] });

      await upsertSiteScreenshot({
        siteId: 'site-uuid-123',
        r2Key: 'screenshots/site-uuid-123.png',
        status: 'ok',
        capturedAt: '2026-05-08T10:00:00.000Z',
      });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toMatch(/updated_at\s*=\s*NOW\(\)/i);
    });
  });

  describe('getSiteScreenshot', () => {
    it('should return null when no row exists', async () => {
      const { getSiteScreenshot } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getSiteScreenshot('site-uuid-123');
      expect(result).toBeNull();
    });

    it('should return the mapped SiteScreenshot when row exists', async () => {
      const { getSiteScreenshot } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [createMockRow({ site_id: 'site-uuid-789' })],
      });

      const result = await getSiteScreenshot('site-uuid-789');

      expect(result).not.toBeNull();
      expect(result?.siteId).toBe('site-uuid-789');
      expect(result?.r2Key).toBe('screenshots/site-uuid-123.png');
      expect(result?.status).toBe('ok');
    });

    it('should map a NULL error column to undefined', async () => {
      const { getSiteScreenshot } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [createMockRow({ error: null })],
      });

      const result = await getSiteScreenshot('site-uuid-123');
      expect(result?.error).toBeUndefined();
    });

    it('should query by site_id', async () => {
      const { getSiteScreenshot } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getSiteScreenshot('site-uuid-abc');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      const params = vi.mocked(db.query).mock.calls[0][1];
      expect(sql).toContain('app.site_screenshots');
      expect(sql).toContain('site_id');
      expect(params).toEqual(['site-uuid-abc']);
    });
  });

  describe('listSitesNeedingScreenshotRefresh', () => {
    it('should LEFT JOIN sites with site_screenshots and filter by url IS NOT NULL', async () => {
      const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toMatch(/LEFT\s+JOIN\s+app\.site_screenshots/i);
      expect(sql).toMatch(/url\s+IS\s+NOT\s+NULL/i);
    });

    it('should treat NULL captured_at as stale and filter by interval', async () => {
      const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toMatch(/captured_at\s+IS\s+NULL/i);
      expect(sql).toMatch(/interval/i);
    });

    it('should order by captured_at ascending with NULLs first', async () => {
      const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toMatch(/ORDER\s+BY\s+ss\.captured_at\s+ASC\s+NULLS\s+FIRST/i);
    });

    it('should pass staleAfterDays and limit as parameters', async () => {
      const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSitesNeedingScreenshotRefresh({ staleAfterDays: 14, limit: 100 });

      const params = vi.mocked(db.query).mock.calls[0][1];
      expect(params).toEqual(expect.arrayContaining([14, 100]));
    });

    it('should return an array of {siteId, url}', async () => {
      const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [
          { id: 'site-1', url: 'https://one.example.com' },
          { id: 'site-2', url: 'https://two.example.com' },
        ],
      });

      const result = await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });

      expect(result).toEqual([
        { siteId: 'site-1', url: 'https://one.example.com' },
        { siteId: 'site-2', url: 'https://two.example.com' },
      ]);
    });

    it('should return [] when no rows', async () => {
      const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listSitesNeedingScreenshotRefresh({ staleAfterDays: 7, limit: 500 });
      expect(result).toEqual([]);
    });
  });
});
