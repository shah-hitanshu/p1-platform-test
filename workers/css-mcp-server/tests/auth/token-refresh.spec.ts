/**
 * Upstream Auth0 Token Refresh Tests
 *
 * The MCP server forwards the signed-in user's Auth0 access token to the backend.
 * That token expires; these cover minting a fresh one from the stored refresh
 * token so a human session outlives the upstream token's lifetime.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function okJson(data: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(data) } as Response;
}

function idToken(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify(claims));
  return `${header}.${payload}.sig`;
}

describe('exchangeAuth0Code refresh fields', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the refresh token and access-token lifetime from the response', async () => {
    const { exchangeAuth0Code } = await import('../../src/auth/auth0-handler.js');
    mockFetch.mockResolvedValueOnce(okJson({
      access_token: 'at1',
      id_token: idToken({ sub: 'auth0|u', email: 'u@e.com' }),
      refresh_token: 'rt1',
      token_type: 'Bearer',
      expires_in: 7200,
    }));

    const result = await exchangeAuth0Code({
      code: 'c',
      issuerBaseUrl: 'https://t.auth0.com',
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'https://mcp.example.com/callback',
    });

    expect(result.refreshToken).toBe('rt1');
    expect(result.expiresIn).toBe(7200);
  });
});

describe('refreshAuth0Token', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('exchanges a refresh token for a fresh access token', async () => {
    const { refreshAuth0Token } = await import('../../src/auth/auth0-handler.js');
    mockFetch.mockResolvedValueOnce(okJson({
      access_token: 'at2',
      refresh_token: 'rt2',
      token_type: 'Bearer',
      expires_in: 3600,
    }));

    const result = await refreshAuth0Token({
      refreshToken: 'rt1',
      issuerBaseUrl: 'https://t.auth0.com',
      clientId: 'cid',
      clientSecret: 'sec',
    });

    expect(result.accessToken).toBe('at2');
    expect(result.refreshToken).toBe('rt2');
    expect(result.expiresIn).toBe(3600);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://t.auth0.com/oauth/token');
    const body = new URLSearchParams(options.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt1');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('sec');
  });

  it('leaves the refresh token undefined when Auth0 does not rotate it', async () => {
    const { refreshAuth0Token } = await import('../../src/auth/auth0-handler.js');
    mockFetch.mockResolvedValueOnce(okJson({
      access_token: 'at2',
      token_type: 'Bearer',
      expires_in: 3600,
    }));

    const result = await refreshAuth0Token({
      refreshToken: 'rt1',
      issuerBaseUrl: 'https://t.auth0.com',
      clientId: 'cid',
      clientSecret: 'sec',
    });

    expect(result.refreshToken).toBeUndefined();
  });

  it('throws when Auth0 rejects the refresh token', async () => {
    const { refreshAuth0Token } = await import('../../src/auth/auth0-handler.js');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'expired' }),
    });

    await expect(refreshAuth0Token({
      refreshToken: 'bad',
      issuerBaseUrl: 'https://t.auth0.com',
      clientId: 'cid',
      clientSecret: 'sec',
    })).rejects.toThrow('Auth0 token refresh failed');
  });
});

describe('makeTokenExchangeCallback', () => {
  const deps = { issuerBaseUrl: 'https://t.auth0.com', clientId: 'cid', clientSecret: 'sec' };

  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('mints a fresh upstream token on the refresh_token grant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const nowS = Math.floor(Date.now() / 1000);

    const { makeTokenExchangeCallback } = await import('../../src/auth/auth0-handler.js');
    mockFetch.mockResolvedValueOnce(okJson({
      access_token: 'fresh',
      refresh_token: 'rotated',
      token_type: 'Bearer',
      expires_in: 3600,
    }));

    const callback = makeTokenExchangeCallback(deps);
    const result = await callback({
      grantType: 'refresh_token',
      props: { userId: 'u', email: 'u@e.com', auth0AccessToken: 'stale', auth0RefreshToken: 'rt1' },
    });

    expect(result?.newProps?.auth0AccessToken).toBe('fresh');
    expect(result?.newProps?.auth0RefreshToken).toBe('rotated');
    expect(result?.newProps?.auth0ExpiresAt).toBe(nowS + 3600);
    expect(result?.accessTokenTTL).toBe(3600);
    // identity props survive the refresh
    expect(result?.newProps?.userId).toBe('u');
    expect(result?.newProps?.email).toBe('u@e.com');
  });

  it('keeps the existing refresh token when Auth0 returns none', async () => {
    const { makeTokenExchangeCallback } = await import('../../src/auth/auth0-handler.js');
    mockFetch.mockResolvedValueOnce(okJson({
      access_token: 'fresh',
      token_type: 'Bearer',
      expires_in: 3600,
    }));

    const callback = makeTokenExchangeCallback(deps);
    const result = await callback({
      grantType: 'refresh_token',
      props: { auth0AccessToken: 'stale', auth0RefreshToken: 'rt1' },
    });

    expect(result?.newProps?.auth0RefreshToken).toBe('rt1');
  });

  it('does not call Auth0 on the refresh_token grant when no refresh token was stored', async () => {
    const { makeTokenExchangeCallback } = await import('../../src/auth/auth0-handler.js');
    const callback = makeTokenExchangeCallback(deps);
    const result = await callback({
      grantType: 'refresh_token',
      props: { auth0AccessToken: 'stale' },
    });

    expect(result).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('caps the access-token TTL to the upstream lifetime on the authorization_code grant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const nowS = Math.floor(Date.now() / 1000);

    const { makeTokenExchangeCallback } = await import('../../src/auth/auth0-handler.js');
    const callback = makeTokenExchangeCallback(deps);
    const result = await callback({
      grantType: 'authorization_code',
      props: { auth0AccessToken: 'at', auth0ExpiresAt: nowS + 600 },
    });

    expect(result?.accessTokenTTL).toBe(600);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('leaves the TTL untouched when the upstream lifetime is unknown', async () => {
    const { makeTokenExchangeCallback } = await import('../../src/auth/auth0-handler.js');
    const callback = makeTokenExchangeCallback(deps);
    const result = await callback({
      grantType: 'authorization_code',
      props: { auth0AccessToken: 'at' },
    });

    expect(result).toBeUndefined();
  });
});
