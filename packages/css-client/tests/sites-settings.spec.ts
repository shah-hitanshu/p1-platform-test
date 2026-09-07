/**
 * sites.getSettings() reads a site's settings, including the locales it
 * publishes in. The market order is the site's own and is preserved, because it
 * is the order editors are shown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client sites.getSettings()', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests the settings for the given site', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ settings: {} }),
    });

    const client = new P1Client({ baseUrl, apiKey });
    await client.sites.getSettings('site-1');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/sites/site-1/settings');
    expect(init.method).toBe('GET');
  });

  it('returns the locales the site publishes in', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        settings: { locales: { markets: ['fr-FR', 'de-DE'], policy: 'fallback' } },
      }),
    });

    const client = new P1Client({ baseUrl, apiKey });
    const result = await client.sites.getSettings('site-1');

    expect(result.settings.locales).toEqual({
      markets: ['fr-FR', 'de-DE'],
      policy: 'fallback',
    });
  });

  it('preserves the market order the site configured', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        settings: { locales: { markets: ['ja-JP', 'de-DE', 'fr-FR'], policy: 'fallback' } },
      }),
    });

    const client = new P1Client({ baseUrl, apiKey });
    const result = await client.sites.getSettings('site-1');

    expect(result.settings.locales?.markets).toEqual(['ja-JP', 'de-DE', 'fr-FR']);
  });

  it('reports a site that publishes in no locales', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ settings: { cacheTtlMain: 60 } }),
    });

    const client = new P1Client({ baseUrl, apiKey });
    const result = await client.sites.getSettings('site-1');

    expect(result.settings.locales).toBeUndefined();
  });

  it('returns the per-locale document counts when the server sends them', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        settings: { locales: { markets: ['fr-FR'], policy: 'fallback' } },
        localeCounts: { 'fr-FR': 3 },
      }),
    });

    const client = new P1Client({ baseUrl, apiKey });
    const result = await client.sites.getSettings('site-1');

    expect(result.localeCounts).toEqual({ 'fr-FR': 3 });
  });
});
