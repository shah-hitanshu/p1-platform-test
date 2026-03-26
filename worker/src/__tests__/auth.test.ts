import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAuth } from '../auth';
import { Env } from '../types';

function createEnv(): Env {
  return {
    MEDIA_BUCKET: {} as R2Bucket,
    CSS_BASE_URL: 'https://css.example.com',
  };
}

function createRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set('Authorization', authHeader);
  }
  return new Request('https://worker.example.com/media', { headers });
}

describe('validateAuth', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Clear the token cache between tests by re-importing would be ideal,
    // but since the cache is module-scoped, we use unique tokens per test instead.
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns false when no Authorization header', async () => {
    const env = createEnv();
    const request = createRequest();
    const result = await validateAuth(request, env);
    expect(result).toBe(false);
  });

  it('returns false when Authorization header does not start with "Bearer "', async () => {
    const env = createEnv();
    const request = createRequest('Basic abc123');
    const result = await validateAuth(request, env);
    expect(result).toBe(false);
  });

  it('returns false when bearer token is empty', async () => {
    const env = createEnv();
    const request = createRequest('Bearer ');
    const result = await validateAuth(request, env);
    expect(result).toBe(false);
  });

  it('returns true when CSS backend returns 200', async () => {
    const env = createEnv();
    const token = 'valid-token-200-' + Math.random();
    const request = createRequest(`Bearer ${token}`);

    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const result = await validateAuth(request, env);
    expect(result).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://css.example.com/api/auth/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
        }),
      }),
    );
  });

  it('uses service binding with real CSS_BASE_URL when CSS_SERVICE is available', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const env: Env = {
      MEDIA_BUCKET: {} as R2Bucket,
      CSS_BASE_URL: 'https://css.example.com',
      CSS_SERVICE: { fetch: mockFetch } as unknown as Fetcher,
    };
    const token = 'service-binding-token-' + Math.random();
    const request = createRequest(`Bearer ${token}`);

    const result = await validateAuth(request, env);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the request uses the real CSS URL, not a synthetic one
    const calledRequest = mockFetch.mock.calls[0][0] as Request;
    expect(calledRequest.url).toBe('https://css.example.com/api/auth/me');
    expect(calledRequest.method).toBe('GET');
    expect(calledRequest.headers.get('Authorization')).toBe(`Bearer ${token}`);
  });

  it('returns false when CSS backend returns 401', async () => {
    const env = createEnv();
    const token = 'invalid-token-401-' + Math.random();
    const request = createRequest(`Bearer ${token}`);

    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));

    const result = await validateAuth(request, env);
    expect(result).toBe(false);
  });

  it('returns false when CSS backend fetch throws', async () => {
    const env = createEnv();
    const token = 'error-token-throw-' + Math.random();
    const request = createRequest(`Bearer ${token}`);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await validateAuth(request, env);
    expect(result).toBe(false);
  });

  it('caches valid tokens so second call does not hit CSS backend', async () => {
    const env = createEnv();
    const token = 'cached-token-' + Math.random();

    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = mockFetch;

    const request1 = createRequest(`Bearer ${token}`);
    const result1 = await validateAuth(request1, env);
    expect(result1).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const request2 = createRequest(`Bearer ${token}`);
    const result2 = await validateAuth(request2, env);
    expect(result2).toBe(true);
    // Should still be 1 call — served from cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('expired cache entries re-validate against CSS backend', async () => {
    const env = createEnv();
    const token = 'expiring-token-' + Math.random();

    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = mockFetch;

    // First call — populates cache
    const request1 = createRequest(`Bearer ${token}`);
    await validateAuth(request1, env);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Fast-forward time past the 60s cache TTL
    const originalDateNow = Date.now;
    Date.now = () => originalDateNow() + 61_000;

    try {
      const request2 = createRequest(`Bearer ${token}`);
      await validateAuth(request2, env);
      // Should have made a second fetch because cache expired
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalDateNow;
    }
  });
});
