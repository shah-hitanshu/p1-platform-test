/**
 * CSSAuthIdentityProvider Tests
 *
 * Tests token validation via POST /internal/token/validate against the CSS Auth Server.
 * The provider sends the opaque access token to the auth server's validate endpoint
 * and maps the response to an AuthenticatedPrincipal.
 *
 * NOTE: The auth server does NOT expose RFC 7662 /token/introspect.
 * It exposes /internal/token/validate which calls oauthHelpers.unwrapToken() internally.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CSSAuthIdentityProvider } from '../../src/auth/css-auth-identity-provider.js';

function makeProvider(mockFetcher?: Fetcher): CSSAuthIdentityProvider {
  return new CSSAuthIdentityProvider({
    authServerUrl: 'https://css-auth.example.com',
    internalSecret: 'test-secret',
    fetcher: mockFetcher,
  });
}

function makeMockFetcher(status: number, body: unknown): Fetcher {
  return {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  } as unknown as Fetcher;
}

describe('CSSAuthIdentityProvider', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe('canVerifyToken', () => {
    it('returns true for opaque tokens (no dots, no known prefix)', () => {
      const provider = makeProvider();
      // CSS auth server issues tokens like "userId:grantId:secret" — colons, no dots
      expect(provider.canVerifyToken('abc123:grantid456:secretxyz')).toBe(true);
    });

    it('returns false for empty string', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('')).toBe(false);
    });

    it('returns false for Google JWTs (has 2 dots — let GoogleIdentityProvider handle)', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig')).toBe(false);
    });

    it('returns false for Auth0 JWTs', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('eyJ0.eyJzdWIiOiIxMjMiLCJpc3MiOiJodHRwczovL2Rldi5hdXRoMC5jb20ifQ.sig')).toBe(false);
    });

    it('returns false for sat_ prefixed tokens (SiteApiTokenProvider domain)', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('sat_abc123def456')).toBe(false);
    });

    it('returns false for aak_ prefixed tokens (AgentApiKeyProvider domain)', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('aak_someagentkey')).toBe(false);
    });

    it('returns false for tokens with a single dot (not opaque CSS auth format)', () => {
      const provider = makeProvider();
      // A token with any dots is not a CSS auth opaque token — reject it.
      // CSS auth opaque tokens use colons (userId:grantId:secret), not dots.
      expect(provider.canVerifyToken('some.token')).toBe(false);
    });

    it('returns false for tokens with three or more dots', () => {
      const provider = makeProvider();
      // Three-dot tokens are also not opaque CSS auth tokens
      expect(provider.canVerifyToken('a.b.c.d')).toBe(false);
    });
  });

  describe('validateToken', () => {
    it('returns AuthenticatedPrincipal for active token', async () => {
      const fetcher = makeMockFetcher(200, {
        active: true,
        sub: 'google-sub-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        props: {
          userId: 'google-sub-123',
          email: 'user@example.com',
          name: 'Test User',
          siteId: 'site-abc',
        },
      });
      const provider = makeProvider(fetcher);
      const principal = await provider.validateToken('abc123:grantid:secret');
      expect(principal).not.toBeNull();
      expect(principal?.email).toBe('user@example.com');
      expect(principal?.authProvider).toBe('css_auth');
      expect(principal?.type).toBe('user');
    });

    it('returns null for inactive token', async () => {
      const fetcher = makeMockFetcher(200, { active: false });
      const provider = makeProvider(fetcher);
      const result = await provider.validateToken('expired-token');
      expect(result).toBeNull();
    });

    it('returns null when validate endpoint returns 401', async () => {
      const fetcher = makeMockFetcher(401, { error: 'unauthorized' });
      const provider = makeProvider(fetcher);
      const result = await provider.validateToken('bad-token');
      expect(result).toBeNull();
    });

    it('returns null when validate endpoint returns 500', async () => {
      const fetcher = makeMockFetcher(500, { error: 'server error' });
      const provider = makeProvider(fetcher);
      const result = await provider.validateToken('any-token');
      expect(result).toBeNull();
    });

    it('sends token as JSON body in POST request to /internal/token/validate', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ active: false }), { status: 200 }),
      );
      const fetcher = { fetch: mockFetch } as unknown as Fetcher;
      const provider = makeProvider(fetcher);
      await provider.validateToken('mytoken');
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.method).toBe('POST');
      expect(url).toContain('/internal/token/validate');
      const bodyStr = options.body as string;
      expect(JSON.parse(bodyStr)).toMatchObject({ token: 'mytoken' });
    });

    it('sends X-Internal-Secret header', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ active: false }), { status: 200 }),
      );
      const fetcher = { fetch: mockFetch } as unknown as Fetcher;
      const provider = makeProvider(fetcher);
      await provider.validateToken('mytoken');
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['X-Internal-Secret']).toBe('test-secret');
    });

    it('returns null for empty token (fail-closed, no fetch call)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ active: false }), { status: 200 }),
      );
      const fetcher = { fetch: mockFetch } as unknown as Fetcher;
      const provider = makeProvider(fetcher);
      const result = await provider.validateToken('');
      expect(result).toBeNull();
      // T70: no fetch call should occur for an empty token
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when internalSecret is empty (auth server rejects with 403)', async () => {
      // T70 #2: An empty INTERNAL_SECRET causes auth server to reject with 403 (or similar).
      // The provider must still return null (fail-closed), not throw.
      const fetcher = makeMockFetcher(403, { error: 'Forbidden' });
      const provider = new CSSAuthIdentityProvider({
        authServerUrl: 'https://css-auth.example.com',
        internalSecret: '',
        fetcher,
      });
      const result = await provider.validateToken('sometoken:grantid:secret');
      expect(result).toBeNull();
    });
  });

  describe('performance invariant', () => {
    // T38: validateToken with a resolved mock must complete in under 100ms
    it('completes in under 100ms with a synchronously-resolved mock fetcher', async () => {
      const fetcher = makeMockFetcher(200, { active: false });
      const provider = makeProvider(fetcher);
      const start = performance.now();
      await provider.validateToken('some-token');
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('validateAgentKey', () => {
    it('always returns null (CSS auth server does not issue agent keys)', async () => {
      const provider = makeProvider();
      const result = await provider.validateAgentKey('aak_somekey');
      expect(result).toBeNull();
    });
  });
});
