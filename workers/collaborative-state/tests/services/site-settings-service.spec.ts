import { describe, it, expect, vi, beforeEach } from 'vitest';

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
      const { updateSiteSettings, InvalidSettingsError } = await import('../../src/services/site-settings-service');

      await expect(
        updateSiteSettings('site-123', { cacheTtlMain: -1 }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should reject negative cacheTtlBranch', async () => {
      const { updateSiteSettings, InvalidSettingsError } = await import('../../src/services/site-settings-service');

      await expect(
        updateSiteSettings('site-123', { cacheTtlBranch: -5 }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should reject non-integer cacheTtlMain', async () => {
      const { updateSiteSettings, InvalidSettingsError } = await import('../../src/services/site-settings-service');

      await expect(
        updateSiteSettings('site-123', { cacheTtlMain: 3.5 }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should reject non-integer cacheTtlBranch', async () => {
      const { updateSiteSettings, InvalidSettingsError } = await import('../../src/services/site-settings-service');

      await expect(
        updateSiteSettings('site-123', { cacheTtlBranch: 2.7 }),
      ).rejects.toThrow(InvalidSettingsError);
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
      const { updateSiteSettings, InvalidSettingsError } = await import('../../src/services/site-settings-service');

      await expect(
        updateSiteSettings('site-123', { ogImage: 42 as unknown as string }),
      ).rejects.toThrow(InvalidSettingsError);
    });

    it('should reject a blank ogLocale rather than storing it', async () => {
      const { updateSiteSettings, InvalidSettingsError } = await import('../../src/services/site-settings-service');

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
