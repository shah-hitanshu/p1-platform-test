/**
 * Forwarding to the cacheable entrypoint.
 *
 * The cache key is the URL and excludes headers, so what survives the forward
 * decides what a cache hit can contain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exports as workerExports } from 'cloudflare:workers';
import {
  forwardToCachedContent,
  isCacheableContentRequest,
} from '../../src/routes/cached-content-forward';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon-systems/p1-telemetry')>();
  return { ...actual, getLogger: () => logger };
});

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
  (workerExports as Record<string, unknown>).CachedContent = { fetch: fetchSpy };
});

describe('isCacheableContentRequest', () => {
  it('accepts content GETs', () => {
    expect(isCacheableContentRequest({ handler: 'content' }, 'GET')).toBe(true);
  });

  it('rejects non-GET methods', () => {
    expect(isCacheableContentRequest({ handler: 'content' }, 'POST')).toBe(false);
  });

  // Only the content handler is URL-determined; everything else reads the
  // principal and must never be served from a shared cache. (Non-main branch
  // content stays cacheable here; the per-member gate that protects it runs in
  // index.ts before the forward — see content-cache-isolation.spec.ts [PCC-3676].)
  it.each(['document', 'site-tokens', 'content-redirects', 'branch'])(
    'rejects the %s handler',
    (handler) => {
      expect(isCacheableContentRequest({ handler }, 'GET')).toBe(false);
    },
  );
});

describe('forwardToCachedContent', () => {
  const url = 'https://api.example.com/api/sites/site-123/content/home?branch=main';

  it('preserves the URL, which is the cache key', async () => {
    await forwardToCachedContent(new Request(url, { method: 'GET' }));

    const forwarded = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe(url);
  });

  it('drops the sat_ token so it cannot reach a cacheable response', async () => {
    await forwardToCachedContent(new Request(url, {
      method: 'GET',
      headers: { 'X-API-Key': 'sat_secret', 'Authorization': 'Bearer nope' },
    }));

    const forwarded = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get('X-API-Key')).toBeNull();
    expect(forwarded.headers.get('Authorization')).toBeNull();
  });

  // A forwarded If-None-Match would produce a 304 cached under a bare URL key,
  // then served to clients that sent no matching ETag.
  // ?apiKey= is a supported auth path, and the URL is the cache key, so a
  // query-param token would otherwise be persisted into shared cache
  // infrastructure — and give every token its own cache entry.
  it('strips ?apiKey= from the URL it forwards', async () => {
    await forwardToCachedContent(new Request(
      'https://api.example.com/api/sites/site-123/content/home?apiKey=sat_secret&branch=main',
      { method: 'GET' },
    ));

    const forwarded = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).not.toContain('sat_secret');
    expect(new URL(forwarded.url).searchParams.get('apiKey')).toBeNull();
    expect(new URL(forwarded.url).searchParams.get('branch')).toBe('main');
  });

  it('gives two clients with different tokens the same cache key', async () => {
    const base = 'https://api.example.com/api/sites/site-123/content/home';
    await forwardToCachedContent(new Request(`${base}?apiKey=sat_a`, { method: 'GET' }));
    await forwardToCachedContent(new Request(`${base}?apiKey=sat_b`, { method: 'GET' }));

    const first = fetchSpy.mock.calls[0]?.[0] as Request;
    const second = fetchSpy.mock.calls[1]?.[0] as Request;
    expect(first.url).toBe(second.url);
  });

  it('drops If-None-Match so a 304 is never cached under the URL', async () => {
    await forwardToCachedContent(new Request(url, {
      method: 'GET',
      headers: { 'If-None-Match': '"v-1"' },
    }));

    const forwarded = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get('If-None-Match')).toBeNull();
  });

  it('returns the entrypoint response unchanged', async () => {
    fetchSpy.mockResolvedValue(new Response('{"cached":true}', { status: 200 }));

    const response = await forwardToCachedContent(new Request(url, { method: 'GET' }));

    expect(response).not.toBeNull();
    expect(await response?.text()).toBe('{"cached":true}');
  });

  // The exports map is empty unless the enable_ctx_exports compatibility flag
  // is set — losing the flag (or the exports config) must cost cache hits,
  // not 500 every published page on every site [PCC-3666].
  it('returns null instead of throwing when the loopback binding is missing', async () => {
    delete (workerExports as Record<string, unknown>).CachedContent;

    const response = await forwardToCachedContent(new Request(url, { method: 'GET' }));

    expect(response).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('CachedContent loopback binding unavailable'),
      undefined,
      expect.objectContaining({ outcome: 'fail_open' }),
    );
  });
});
