/**
 * Site Lookup Service Tests
 *
 * Tests lookupSiteAuthConfig() which calls the main CSS worker via service binding
 * to retrieve a site's allowed origins for OAuth redirect URI validation.
 */

import { describe, it, expect, vi } from 'vitest';
import { lookupSiteAuthConfig } from '../../src/services/site-lookup.js';

function makeMockFetcher(status: number, body: unknown): Fetcher {
  return {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status }),
    ),
  } as unknown as Fetcher;
}

const INTERNAL_SECRET = 'test-secret';

describe('lookupSiteAuthConfig', () => {
  it('returns allowedOrigins for a known site', async () => {
    const fetcher = makeMockFetcher(200, {
      siteId: 'site-123',
      allowedOrigins: ['https://mysite.com'],
    });
    const result = await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-123');
    expect(result).not.toBeNull();
    expect(result!.allowedOrigins).toEqual(['https://mysite.com']);
  });

  it('returns null for a missing site (404)', async () => {
    const fetcher = makeMockFetcher(404, { error: 'Site not found' });
    const result = await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'missing');
    expect(result).toBeNull();
  });

  it('throws when the CSS worker returns 500', async () => {
    const fetcher = makeMockFetcher(500, { error: 'DB error' });
    await expect(
      lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1'),
    ).rejects.toThrow('Site auth config lookup failed: 500');
  });

  it('sends X-Internal-Secret header', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ siteId: 'site-1', allowedOrigins: [] }), { status: 200 }),
    );
    const fetcher = { fetch: mockFetch } as unknown as Fetcher;
    await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1');
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-Internal-Secret']).toBe(INTERNAL_SECRET);
  });

  it('sends request to correct endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ siteId: 'site-1', allowedOrigins: [] }), { status: 200 }),
    );
    const fetcher = { fetch: mockFetch } as unknown as Fetcher;
    await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1');
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/internal/site-auth-config/site-1');
  });

  it('returns empty allowedOrigins array when site has none configured', async () => {
    const fetcher = makeMockFetcher(200, { siteId: 'site-1', allowedOrigins: [] });
    const result = await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1');
    expect(result).not.toBeNull();
    expect(result!.allowedOrigins).toEqual([]);
  });

  it('throws a descriptive error when response body is missing allowedOrigins', async () => {
    // If the main CSS worker returns a response without allowedOrigins (e.g. schema mismatch),
    // we must surface a clear error rather than passing undefined to matchesAllowedOrigin.
    const fetcher = makeMockFetcher(200, { siteId: 'site-1' });
    await expect(
      lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1'),
    ).rejects.toThrow('Invalid site config response: missing allowedOrigins');
  });

  it('throws a descriptive error when response body is not an object', async () => {
    const fetcher = makeMockFetcher(200, 'unexpected string');
    await expect(
      lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1'),
    ).rejects.toThrow('Invalid site config response: missing allowedOrigins');
  });
});
