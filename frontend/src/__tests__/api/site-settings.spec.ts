/**
 * Site Settings API Client Tests (TDD - Red Phase)
 *
 * Tests for the site-settings API module that manages
 * per-site configuration (cache TTLs, etc.).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiGet, apiPatch } from '../../api/client';
import { getSiteSettings, updateSiteSettings } from '../../api/site-settings';
import type { SiteSettings } from '../../api/site-settings';

// Mock the base API client
vi.mock('../../api/client', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPatch = vi.mocked(apiPatch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSiteSettings', () => {
  it('should call GET /api/sites/{siteId}/settings', async () => {
    const mockSettings: SiteSettings = {
      cacheTtlMain: 120,
      cacheTtlBranch: 10,
    };
    mockedApiGet.mockResolvedValue(mockSettings);

    const result = await getSiteSettings('site-abc');

    expect(mockedApiGet).toHaveBeenCalledWith('/api/sites/site-abc/settings');
    expect(result).toEqual(mockSettings);
  });

  it('should return settings with undefined values when no overrides exist', async () => {
    const mockSettings: SiteSettings = {};
    mockedApiGet.mockResolvedValue(mockSettings);

    const result = await getSiteSettings('site-abc');

    expect(mockedApiGet).toHaveBeenCalledWith('/api/sites/site-abc/settings');
    expect(result).toEqual({});
  });

  it('should propagate errors from the API client', async () => {
    const error = new Error('Not found');
    mockedApiGet.mockRejectedValue(error);

    await expect(getSiteSettings('site-bad')).rejects.toThrow('Not found');
    expect(mockedApiGet).toHaveBeenCalledWith('/api/sites/site-bad/settings');
  });
});

describe('updateSiteSettings', () => {
  it('should call PATCH /api/sites/{siteId}/settings with the settings body', async () => {
    const updatedSettings: SiteSettings = {
      cacheTtlMain: 300,
      cacheTtlBranch: 15,
    };
    mockedApiPatch.mockResolvedValue(updatedSettings);

    const result = await updateSiteSettings('site-abc', {
      cacheTtlMain: 300,
      cacheTtlBranch: 15,
    });

    expect(mockedApiPatch).toHaveBeenCalledWith('/api/sites/site-abc/settings', {
      cacheTtlMain: 300,
      cacheTtlBranch: 15,
    });
    expect(result).toEqual(updatedSettings);
  });

  it('should allow partial updates with only some fields', async () => {
    const updatedSettings: SiteSettings = {
      cacheTtlMain: 300,
    };
    mockedApiPatch.mockResolvedValue(updatedSettings);

    const result = await updateSiteSettings('site-abc', { cacheTtlMain: 300 });

    expect(mockedApiPatch).toHaveBeenCalledWith('/api/sites/site-abc/settings', {
      cacheTtlMain: 300,
    });
    expect(result).toEqual(updatedSettings);
  });

  it('should propagate errors from the API client', async () => {
    const error = new Error('Server error');
    mockedApiPatch.mockRejectedValue(error);

    await expect(
      updateSiteSettings('site-bad', { cacheTtlMain: 300 })
    ).rejects.toThrow('Server error');

    expect(mockedApiPatch).toHaveBeenCalledWith('/api/sites/site-bad/settings', {
      cacheTtlMain: 300,
    });
  });
});
