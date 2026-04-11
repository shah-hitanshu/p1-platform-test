/**
 * Site Lookup Element Validation Tests
 *
 * Tests that lookupSiteAuthConfig() validates the contents of the allowedOrigins
 * array, not just that it is an array. A response with non-string or empty-string
 * elements must be rejected before reaching matchesAllowedOrigin().
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

describe('lookupSiteAuthConfig — allowedOrigins element validation', () => {
  it('throws when allowedOrigins contains a number', async () => {
    const fetcher = makeMockFetcher(200, {
      siteId: 'site-1',
      allowedOrigins: ['https://valid.example.com', 123],
    });

    await expect(
      lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1'),
    ).rejects.toThrow('Invalid site config response: allowedOrigins must be non-empty strings');
  });

  it('throws when allowedOrigins contains an empty string', async () => {
    const fetcher = makeMockFetcher(200, {
      siteId: 'site-1',
      allowedOrigins: ['https://valid.example.com', ''],
    });

    await expect(
      lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1'),
    ).rejects.toThrow('Invalid site config response: allowedOrigins must be non-empty strings');
  });

  it('throws when allowedOrigins contains null', async () => {
    const fetcher = makeMockFetcher(200, {
      siteId: 'site-1',
      allowedOrigins: ['https://valid.example.com', null],
    });

    await expect(
      lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1'),
    ).rejects.toThrow('Invalid site config response: allowedOrigins must be non-empty strings');
  });

  it('succeeds when allowedOrigins contains valid non-empty strings', async () => {
    const fetcher = makeMockFetcher(200, {
      siteId: 'site-1',
      allowedOrigins: ['https://app.example.com', 'https://staging.example.com'],
    });

    const result = await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1');

    expect(result).not.toBeNull();
    expect(result!.siteId).toBe('site-1');
    expect(result!.allowedOrigins).toEqual([
      'https://app.example.com',
      'https://staging.example.com',
    ]);
  });
});
