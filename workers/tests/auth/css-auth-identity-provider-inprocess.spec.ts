/**
 * CSSAuthIdentityProvider — In-Process Validation Tests
 *
 * Tests the in-process validation path (oauthProvider option) where
 * CSSAuthIdentityProvider calls authOAuthProvider.fetch() directly instead
 * of making an HTTP round-trip to a standalone auth server.
 *
 * The mock oauthProvider simulates the response from the internal validate
 * handler at POST http://internal/auth/internal/validate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CSSAuthIdentityProvider } from '../../src/auth/css-auth-identity-provider.js';

function makeInProcessProvider(status: number, body: unknown): CSSAuthIdentityProvider {
  const mockOAuthProvider = {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  };
  return new CSSAuthIdentityProvider({
    oauthProvider: mockOAuthProvider,
    oauthEnv: {},
  });
}

function makeMockOAuthProvider(status: number, body: unknown): { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  };
}

describe('CSSAuthIdentityProvider (in-process path)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('canVerifyToken (unchanged from HTTP path)', () => {
    it('returns true for opaque tokens (no dots, no known prefix)', () => {
      const provider = makeInProcessProvider(200, { active: false });
      expect(provider.canVerifyToken('abc123:grantid456:secretxyz')).toBe(true);
    });

    it('returns false for JWTs (contains dots)', () => {
      const provider = makeInProcessProvider(200, { active: false });
      expect(provider.canVerifyToken('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig')).toBe(false);
    });

    it('returns false for sat_ tokens', () => {
      const provider = makeInProcessProvider(200, { active: false });
      expect(provider.canVerifyToken('sat_abc123')).toBe(false);
    });

    it('returns false for aak_ tokens', () => {
      const provider = makeInProcessProvider(200, { active: false });
      expect(provider.canVerifyToken('aak_someagentkey')).toBe(false);
    });
  });

  describe('validateToken', () => {
    it('returns AuthenticatedPrincipal for active token', async () => {
      const provider = makeInProcessProvider(200, {
        active: true,
        sub: 'google-sub-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        props: {
          userId: 'google-sub-123',
          email: 'user@example.com',
          name: 'Test User',
          siteId: 'site-abc',
          provider: 'google',
        },
      });

      const principal = await provider.validateToken('abc123:grantid:secret');
      expect(principal).not.toBeNull();
      expect(principal?.email).toBe('user@example.com');
      expect(principal?.name).toBe('Test User');
      expect(principal?.authProvider).toBe('css_auth');
      expect(principal?.type).toBe('user');
    });

    it('returns null for inactive token', async () => {
      const provider = makeInProcessProvider(200, { active: false });
      const result = await provider.validateToken('expired-token');
      expect(result).toBeNull();
    });

    it('returns null when oauthProvider returns non-ok status', async () => {
      const provider = makeInProcessProvider(500, { error: 'server error' });
      const result = await provider.validateToken('any-token');
      expect(result).toBeNull();
    });

    it('returns null for empty token (no oauthProvider call)', async () => {
      const mockOAuth = makeMockOAuthProvider(200, { active: false });
      const provider = new CSSAuthIdentityProvider({
        oauthProvider: mockOAuth,
        oauthEnv: {},
      });
      const result = await provider.validateToken('');
      expect(result).toBeNull();
      expect(mockOAuth.fetch).not.toHaveBeenCalled();
    });

    it('calls oauthProvider.fetch with the sentinel internal URL', async () => {
      const mockOAuth = makeMockOAuthProvider(200, { active: false });
      const provider = new CSSAuthIdentityProvider({
        oauthProvider: mockOAuth,
        oauthEnv: { OAUTH_KV: {} },
      });

      await provider.validateToken('mytoken:abc:xyz');
      expect(mockOAuth.fetch).toHaveBeenCalledOnce();
      const [req] = mockOAuth.fetch.mock.calls[0] as [Request, object];
      expect(req.url).toBe('http://internal/auth/internal/validate');
      expect(req.method).toBe('POST');
      const body = JSON.parse(await req.text()) as { token: string };
      expect(body.token).toBe('mytoken:abc:xyz');
    });

    it('passes oauthEnv to oauthProvider.fetch', async () => {
      const envObj = { OAUTH_KV: { sentinel: true } };
      const mockOAuth = makeMockOAuthProvider(200, { active: false });
      const provider = new CSSAuthIdentityProvider({
        oauthProvider: mockOAuth,
        oauthEnv: envObj,
      });

      await provider.validateToken('mytoken:abc:xyz');
      const [, passedEnv] = mockOAuth.fetch.mock.calls[0] as [Request, object];
      expect(passedEnv).toBe(envObj);
    });

    it('returns null when oauthProvider.fetch throws', async () => {
      const mockOAuth = {
        fetch: vi.fn().mockRejectedValue(new Error('fetch failed')),
      };
      const provider = new CSSAuthIdentityProvider({
        oauthProvider: mockOAuth,
        oauthEnv: {},
      });
      const result = await provider.validateToken('sometoken:abc:xyz');
      expect(result).toBeNull();
    });

    it('uses in-process path when oauthProvider is set (not HTTP fetcher)', async () => {
      const mockOAuth = makeMockOAuthProvider(200, { active: false });
      const mockFetcher: { fetch: ReturnType<typeof vi.fn> } = { fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) };

      // Provide BOTH options — in-process should take precedence
      const provider = new CSSAuthIdentityProvider({
        oauthProvider: mockOAuth,
        oauthEnv: {},
        authServerUrl: 'https://should-not-be-called.example.com',
        internalSecret: 'test-secret',
        fetcher: mockFetcher as unknown as Fetcher,
      });

      await provider.validateToken('sometoken:abc:xyz');
      expect(mockOAuth.fetch).toHaveBeenCalledOnce();
      expect(mockFetcher.fetch).not.toHaveBeenCalled();
    });
  });

  describe('validateAgentKey', () => {
    it('always returns null', async () => {
      const provider = makeInProcessProvider(200, { active: true });
      const result = await provider.validateAgentKey('aak_somekey');
      expect(result).toBeNull();
    });
  });
});
