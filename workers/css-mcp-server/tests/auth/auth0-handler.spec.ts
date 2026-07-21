/**
 * Auth0 Handler Tests (MCP server copy)
 *
 * Tests for Auth0 authorization URL construction and code exchange.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('getAuth0AuthorizationUrl', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('builds a valid Auth0 authorization URL with required params', async () => {
    const { getAuth0AuthorizationUrl } = await import('../../src/auth/auth0-handler.js');
    const url = getAuth0AuthorizationUrl({
      issuerBaseUrl: 'https://example.auth0.com',
      clientId: 'client-id-123',
      redirectUri: 'https://mcp.example.com/callback',
      state: 'state-abc',
      scope: 'openid email profile',
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('example.auth0.com');
    expect(parsed.pathname).toBe('/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-id-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://mcp.example.com/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
  });

  it('includes audience when provided', async () => {
    const { getAuth0AuthorizationUrl } = await import('../../src/auth/auth0-handler.js');
    const url = getAuth0AuthorizationUrl({
      issuerBaseUrl: 'https://example.auth0.com',
      clientId: 'cid',
      redirectUri: 'https://mcp.example.com/callback',
      state: 'st',
      scope: 'openid email',
      audience: 'https://api.example.com',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('audience')).toBe('https://api.example.com');
  });

  it('strips trailing slashes from issuer', async () => {
    const { getAuth0AuthorizationUrl } = await import('../../src/auth/auth0-handler.js');
    const url = getAuth0AuthorizationUrl({
      issuerBaseUrl: 'https://example.auth0.com///',
      clientId: 'cid',
      redirectUri: 'https://mcp.example.com/callback',
      state: 'st',
      scope: 'openid email',
    });
    expect(url).not.toContain('//authorize');
  });
});

describe('exchangeAuth0Code', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns accessToken and user on success', async () => {
    const { exchangeAuth0Code } = await import('../../src/auth/auth0-handler.js');

    // Build a minimal JWT with sub and email in the payload
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ sub: 'auth0|user123', email: 'user@example.com', name: 'Test User' }));
    const idToken = `${header}.${payload}.fakesig`;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'at_abc',
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    });

    const result = await exchangeAuth0Code({
      code: 'auth-code-xyz',
      issuerBaseUrl: 'https://example.auth0.com',
      clientId: 'cid',
      clientSecret: 'csecret',
      redirectUri: 'https://mcp.example.com/callback',
    });

    expect(result.accessToken).toBe('at_abc');
    expect(result.user.sub).toBe('auth0|user123');
    expect(result.user.email).toBe('user@example.com');
  });

  it('throws on non-ok response', async () => {
    const { exchangeAuth0Code } = await import('../../src/auth/auth0-handler.js');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'invalid_client', error_description: 'Bad credentials' }),
    });

    await expect(exchangeAuth0Code({
      code: 'bad-code',
      issuerBaseUrl: 'https://example.auth0.com',
      clientId: 'cid',
      clientSecret: 'wrong',
      redirectUri: 'https://mcp.example.com/callback',
    })).rejects.toThrow('Auth0 token exchange failed');
  });
});
