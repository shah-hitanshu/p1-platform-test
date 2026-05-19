/**
 * Auth0 OAuth Handler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Auth0OAuthHandler', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('getAuth0AuthorizationUrl', () => {
    it('constructs an Auth0 authorization URL with correct params', async () => {
      const { getAuth0AuthorizationUrl } = await import('../../../src/auth/oauth/auth0-handler.js');
      const url = getAuth0AuthorizationUrl({
        issuerBaseUrl: 'https://example.auth0.com',
        clientId: 'test-client-id',
        redirectUri: 'http://localhost:8788/broker/callback',
        state: 'state-abc',
        scope: 'openid email profile',
      });
      expect(url).toContain('example.auth0.com/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('state=state-abc');
      expect(url).toContain('scope=openid+email+profile');
    });

    it('uses response_type=code', async () => {
      const { getAuth0AuthorizationUrl } = await import('../../../src/auth/oauth/auth0-handler.js');
      const url = getAuth0AuthorizationUrl({
        issuerBaseUrl: 'https://example.auth0.com',
        clientId: 'test-id',
        redirectUri: 'http://localhost/callback',
        state: 'state-1',
        scope: 'openid email profile',
      });
      expect(url).toContain('response_type=code');
    });

    it('strips trailing slash from issuerBaseUrl', async () => {
      const { getAuth0AuthorizationUrl } = await import('../../../src/auth/oauth/auth0-handler.js');
      const url = getAuth0AuthorizationUrl({
        issuerBaseUrl: 'https://example.auth0.com/',
        clientId: 'test-id',
        redirectUri: 'http://localhost/callback',
        state: 'state-1',
        scope: 'openid',
      });
      expect(url).toContain('https://example.auth0.com/authorize');
      expect(url).not.toContain('auth0.com//authorize');
    });

    it('includes audience param when provided', async () => {
      const { getAuth0AuthorizationUrl } = await import('../../../src/auth/oauth/auth0-handler.js');
      const url = getAuth0AuthorizationUrl({
        issuerBaseUrl: 'https://example.auth0.com',
        clientId: 'test-id',
        redirectUri: 'http://localhost/callback',
        state: 'state-1',
        scope: 'openid',
        audience: 'https://api.example.com',
      });
      expect(url).toContain('audience=');
    });

    it('omits audience param when not provided', async () => {
      const { getAuth0AuthorizationUrl } = await import('../../../src/auth/oauth/auth0-handler.js');
      const url = getAuth0AuthorizationUrl({
        issuerBaseUrl: 'https://example.auth0.com',
        clientId: 'test-id',
        redirectUri: 'http://localhost/callback',
        state: 'state-1',
        scope: 'openid',
      });
      expect(url).not.toContain('audience=');
    });
  });

  describe('exchangeAuth0Code', () => {
    it('exchanges an auth code for Auth0 tokens and user info', async () => {
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'auth0-access-token',
          id_token: 'eyJhbGciOiJSUzI1NiJ9.' +
            btoa(JSON.stringify({ sub: 'auth0|12345', email: 'user@example.com', name: 'Test User' })) +
            '.fakesig',
          token_type: 'Bearer',
          expires_in: 86400,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await exchangeAuth0Code({
        code: 'auth-code-123',
        issuerBaseUrl: 'https://example.auth0.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:8788/broker/callback',
      });
      expect(result.accessToken).toBe('auth0-access-token');
      expect(result.user.sub).toBe('auth0|12345');
      expect(result.user.email).toBe('user@example.com');
      expect(result.user.name).toBe('Test User');
    });

    it('sends correct parameters to Auth0 token endpoint', async () => {
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'token',
          id_token: 'eyJhbGciOiJSUzI1NiJ9.' +
            btoa(JSON.stringify({ sub: 'auth0|1', email: 'a@b.com' })) +
            '.sig',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await exchangeAuth0Code({
        code: 'code-1',
        issuerBaseUrl: 'https://example.auth0.com',
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://localhost/callback',
      });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://example.auth0.com/oauth/token');
      expect(options.method).toBe('POST');
      const body = options.body as string;
      expect(body).toContain('grant_type=authorization_code');
      expect(body).toContain('code=code-1');
      expect(body).toContain('client_id=cid');
      expect(body).toContain('client_secret=csec');
    });

    it('strips trailing slash from issuerBaseUrl in token endpoint', async () => {
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'token',
          id_token: 'eyJhbGciOiJSUzI1NiJ9.' +
            btoa(JSON.stringify({ sub: 'auth0|1', email: 'a@b.com' })) +
            '.sig',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await exchangeAuth0Code({
        code: 'code-1',
        issuerBaseUrl: 'https://example.auth0.com/',
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://localhost/callback',
      });

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://example.auth0.com/oauth/token');
    });

    it('throws on non-200 Auth0 response', async () => {
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'code expired' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(exchangeAuth0Code({
        code: 'bad-code',
        issuerBaseUrl: 'https://example.auth0.com',
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://localhost/callback',
      })).rejects.toThrow('Auth0 token exchange failed');
    });

    it('includes error details in thrown error message', async () => {
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'code is expired' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(exchangeAuth0Code({
        code: 'bad-code',
        issuerBaseUrl: 'https://example.auth0.com',
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://localhost/callback',
      })).rejects.toThrow('invalid_grant');
    });

    it('handles non-JSON error response body', async () => {
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not JSON')),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(exchangeAuth0Code({
        code: 'bad-code',
        issuerBaseUrl: 'https://example.auth0.com',
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://localhost/callback',
      })).rejects.toThrow('Auth0 token exchange failed');
    });
  });

  describe('decodeAuth0IdTokenClaims', () => {
    it('decodes user info from Auth0 ID token payload', async () => {
      const { decodeAuth0IdTokenClaims } = await import('../../../src/auth/oauth/auth0-handler.js');
      const payload = btoa(JSON.stringify({
        sub: 'auth0|1234567890',
        email: 'user@example.com',
        name: 'Test User',
        email_verified: true,
      }));
      const mockIdToken = `eyJhbGciOiJSUzI1NiJ9.${payload}.fakesig`;
      const claims = decodeAuth0IdTokenClaims(mockIdToken);
      expect(claims.sub).toBe('auth0|1234567890');
      expect(claims.email).toBe('user@example.com');
      expect(claims.name).toBe('Test User');
    });

    it('handles base64url encoding', async () => {
      const { decodeAuth0IdTokenClaims } = await import('../../../src/auth/oauth/auth0-handler.js');
      const jsonStr = JSON.stringify({ sub: 'auth0|abc>?def', email: 'test@test.com' });
      const payload = btoa(jsonStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const token = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
      const claims = decodeAuth0IdTokenClaims(token);
      expect(claims.sub).toBe('auth0|abc>?def');
      expect(claims.email).toBe('test@test.com');
    });

    it('throws on malformed token', async () => {
      const { decodeAuth0IdTokenClaims } = await import('../../../src/auth/oauth/auth0-handler.js');
      expect(() => decodeAuth0IdTokenClaims('not-a-jwt')).toThrow();
    });

    it('handles token with optional fields missing', async () => {
      const { decodeAuth0IdTokenClaims } = await import('../../../src/auth/oauth/auth0-handler.js');
      const payload = btoa(JSON.stringify({
        sub: 'auth0|minimal',
        email: 'minimal@test.com',
      }));
      const token = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
      const claims = decodeAuth0IdTokenClaims(token);
      expect(claims.sub).toBe('auth0|minimal');
      expect(claims.name).toBeUndefined();
    });
  });
});
