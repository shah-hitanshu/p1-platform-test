import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAuth } from '../auth';
import type { Env } from '../types';

const TEST_SITE_ID = 'site-123';

function createEnv(): Env {
  return {
    MEDIA_BUCKET: {} as R2Bucket,
    MEDIA_DB: {} as D1Database, // auth.ts does not touch D1 — present only to satisfy Env
    CCR_BASE_URL: 'https://ccr.example.com',
    CDN_BASE_URL: 'https://cdn.example.com/p1',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET_NAME: 'test-bucket',
    IMAGES: {} as ImagesBinding,
  };
}

function createRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set('Authorization', authHeader);
  }
  return new Request('https://worker.example.com/media', { headers });
}

function siteOkResponse(): Response {
  return new Response(JSON.stringify({ id: TEST_SITE_ID, name: 'Test Site' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('validateAuth', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns null when no Authorization header', async () => {
    const result = await validateAuth(createRequest(), createEnv(), TEST_SITE_ID);
    expect(result).toBeNull();
  });

  it('returns null when Authorization header does not start with "Bearer "', async () => {
    const result = await validateAuth(createRequest('Basic abc123'), createEnv(), TEST_SITE_ID);
    expect(result).toBeNull();
  });

  it('returns null when bearer token is empty', async () => {
    const result = await validateAuth(createRequest('Bearer '), createEnv(), TEST_SITE_ID);
    expect(result).toBeNull();
  });

  it('returns true when CCR returns 200 for the site', async () => {
    const env = createEnv();
    const token = 'valid-token-' + Math.random();

    globalThis.fetch = vi.fn().mockResolvedValue(siteOkResponse());

    const result = await validateAuth(createRequest(`Bearer ${token}`), env, TEST_SITE_ID);
    expect(result).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `https://ccr.example.com/api/sites/${TEST_SITE_ID}`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    );
  });

  it('uses service binding with real CCR_BASE_URL when CCR_SERVICE is available', async () => {
    const mockFetch = vi.fn().mockResolvedValue(siteOkResponse());
    const env: Env = {
      MEDIA_BUCKET: {} as R2Bucket,
      MEDIA_DB: {} as D1Database, // auth.ts does not touch D1 — present only to satisfy Env
      CCR_BASE_URL: 'https://ccr.example.com',
      CDN_BASE_URL: 'https://cdn.example.com/p1',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET_NAME: 'test-bucket',
      CCR_SERVICE: { fetch: mockFetch } as unknown as Fetcher,
      IMAGES: {} as ImagesBinding,
    };
    const token = 'service-binding-token-' + Math.random();

    const result = await validateAuth(createRequest(`Bearer ${token}`), env, TEST_SITE_ID);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const calledRequest = mockFetch.mock.calls[0][0] as Request;
    expect(calledRequest.url).toBe(`https://ccr.example.com/api/sites/${TEST_SITE_ID}`);
    expect(calledRequest.method).toBe('GET');
    expect(calledRequest.headers.get('Authorization')).toBe(`Bearer ${token}`);
  });

  it('returns false when CCR returns 403 (valid token, no site access)', async () => {
    const env = createEnv();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));

    const result = await validateAuth(createRequest(`Bearer valid-token-${Math.random()}`), env, TEST_SITE_ID);
    expect(result).toBe(false);
  });

  it('returns false when CCR returns 404 (site not found — treated as no access)', async () => {
    const env = createEnv();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

    const result = await validateAuth(createRequest(`Bearer valid-token-${Math.random()}`), env, TEST_SITE_ID);
    expect(result).toBe(false);
  });

  it('returns null when CCR returns 401 (invalid token)', async () => {
    const env = createEnv();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));

    const result = await validateAuth(createRequest(`Bearer invalid-token-${Math.random()}`), env, TEST_SITE_ID);
    expect(result).toBeNull();
  });

  it('returns null when CCR fetch throws', async () => {
    const env = createEnv();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await validateAuth(createRequest(`Bearer token-${Math.random()}`), env, TEST_SITE_ID);
    expect(result).toBeNull();
  });

  it('caches true results so second call does not hit CCR', async () => {
    const env = createEnv();
    const token = 'cached-token-' + Math.random();
    const mockFetch = vi.fn().mockResolvedValue(siteOkResponse());
    globalThis.fetch = mockFetch;

    const r1 = await validateAuth(createRequest(`Bearer ${token}`), env, TEST_SITE_ID);
    expect(r1).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const r2 = await validateAuth(createRequest(`Bearer ${token}`), env, TEST_SITE_ID);
    expect(r2).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1); // still 1 — served from cache
  });

  it('caches per siteId — same token, different site does not share cache', async () => {
    const env = createEnv();
    const token = 'multi-site-token-' + Math.random();
    const mockFetch = vi.fn().mockResolvedValue(siteOkResponse());
    globalThis.fetch = mockFetch;

    await validateAuth(createRequest(`Bearer ${token}`), env, 'site-aaa');
    await validateAuth(createRequest(`Bearer ${token}`), env, 'site-bbb');

    // Two CCR calls — one per site
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('expired cache entries re-validate against CCR', async () => {
    const env = createEnv();
    const token = 'expiring-token-' + Math.random();
    const mockFetch = vi.fn().mockResolvedValue(siteOkResponse());
    globalThis.fetch = mockFetch;

    await validateAuth(createRequest(`Bearer ${token}`), env, TEST_SITE_ID);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const originalDateNow = Date.now;
    Date.now = () => originalDateNow() + 61_000;
    try {
      await validateAuth(createRequest(`Bearer ${token}`), env, TEST_SITE_ID);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('does not cache false results — re-checks CCR on each request', async () => {
    const env = createEnv();
    const token = 'forbidden-token-' + Math.random();
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    globalThis.fetch = mockFetch;

    await validateAuth(createRequest(`Bearer ${token}`), env, TEST_SITE_ID);
    await validateAuth(createRequest(`Bearer ${token}`), env, TEST_SITE_ID);

    // Two CCR calls — false results are not cached
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
