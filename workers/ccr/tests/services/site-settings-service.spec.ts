import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SiteSettingsUpdate } from '../../src/services/site-settings-service';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Site Settings Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getSiteSettings', () => {
    it('should return defaults when settings column is empty object', async () => {
      const db = await import('../../src/db');
      const { getSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: {} }],
        rowCount: 1,
      });

      const result = await getSiteSettings('site-123');
      expect(result).toEqual({
        cacheTtlMain: 60,
        cacheTtlBranch: 5,
      });
    });

    it('should merge site overrides with defaults', async () => {
      const db = await import('../../src/db');
      const { getSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: { cacheTtlMain: 120 } }],
        rowCount: 1,
      });

      const result = await getSiteSettings('site-123');
      expect(result).toEqual({
        cacheTtlMain: 120,
        cacheTtlBranch: 5,
      });
    });

    it('should handle settings returned as JSON string', async () => {
      const db = await import('../../src/db');
      const { getSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: JSON.stringify({ cacheTtlBranch: 10 }) }],
        rowCount: 1,
      });

      const result = await getSiteSettings('site-123');
      expect(result).toEqual({
        cacheTtlMain: 60,
        cacheTtlBranch: 10,
      });
    });

    it('should return null when site not found', async () => {
      const db = await import('../../src/db');
      const { getSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const result = await getSiteSettings('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateSiteSettings', () => {
    it('should construct correct JSONB merge SQL', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: { cacheTtlMain: 120 } }],
        rowCount: 1,
      });

      await updateSiteSettings('site-123', { cacheTtlMain: 120 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('||'),
        expect.arrayContaining(['site-123']),
      );
    });

    /**
     * postgres.js serializes a jsonb parameter itself, so a pre-stringified
     * value is JSON-encoded twice and Postgres stores a string scalar — which
     * `settings || $1::jsonb` appends to rather than merges, growing the column
     * into an array one element per write. This test sees only what the service
     * hands the driver; the database-backed guard is
     * tests/integration/site-settings.jsonb-serialization.integration.spec.ts.
     */
    it('binds the merged keys as an object, never a JSON string', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: { cacheTtlMain: 120 } }],
        rowCount: 1,
      });

      await updateSiteSettings('site-123', {
        cacheTtlMain: 120,
        locales: { markets: ['fr'], policy: 'fallback' },
      });

      const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
      expect(params[0]).toEqual({
        cacheTtlMain: 120,
        locales: { markets: ['fr'], policy: 'fallback' },
      });
    });

    it('binds the merged keys as an object when the same write also removes one', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: { cacheTtlMain: 120 } }],
        rowCount: 1,
      });

      await updateSiteSettings('site-123', { cacheTtlMain: 120, cacheTtlBranch: null });

      const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
      expect(params[0]).toEqual({ cacheTtlMain: 120 });
      expect(params[1]).toEqual(['cacheTtlBranch']);
    });

    it('should return updated settings merged with defaults', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: { cacheTtlMain: 120, cacheTtlBranch: 10 } }],
        rowCount: 1,
      });

      const result = await updateSiteSettings('site-123', { cacheTtlMain: 120, cacheTtlBranch: 10 });
      expect(result).toEqual({
        cacheTtlMain: 120,
        cacheTtlBranch: 10,
      });
    });

    it('should remove override when null is passed', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: {} }],
        rowCount: 1,
      });

      const result = await updateSiteSettings('site-123', { cacheTtlMain: null });
      expect(result).toEqual({
        cacheTtlMain: 60,
        cacheTtlBranch: 5,
      });
    });

    it('should return null when site not found', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const result = await updateSiteSettings('nonexistent', { cacheTtlMain: 120 });
      expect(result).toBeNull();
    });

    it('should reject negative cacheTtlMain', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', { cacheTtlMain: -1 }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should reject negative cacheTtlBranch', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', { cacheTtlBranch: -5 }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should reject non-integer cacheTtlMain', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', { cacheTtlMain: 3.5 }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should reject non-integer cacheTtlBranch', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', { cacheTtlBranch: 2.7 }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    // PCC-3676: an unbounded TTL lets stale/draft content persist in caches for
    // arbitrarily long; cap at one day.
    it('should reject cacheTtlBranch above the one-day ceiling', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', { cacheTtlBranch: 86_401 }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should reject cacheTtlMain above the one-day ceiling', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', { cacheTtlMain: 100_000 }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should accept a TTL exactly at the one-day ceiling', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: { cacheTtlBranch: 86_400 } }],
        rowCount: 1,
      });

      await expect(
        updateSiteSettings('site-123', { cacheTtlBranch: 86_400 }),
      ).resolves.not.toThrow();
    });

    it('should store the social defaults', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: { ogImage: 'https://cdn.example/social.png', ogLocale: 'en_US' } }],
        rowCount: 1,
      });

      const result = await updateSiteSettings('site-123', {
        ogImage: 'https://cdn.example/social.png',
        ogLocale: 'en_US',
      });

      expect(result).toEqual({
        cacheTtlMain: 60,
        cacheTtlBranch: 5,
        ogImage: 'https://cdn.example/social.png',
        ogLocale: 'en_US',
      });
    });

    it('should reject a non-string ogImage', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', { ogImage: 42 as unknown as string }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should reject a blank ogLocale rather than storing it', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', { ogLocale: '   ' }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should clear a social default when null is passed', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: {} }],
        rowCount: 1,
      });

      await updateSiteSettings('site-123', { ogImage: null });

      const [sql, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('settings - $1::text[]');
      expect(params[0]).toEqual(['ogImage']);
    });
  });

  describe('locale registry', () => {
    const locales = {
      markets: ['de', 'ja'],
      policy: 'fallback' as const,
    };

    /** The block as it reaches the database, read off the write. */
    async function storedLocales(update: SiteSettingsUpdate): Promise<unknown> {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ settings: {} }], rowCount: 1 });
      await updateSiteSettings('site-123', update);

      const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
      return (params[0] as { locales: unknown }).locales;
    }

    it('stores the markets and the policy', async () => {
      expect(await storedLocales({ locales })).toEqual({
        markets: ['de', 'ja'],
        policy: 'fallback',
      });
    });

    it('drops a key the registry does not carry', async () => {
      const stored = await storedLocales({
        locales: { source: 'en', markets: ['de'], policy: 'fallback' } as never,
      });

      expect(stored).toEqual({ markets: ['de'], policy: 'fallback' });
    });

    it('stores every tag in its normalized casing', async () => {
      expect(
        await storedLocales({
          locales: { markets: ['pt-br', 'zh-hans-cn'], policy: 'fallback' },
        }),
      ).toEqual({ markets: ['pt-BR', 'zh-Hans-CN'], policy: 'fallback' });
    });

    it('keeps the markets in the order they were given', async () => {
      const stored = await storedLocales({
        locales: { markets: ['ja', 'de', 'fr'], policy: 'fallback' },
      });

      expect((stored as { markets: string[] }).markets).toEqual(['ja', 'de', 'fr']);
    });

    it('rejects a market that repeats another market', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', {
          locales: { markets: ['de', 'de'], policy: 'fallback' },
        }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('rejects a market naming a language the site already publishes under a deprecated tag', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', {
          locales: { markets: ['he', 'iw'], policy: 'fallback' },
        }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('accepts a language tag outside any shortlist', async () => {
      expect(
        await storedLocales({
          locales: { markets: ['pt-PT', 'es-419'], policy: 'localized-only' },
        }),
      ).toEqual({ markets: ['pt-PT', 'es-419'], policy: 'localized-only' });
    });

    it('rejects a malformed language tag', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', {
          locales: { markets: ['german'], policy: 'fallback' },
        }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('rejects more markets than a registry may hold', async () => {
      const { updateSiteSettings, MAX_MARKETS } = await import(
        '../../src/services/site-settings-service'
      );

      await expect(
        updateSiteSettings('site-123', {
          locales: {
            markets: Array(MAX_MARKETS + 1).fill('de') as string[],
            policy: 'fallback',
          },
        }),
      ).rejects.toThrow(`locales.markets must name at most ${String(MAX_MARKETS)} locales`);
    });

    it('rejects a policy it does not recognize', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', {
          locales: {
            markets: [],
            policy: 'redirect' as unknown as 'fallback',
          },
        }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('rejects a registry that is not an object', async () => {
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');
      const { InvalidSettingsError } = await import('../../src/services/errors');

      await expect(
        updateSiteSettings('site-123', {
          locales: ['en', 'de'] as unknown as typeof locales,
        }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('clears the registry when null is passed', async () => {
      const db = await import('../../src/db');
      const { updateSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ settings: {} }], rowCount: 1 });
      await updateSiteSettings('site-123', { locales: null });

      const [sql, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('settings - $1::text[]');
      expect(params[0]).toEqual(['locales']);
    });

    it('reports counts under the registry\'s own tags, matching locales across aliases', async () => {
      const { localeCountsForRegistry } = await import('../../src/services/site-settings-service');

      // Pages written under a deprecated tag still belong to the market that
      // names the same locale.
      expect(
        localeCountsForRegistry(
          { markets: ['he', 'de'], policy: 'fallback' },
          { iw: 3, de: 12 },
        ),
      ).toEqual({ he: 3, de: 12 });
    });

    it('sums documents whose tags name one locale', async () => {
      const { localeCountsForRegistry } = await import('../../src/services/site-settings-service');

      expect(
        localeCountsForRegistry(
          { markets: ['he'], policy: 'fallback' },
          { he: 2, iw: 3 },
        ),
      ).toEqual({ he: 5 });
    });

    it('leaves a locale holding nothing out of the counts', async () => {
      const { localeCountsForRegistry } = await import('../../src/services/site-settings-service');

      expect(
        localeCountsForRegistry(
          { markets: ['de', 'ja'], policy: 'fallback' },
          { de: 12 },
        ),
      ).toEqual({ de: 12 });
    });

    it('ignores documents in a locale the site does not publish', async () => {
      const { localeCountsForRegistry } = await import('../../src/services/site-settings-service');

      expect(
        localeCountsForRegistry(
          { markets: ['de'], policy: 'fallback' },
          { de: 12, fr: 7 },
        ),
      ).toEqual({ de: 12 });
    });

    it('keeps regional variants of one language apart', async () => {
      const { localeCountsForRegistry } = await import('../../src/services/site-settings-service');

      expect(
        localeCountsForRegistry(
          { markets: ['es-ES', 'es-MX'], policy: 'fallback' },
          { 'es-ES': 4, 'es-MX': 9 },
        ),
      ).toEqual({ 'es-ES': 4, 'es-MX': 9 });
    });

    it('reads the stored registry back', async () => {
      const db = await import('../../src/db');
      const { getSiteSettings } = await import('../../src/services/site-settings-service');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ settings: { locales } }],
        rowCount: 1,
      });

      const result = await getSiteSettings('site-123');
      expect(result?.locales).toEqual(locales);
    });
  });

  describe('getEffectiveCacheTtl', () => {
    it('should return site override when present for main branch', async () => {
      const { getEffectiveCacheTtl } = await import('../../src/services/site-settings-service');

      const result = getEffectiveCacheTtl(
        { cacheTtlMain: 120 },
        true,
      );
      expect(result).toBe(120);
    });

    it('should return site override when present for non-main branch', async () => {
      const { getEffectiveCacheTtl } = await import('../../src/services/site-settings-service');

      const result = getEffectiveCacheTtl(
        { cacheTtlBranch: 10 },
        false,
      );
      expect(result).toBe(10);
    });

    it('should return env default for main branch when no site override', async () => {
      const { getEffectiveCacheTtl } = await import('../../src/services/site-settings-service');

      const result = getEffectiveCacheTtl(
        {},
        true,
        { defaultCacheTtlMain: 90 },
      );
      expect(result).toBe(90);
    });

    it('should return env default for non-main branch when no site override', async () => {
      const { getEffectiveCacheTtl } = await import('../../src/services/site-settings-service');

      const result = getEffectiveCacheTtl(
        {},
        false,
        { defaultCacheTtlBranch: 15 },
      );
      expect(result).toBe(15);
    });

    it('should return hardcoded default (60) for main when no overrides', async () => {
      const { getEffectiveCacheTtl } = await import('../../src/services/site-settings-service');

      const result = getEffectiveCacheTtl({}, true);
      expect(result).toBe(60);
    });

    it('should return hardcoded default (5) for non-main when no overrides', async () => {
      const { getEffectiveCacheTtl } = await import('../../src/services/site-settings-service');

      const result = getEffectiveCacheTtl({}, false);
      expect(result).toBe(5);
    });

    it('should fall back through env default to hardcoded when settings are null', async () => {
      const { getEffectiveCacheTtl } = await import('../../src/services/site-settings-service');

      expect(getEffectiveCacheTtl(null, true, { defaultCacheTtlMain: 90 })).toBe(90);
      expect(getEffectiveCacheTtl(null, true)).toBe(60);
      expect(getEffectiveCacheTtl(null, false)).toBe(5);
    });

    it('should prefer site override over env default', async () => {
      const { getEffectiveCacheTtl } = await import('../../src/services/site-settings-service');

      const result = getEffectiveCacheTtl(
        { cacheTtlMain: 300 },
        true,
        { defaultCacheTtlMain: 90 },
      );
      expect(result).toBe(300);
    });
  });
});
