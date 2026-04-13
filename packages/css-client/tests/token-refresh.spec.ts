/**
 * Silent Token Refresh Tests (TDD - red phase)
 *
 * Tests for the silent token refresh feature:
 * - SessionExpiredError class
 * - BaseEndpoint.request() tokenRefresher behavior on 401
 * - CSSClient tokenRefresher propagation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CSSClient } from '../src/client.js';
import { AuthenticationError, SessionExpiredError } from '../src/errors.js';
import { BaseEndpoint } from '../src/endpoints/base.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// 1. SessionExpiredError
// ---------------------------------------------------------------------------

describe('SessionExpiredError', () => {
  it('is an instance of Error', () => {
    const err = new SessionExpiredError();
    expect(err).toBeInstanceOf(Error);
  });

  it('has name === "SessionExpiredError"', () => {
    const err = new SessionExpiredError();
    expect(err.name).toBe('SessionExpiredError');
  });

  it('has a default message when none is supplied', () => {
    const err = new SessionExpiredError();
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('accepts a custom message that overrides the default', () => {
    const err = new SessionExpiredError('Token could not be refreshed');
    expect(err.message).toBe('Token could not be refreshed');
  });

  it('is instanceof SessionExpiredError after prototype chain fix', () => {
    const err = new SessionExpiredError();
    expect(err).toBeInstanceOf(SessionExpiredError);
  });
});

// ---------------------------------------------------------------------------
// 2. BaseEndpoint.request() with tokenRefresher
// ---------------------------------------------------------------------------

describe('BaseEndpoint.request() tokenRefresher behavior', () => {
  const baseUrl = 'http://localhost:8787';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: build a BaseEndpoint with an optional tokenRefresher
  function makeEndpoint(
    tokenRefresher?: () => Promise<string | null>,
    authProvider?: () => Promise<string>,
  ): BaseEndpoint {
    return new BaseEndpoint({
      baseUrl,
      authProvider,
      tokenRefresher,
    });
  }

  // a. On 401, tokenRefresher is called and returns a fresh token → retry
  //    succeeds (200) → returns parsed response body
  it('(a) retries with fresh token after 401 and returns parsed response body', async () => {
    const freshToken = 'fresh-access-token-xyz';
    const tokenRefresher = vi.fn().mockResolvedValue(freshToken);
    const responseBody = { id: 'site-1', name: 'My Site' };

    // First call → 401; second call → 200
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseBody,
      });

    const endpoint = makeEndpoint(tokenRefresher);
    const result = await endpoint.request('/api/sites', { method: 'GET' });

    // tokenRefresher must have been called exactly once
    expect(tokenRefresher).toHaveBeenCalledTimes(1);

    // fetch must have been called twice total
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // The retry must carry the fresh token as a Bearer Authorization header
    const retryCall = mockFetch.mock.calls[1];
    expect(retryCall[1].headers['Authorization']).toBe(`Bearer ${freshToken}`);

    // The final result is the parsed body from the successful response
    expect(result).toEqual(responseBody);
  });

  // b. On 401, tokenRefresher returns null → throws SessionExpiredError
  it('(b) throws SessionExpiredError when tokenRefresher returns null', async () => {
    const tokenRefresher = vi.fn().mockResolvedValue(null);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const endpoint = makeEndpoint(tokenRefresher);

    await expect(endpoint.request('/api/sites', { method: 'GET' })).rejects.toThrow(
      SessionExpiredError,
    );

    // tokenRefresher was still called
    expect(tokenRefresher).toHaveBeenCalledTimes(1);

    // fetch was only called once (no retry when tokenRefresher returns null)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // c. On 401, retry with fresh token returns another 401 → throws SessionExpiredError
  it('(c) throws SessionExpiredError when retry with fresh token also returns 401', async () => {
    const freshToken = 'fresh-but-still-invalid-token';
    const tokenRefresher = vi.fn().mockResolvedValue(freshToken);

    // Both calls return 401
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });

    const endpoint = makeEndpoint(tokenRefresher);

    await expect(endpoint.request('/api/sites', { method: 'GET' })).rejects.toThrow(
      SessionExpiredError,
    );

    // tokenRefresher was called once to get the fresh token
    expect(tokenRefresher).toHaveBeenCalledTimes(1);

    // fetch was called twice: initial attempt + one retry
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // d. Without tokenRefresher, 401 → throws AuthenticationError (existing behavior unchanged)
  it('(d) throws AuthenticationError on 401 when no tokenRefresher is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const endpoint = makeEndpoint(/* no tokenRefresher */);

    await expect(endpoint.request('/api/sites', { method: 'GET' })).rejects.toThrow(
      AuthenticationError,
    );

    // fetch is only called once — no retry attempt
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // e. withPrincipal() propagates tokenRefresher to the new endpoint
  it('(e) withPrincipal() propagates tokenRefresher — fresh-token retry works on new endpoint', async () => {
    const freshToken = 'propagated-principal-token';
    const tokenRefresher = vi.fn().mockResolvedValue(freshToken);
    const responseBody = { id: 'site-2', name: 'Other Site' };

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseBody,
      });

    const original = makeEndpoint(tokenRefresher);
    const withUser = original.withPrincipal({ id: 'user-99', type: 'user' });

    const result = await withUser.request('/api/sites', { method: 'GET' });

    // tokenRefresher was propagated and called
    expect(tokenRefresher).toHaveBeenCalledTimes(1);

    // retry carried the fresh token
    const retryCall = mockFetch.mock.calls[1];
    expect(retryCall[1].headers['Authorization']).toBe(`Bearer ${freshToken}`);

    // principal header is present on the retry
    expect(retryCall[1].headers['X-Principal-Id']).toBe('user-99');

    expect(result).toEqual(responseBody);
  });

  // f. withSessionId() propagates tokenRefresher to the new endpoint
  it('(f) withSessionId() propagates tokenRefresher — fresh-token retry works on new endpoint', async () => {
    const freshToken = 'propagated-session-token';
    const tokenRefresher = vi.fn().mockResolvedValue(freshToken);
    const responseBody = { id: 'doc-42', path: '/page' };

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseBody,
      });

    const original = makeEndpoint(tokenRefresher);
    const withSession = original.withSessionId('session-abc-123');

    const result = await withSession.request('/api/sites/s1/documents', { method: 'GET' });

    // tokenRefresher was propagated and called
    expect(tokenRefresher).toHaveBeenCalledTimes(1);

    // retry carried the fresh token
    const retryCall = mockFetch.mock.calls[1];
    expect(retryCall[1].headers['Authorization']).toBe(`Bearer ${freshToken}`);

    // session header is present on the retry
    expect(retryCall[1].headers['X-Agent-Session-Id']).toBe('session-abc-123');

    expect(result).toEqual(responseBody);
  });
});

// ---------------------------------------------------------------------------
// 3. CSSClient.tokenRefresher propagation
// ---------------------------------------------------------------------------

describe('CSSClient tokenRefresher propagation', () => {
  const baseUrl = 'http://localhost:8787';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // g. CSSClient constructed with tokenRefresher passes it through to BaseEndpoint —
  //    verified by triggering a 401 and checking that tokenRefresher is invoked and
  //    the retry request is made with the returned token.
  it('(g) tokenRefresher is called on 401 and the retry uses the returned token', async () => {
    const freshToken = 'client-level-fresh-token';
    const tokenRefresher = vi.fn().mockResolvedValue(freshToken);
    const mockSite = { id: 'site-1', name: 'Test Site', pantheonSiteId: 'p1' };

    // Initial request → 401; retry → 200
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSite,
      });

    const client = new CSSClient({
      baseUrl,
      tokenRefresher,
    });

    const result = await client.sites.get('site-1');

    // The tokenRefresher was called once when the 401 was encountered
    expect(tokenRefresher).toHaveBeenCalledTimes(1);

    // fetch was called twice: once for the original request, once for the retry
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // The retry request must use the fresh token as Bearer Authorization
    const retryCall = mockFetch.mock.calls[1];
    expect(retryCall[1].headers['Authorization']).toBe(`Bearer ${freshToken}`);

    // The final result comes from the successful retry response
    expect(result).toEqual(mockSite);
  });

  it('(g2) tokenRefresher returning null on 401 throws SessionExpiredError through CSSClient', async () => {
    const tokenRefresher = vi.fn().mockResolvedValue(null);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const client = new CSSClient({
      baseUrl,
      tokenRefresher,
    });

    await expect(client.sites.list()).rejects.toThrow(SessionExpiredError);

    expect(tokenRefresher).toHaveBeenCalledTimes(1);
    // No retry when tokenRefresher returns null
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('(g3) CSSClient without tokenRefresher still throws AuthenticationError on 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const client = new CSSClient({ baseUrl, apiKey: 'test-api-key' });

    await expect(client.sites.list()).rejects.toThrow(AuthenticationError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
