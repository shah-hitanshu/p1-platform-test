/**
 * Site screenshot API client tests.
 *
 * Verifies the 200 ok / 404 missing / 404 failed branches resolve to a
 * discriminated union, and that other non-2xx statuses throw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClientError } from '../../api/client';
import { getSiteScreenshot } from '../../api/screenshots';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    API_BASE_URL: '',
    getToken: vi.fn(() => 'test-token'),
  };
});

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSiteScreenshot', () => {
  it('returns kind=ok with the presigned URL payload on 200', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          url: 'https://r2.example/site.png?sig=abc',
          expiresAt: '2026-05-11T00:05:00Z',
          capturedAt: '2026-05-10T22:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await getSiteScreenshot('site-abc');

    expect(result).toEqual({
      kind: 'ok',
      url: 'https://r2.example/site.png?sig=abc',
      expiresAt: '2026-05-11T00:05:00Z',
      capturedAt: '2026-05-10T22:00:00Z',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sites/site-abc/screenshot',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('returns kind=missing when the API returns a 404 with status=missing', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'missing', error: 'No screenshot has been captured yet' }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await getSiteScreenshot('site-abc');

    expect(result).toEqual({
      kind: 'missing',
      error: 'No screenshot has been captured yet',
    });
  });

  it('returns kind=failed with the captured error message on 404 status=failed', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'failed',
          error: 'HTTP 404',
          capturedAt: '2026-05-09T10:00:00Z',
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await getSiteScreenshot('site-abc');

    expect(result).toEqual({
      kind: 'failed',
      error: 'HTTP 404',
      capturedAt: '2026-05-09T10:00:00Z',
    });
  });

  it('throws ApiClientError on other non-2xx responses', async () => {
    mockFetch.mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(getSiteScreenshot('site-abc')).rejects.toBeInstanceOf(ApiClientError);
  });
});
