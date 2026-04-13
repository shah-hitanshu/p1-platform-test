/**
 * CSS Auth Identity Provider
 *
 * Validates opaque access tokens issued by the CSS OAuth authorization server.
 *
 * Two validation strategies are supported:
 *
 * 1. **In-process** (preferred, used in merged worker): Calls authOAuthProvider.fetch()
 *    directly — no network hop. The call is a JavaScript function invocation that
 *    invokes the OAuthProvider's internal validate handler, which calls
 *    oauthHelpers.unwrapToken(). Activated when the `oauthProvider` option is supplied.
 *
 * 2. **HTTP** (kept for backward compat with standalone auth server tests):
 *    Calls POST /internal/token/validate via Cloudflare service binding or direct HTTP.
 *    Activated when `authServerUrl` + `internalSecret` options are supplied.
 *
 * canVerifyToken() routing rules:
 * - Returns false for any token containing a dot — CSS auth tokens use colons (no dots).
 *   This excludes JWTs (2 dots), and any other dot-containing format.
 * - Returns false for sat_ tokens — SiteApiTokenProvider handles these
 * - Returns false for aak_ tokens — AgentApiKeyProvider handles these
 * - Returns true for any other non-empty token (CSS auth server opaque tokens)
 *
 * Token validation caching:
 * - Results are cached in a module-level Map for CACHE_TTL_MS (10 seconds).
 * - All requests in the same Worker isolate share the cache — a burst of
 *   parallel page-load requests for the same token results in one validation
 *   call, not N calls.
 * - The cache TTL is capped to the token's own expiry to avoid serving a
 *   stale principal after the token has naturally expired.
 *
 * Fail closed: any validation failure returns null (token rejected).
 */

import type { AuthenticatedPrincipal } from '../types';
import type { IdentityProvider } from './identity-provider';
import { providerSubToUuid } from './uuid-v5.js';

// =============================================================================
// Options
// =============================================================================

/** In-process OAuth provider handle (forward declaration to avoid circular import). */
interface InProcessAuthProvider {
  fetch(request: Request, env: object, ctx: ExecutionContext): Promise<Response>;
}

export interface CSSAuthIdentityProviderOptions {
  /**
   * In-process auth provider for direct token validation (preferred).
   * Used when the CSS auth routes are inlined into the main worker.
   * When set, `oauthEnv` must also be provided.
   */
  oauthProvider?: InProcessAuthProvider;
  /**
   * The main worker's env object, passed to oauthProvider.fetch().
   * Must contain OAUTH_KV and other fields required by AuthOAuthEnv.
   */
  oauthEnv?: object;

  // HTTP path options (kept for backward compat with existing tests and standalone server).
  // When oauthProvider is set, these are ignored.
  /** Base URL of the CSS Auth Server (used for URL construction when no service binding). */
  authServerUrl?: string;
  /** Shared secret for the X-Internal-Secret header. */
  internalSecret?: string;
  /** Optional Cloudflare service binding (preferred — sub-ms latency). Falls back to fetch(). */
  fetcher?: Fetcher;
}

// =============================================================================
// Token validation response (shared between HTTP and in-process paths)
// =============================================================================

interface TokenValidateResponse {
  active: boolean;
  sub?: string;
  exp?: number;
  props?: {
    userId?: string;
    email?: string;
    name?: string;
    siteId?: string;
    /** Upstream IdP used by the CSS auth server ('google', 'auth0', etc.) */
    provider?: string;
  };
}

// =============================================================================
// Module-level token validation cache
//
// Persists across requests within the same Worker isolate. On a page load with
// 30+ parallel document requests carrying the same token, only the first call
// goes to the auth server — the rest read from this cache.
//
// TTL is set to the lesser of CACHE_TTL_MS and the token's own expiry, so we
// never serve a principal beyond the token's natural lifetime.
// =============================================================================

const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  principal: AuthenticatedPrincipal | null;
  expiresAt: number;
}

const tokenValidationCache = new Map<string, CacheEntry>();

function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of tokenValidationCache) {
    if (entry.expiresAt <= now) {
      tokenValidationCache.delete(key);
    }
  }
}

// =============================================================================
// Provider
// =============================================================================

export class CSSAuthIdentityProvider implements IdentityProvider {
  readonly name = 'css_auth' as const;

  private readonly oauthProvider?: InProcessAuthProvider;
  private readonly oauthEnv?: object;
  private readonly authServerUrl: string;
  private readonly internalSecret: string;
  private readonly fetcher?: Fetcher;

  /** Opaque token prefixes claimed by other providers — must not intercept these. */
  private static readonly EXCLUDED_PREFIXES = ['sat_', 'aak_'];

  constructor(options: CSSAuthIdentityProviderOptions) {
    this.oauthProvider = options.oauthProvider;
    this.oauthEnv = options.oauthEnv;
    this.authServerUrl = (options.authServerUrl ?? 'http://css-auth-server').replace(/\/$/, '');
    this.internalSecret = options.internalSecret ?? '';
    this.fetcher = options.fetcher;
  }

  /**
   * Returns true for opaque tokens that belong to the CSS auth server.
   */
  canVerifyToken(token: string): boolean {
    if (!token) {
      return false;
    }
    if (token.includes('.')) {
      return false;
    }
    for (const prefix of CSSAuthIdentityProvider.EXCLUDED_PREFIXES) {
      if (token.startsWith(prefix)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Validate a CSS auth opaque token. Returns null if the token is inactive or
   * if validation fails for any reason (fail closed).
   *
   * Uses the in-process path (authOAuthProvider.fetch()) when configured,
   * otherwise falls back to the HTTP path (service binding or direct fetch).
   */
  async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
    if (!token) {
      return null;
    }

    // Check cache first
    const now = Date.now();
    const cached = tokenValidationCache.get(token);
    if (cached !== undefined && cached.expiresAt > now) {
      return cached.principal;
    }

    try {
      let data: TokenValidateResponse;
      const { oauthProvider, oauthEnv } = this;
      if (oauthProvider !== undefined && oauthEnv !== undefined) {
        data = await this.validateViaInProcess(oauthProvider, oauthEnv, token);
      } else {
        data = await this.validateViaHttp(token);
      }

      const principal = await this.buildPrincipal(data);

      // Cache the validated principal. Cap TTL at the token's own expiry so
      // we never serve a principal beyond the token's natural lifetime.
      // Only cache positive results — inactive tokens are not cached so that
      // subsequent requests re-validate and pick up newly issued tokens.
      pruneCache();
      if (principal !== null && data.exp !== undefined) {
        const expiryMs = data.exp * 1000;
        const cacheTtl = Math.min(CACHE_TTL_MS, expiryMs - Date.now());
        if (cacheTtl > 0) {
          tokenValidationCache.set(token, { principal, expiresAt: Date.now() + cacheTtl });
        }
      }

      return principal;
    } catch {
      return null;
    }
  }

  /**
   * In-process validation via authOAuthProvider.fetch().
   * No network hop — direct JavaScript function call in the same isolate.
   * The sentinel URL http://internal/... is used so the handler can distinguish
   * in-process calls from external requests (which have a real hostname).
   */
  private async validateViaInProcess(
    oauthProvider: InProcessAuthProvider,
    oauthEnv: object,
    token: string,
  ): Promise<TokenValidateResponse> {
    // Pass a no-op ExecutionContext. Token validation only reads KV (no waitUntil needed),
    // so dropping background tasks scheduled by OAuthProvider is safe here.
    const noopCtx = {
      waitUntil: (_p: Promise<unknown>) => { /* no-op: token validation is read-only */ },
      passThroughOnException: () => { /* no-op */ },
    } as unknown as ExecutionContext;

    const response = await oauthProvider.fetch(
      new Request('http://internal/auth/internal/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
      oauthEnv,
      noopCtx,
    );

    if (!response.ok) {
      return { active: false };
    }

    const raw: unknown = await response.json();
    return raw as TokenValidateResponse;
  }

  /**
   * HTTP validation via POST /internal/token/validate.
   * Kept for backward compat with standalone auth server and existing tests.
   * Not used when oauthProvider is configured.
   */
  private async validateViaHttp(token: string): Promise<TokenValidateResponse> {
    const validateUrl = `${this.authServerUrl}/internal/token/validate`;

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': this.internalSecret,
      },
      body: JSON.stringify({ token }),
    };

    let response: Response;
    if (this.fetcher !== undefined) {
      try {
        response = await this.fetcher.fetch(validateUrl, fetchOptions);
      } catch {
        // Service binding threw (can happen in local dev when connection resets between polls).
        // Fall back to direct HTTP fetch using the configured auth server URL.
        response = await fetch(validateUrl, fetchOptions);
      }
    } else {
      response = await fetch(validateUrl, fetchOptions);
    }

    if (!response.ok) {
      return { active: false };
    }

    const raw: unknown = await response.json();
    return raw as TokenValidateResponse;
  }

  /**
   * Map a validated TokenValidateResponse to an AuthenticatedPrincipal.
   * Returns null if the response is inactive or missing a subject.
   */
  private async buildPrincipal(data: TokenValidateResponse): Promise<AuthenticatedPrincipal | null> {
    if (!data.active) {
      return null;
    }

    const sub = data.sub ?? data.props?.userId ?? '';
    if (!sub) {
      return null;
    }

    const rawProvider = data.props?.provider;
    if (rawProvider !== undefined && rawProvider !== 'google' && rawProvider !== 'auth0') {
      console.warn('[CSSAuthIdentityProvider] unexpected provider value in token props:', rawProvider);
    }
    const provider: 'google' | 'auth0' = rawProvider === 'auth0' ? 'auth0' : 'google';
    const principalId = await providerSubToUuid(provider, sub);

    const expiryMs = data.exp !== undefined ? data.exp * 1000 : Date.now() + 3600_000;

    return {
      id: principalId,
      type: 'user',
      email: data.props?.email,
      name: data.props?.name,
      authProvider: 'css_auth',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(expiryMs).toISOString(),
      providerSubjectId: sub,
    };
  }

  /**
   * CSS Auth Server issues tokens for users, not API keys for agents.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateAgentKey(_apiKey: string): Promise<AuthenticatedPrincipal | null> {
    return null;
  }
}
