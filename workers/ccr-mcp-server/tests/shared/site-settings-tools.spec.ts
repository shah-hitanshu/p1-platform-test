/**
 * get_site_settings / update_site_settings Tool Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

const userConfig = { baseUrl: 'http://localhost:8787', accessToken: 'auth0-token' };

const settingsResponse = {
  settings: {
    cacheTtlMain: 60,
    cacheTtlBranch: 5,
    ogImage: 'https://cdn.example.com/og.png',
    ogLocale: 'en_US',
    locales: { markets: ['en-US', 'fr-FR'], policy: 'fallback' },
  },
  localeCounts: { 'en-US': 12, 'fr-FR': 7 },
};

async function makeHandlers() {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const { createToolHandlers } = await import('../../src/shared/tools.js');
  return createToolHandlers(new McpApiClient(userConfig));
}

describe('get_site_settings tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders every setting and the per-locale counts', async () => {
    const handlers = await makeHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, settingsResponse));

    const result = await handlers.get_site_settings({ site_id: 'site-1' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('60s');
    expect(text).toContain('https://cdn.example.com/og.png');
    expect(text).toContain('en_US');
    expect(text).toContain('fallback');
    expect(text).toContain('en-US=12');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/settings');
    expect(init.method).toBe('GET');
  });

  it('spells out unset fields on a bare site', async () => {
    const handlers = await makeHandlers();
    mockFetch.mockResolvedValueOnce(
      createMockResponse(true, { settings: { cacheTtlMain: 60, cacheTtlBranch: 5 } }),
    );

    const result = await handlers.get_site_settings({ site_id: 'site-1' });

    const text = result.content[0].text;
    expect(text).toContain('(not set)');
    expect(text).toContain('(not localized)');
    expect(text).not.toContain('undefined');
  });

  it('surfaces a backend error', async () => {
    const handlers = await makeHandlers();
    mockFetch.mockResolvedValueOnce(
      createMockResponse(false, { error: 'Service principals cannot manage site settings' }, 403),
    );

    const result = await handlers.get_site_settings({ site_id: 'site-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Service principals');
  });
});

describe('update_site_settings tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('maps snake_case inputs onto the camelCase wire body', async () => {
    const handlers = await makeHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, settingsResponse));

    await handlers.update_site_settings({
      site_id: 'site-1',
      cache_ttl_main: 300,
      og_image: 'https://cdn.example.com/new.png',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/settings');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      cacheTtlMain: 300,
      ogImage: 'https://cdn.example.com/new.png',
    });
  });

  it('sends an explicit null to clear a setting', async () => {
    const handlers = await makeHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, settingsResponse));

    await handlers.update_site_settings({ site_id: 'site-1', og_image: null, locales: null });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toHaveProperty('ogImage', null);
    expect(body).toHaveProperty('locales', null);
  });

  it('omits keys that were not supplied', async () => {
    const handlers = await makeHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, settingsResponse));

    await handlers.update_site_settings({ site_id: 'site-1', cache_ttl_main: 120 });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const keys = Object.keys(JSON.parse(init.body as string) as Record<string, unknown>);
    // Key presence is the wire contract: a null here would clear the stored value.
    expect(keys).toEqual(['cacheTtlMain']);
  });

  it('passes the locales object through whole', async () => {
    const handlers = await makeHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, settingsResponse));

    await handlers.update_site_settings({
      site_id: 'site-1',
      locales: { markets: ['en-US'], policy: 'localized-only' },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      locales: { markets: ['en-US'], policy: 'localized-only' },
    });
  });

  it('rejects a call that supplies no settings', async () => {
    const handlers = await makeHandlers();

    const result = await handlers.update_site_settings({ site_id: 'site-1' });

    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces the backend TTL ceiling message', async () => {
    const handlers = await makeHandlers();
    mockFetch.mockResolvedValueOnce(
      createMockResponse(
        false,
        { error: 'cacheTtlMain must be a positive integer no greater than 86400 (one day), got 999999' },
        400,
      ),
    );

    const result = await handlers.update_site_settings({ site_id: 'site-1', cache_ttl_main: 999999 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('86400');
  });
});
