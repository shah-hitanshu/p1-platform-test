/**
 * Google OAuth Handler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('GoogleOAuthHandler', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Test 34: Authorization URL contains required params
  describe('getGoogleAuthorizationUrl', () => {
    it('should construct a Google OAuth authorization URL with correct params', async () => {
      const { getGoogleAuthorizationUrl } = await import('../../src/auth/google-handler.js');
      const url = getGoogleAuthorizationUrl({
        clientId: 'test-client-id',
        redirectUri: 'http://localhost:8788/callback',
        state: 'state-123',
        scope: 'openid email profile',
      });
      expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('state=state-123');
    });

    // Test 35: response_type=code
    it('should use response_type=code', async () => {
      const { getGoogleAuthorizationUrl } = await import('../../src/auth/google-handler.js');
      const url = getGoogleAuthorizationUrl({
        clientId: 'test-id',
        redirectUri: 'http://localhost:8788/callback',
        state: 'state-1',
        scope: 'openid email profile',
      });
      expect(url).toContain('response_type=code');
    });
  });

  // Test 36: exchangeGoogleCode returns tokens and user info
  describe('exchangeGoogleCode', () => {
    it('should exchange an auth code for Google tokens and user info', async () => {
      const { exchangeGoogleCode } = await import('../../src/auth/google-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'google-access-token',
          id_token: 'eyJhbGciOiJSUzI1NiJ9.' +
            btoa(JSON.stringify({ sub: '12345', email: 'user@example.com', name: 'Test User' })) +
            '.fakesig',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await exchangeGoogleCode({
        code: 'auth-code-123',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:8788/callback',
      });
      expect(result.accessToken).toBe('google-access-token');
      expect(result.user.sub).toBe('12345');
      expect(result.user.email).toBe('user@example.com');
    });

    // Test 37: Correct parameters sent to Google
    it('should send correct parameters to Google token endpoint', async () => {
      const { exchangeGoogleCode } = await import('../../src/auth/google-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'token',
          id_token: 'eyJhbGciOiJSUzI1NiJ9.' +
            btoa(JSON.stringify({ sub: '1', email: 'a@b.com' })) +
            '.sig',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await exchangeGoogleCode({
        code: 'code-1',
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://localhost/callback',
      });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(options.method).toBe('POST');
      const body = options.body;
      expect(body).toContain('grant_type=authorization_code');
      expect(body).toContain('code=code-1');
    });

    // Test 38: Throws on non-200 response
    it('should throw on non-200 Google response', async () => {
      const { exchangeGoogleCode } = await import('../../src/auth/google-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'invalid_grant' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(exchangeGoogleCode({
        code: 'bad-code',
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'http://localhost/callback',
      })).rejects.toThrow();
    });
  });

  // Test 39: decodeIdTokenClaims
  describe('decodeIdTokenClaims', () => {
    it('should decode user info from ID token payload', async () => {
      const { decodeIdTokenClaims } = await import('../../src/auth/google-handler.js');
      const payload = btoa(JSON.stringify({
        sub: '1234567890',
        email: 'user@example.com',
        name: 'Test User',
        email_verified: true,
      }));
      const mockIdToken = `eyJhbGciOiJSUzI1NiJ9.${payload}.fakesig`;
      const claims = decodeIdTokenClaims(mockIdToken);
      expect(claims.sub).toBe('1234567890');
      expect(claims.email).toBe('user@example.com');
      expect(claims.name).toBe('Test User');
    });

    // Test 40: Handles base64url encoding
    it('should handle base64url encoding', async () => {
      const { decodeIdTokenClaims } = await import('../../src/auth/google-handler.js');
      // Create payload with characters that differ between base64 and base64url
      const jsonStr = JSON.stringify({ sub: 'abc>?def', email: 'test@test.com' });
      // Standard base64url encode
      const payload = btoa(jsonStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const token = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
      const claims = decodeIdTokenClaims(token);
      expect(claims.sub).toBe('abc>?def');
      expect(claims.email).toBe('test@test.com');
    });

    // Test 41: Throws on malformed token
    it('should throw on malformed token', async () => {
      const { decodeIdTokenClaims } = await import('../../src/auth/google-handler.js');
      expect(() => decodeIdTokenClaims('not-a-jwt')).toThrow();
    });
  });
});
