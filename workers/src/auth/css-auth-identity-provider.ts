/**
 * CSS Auth Server Identity Provider
 *
 * Validates opaque access tokens issued by the CSS Auth Server (workers/auth-server/)
 * by calling POST /internal/token/validate on the auth server via a Cloudflare service
 * binding. That endpoint calls oauthHelpers.unwrapToken() internally.
 *
 * IMPORTANT: The auth server does NOT expose RFC 7662 /token/introspect.
 * The /internal/token/validate endpoint is specific to CSS and is protected by
 * X-Internal-Secret. It is not a standard OAuth endpoint.
 *
 * This provider is added to MultiProviderIdentityProvider when CSS_AUTH_SERVER
 * (service binding) is configured in the main CSS worker's env.
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
 *   parallel page-load requests for the same token results in one outbound
 *   /internal/token/validate call, not N calls.
 * - The cache TTL is capped to the token's own expiry to avoid serving a
 *   stale principal after the token has naturally expired.
 *
 * Fail closed: any validation failure returns null (token rejected).
 */

import type { AuthenticatedPrincipal } from '../types';
import type { IdentityProvider } from './identity-provider';
import { providerSubToUuid } from './uuid-v5.js';

export interface CSSAuthIdentityProviderOptions {
  /** Base URL of the CSS Auth Server (used for URL construction when no service binding) */
  authServerUrl: string;
  /** Shared secret for the X-Internal-Secret header */
  internalSecret: string;
  /** Optional Cloudflare service binding (preferred — sub-ms latency). Falls back to fetch() if not provided. */
  fetcher?: Fetcher;
}

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
// never serve a stale principal beyond the token's natural lifetime.
// =============================================================================

// 10-second cache TTL — balances performance (parallel page-load requests share one
// validation call) against revocation latency (a revoked token is honoured within 10s).
const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  principal: AuthenticatedPrincipal | null;
  expiresAt: number;
}

const tokenValidationCache = new Map<string, CacheEntry>();

/** Remove stale cache entries to prevent unbounded growth. */
function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of tokenValidationCache) {
    if (entry.expiresAt <= now) {
      tokenValidationCache.delete(key);
    }
  }
}

/**
 * Validates opaque tokens from the CSS Auth Server via /internal/token/validate.
 */
export class CSSAuthIdentityProvider implements IdentityProvider {
  readonly name = 'css_auth' as const;

  private readonly authServerUrl: string;
  private readonly internalSecret: string;
  private readonly fetcher?: Fetcher;

  /** Opaque token prefixes claimed by other providers — must not intercept these. */
  private static readonly EXCLUDED_PREFIXES = ['sat_', 'aak_'];

  constructor(options: CSSAuthIdentityProviderOptions) {
    this.authServerUrl = options.authServerUrl.replace(/\/$/, '');
    this.internalSecret = options.internalSecret;
    this.fetcher = options.fetcher;
  }

  /**
   * Returns true for opaque tokens that belong to the CSS auth server.
   *
   * Routing logic (order matters):
   * 1. Empty token — reject
   * 2. Any token containing a dot — reject. CSS auth opaque tokens use the
   *    format `userId:grantId:secret` (colons only, no dots). JWTs have 2 dots,
   *    other dot-containing formats are also not CSS auth tokens. Rejecting all
   *    dot-containing tokens is safe and correct.
   * 3. Known opaque prefixes (sat_, aak_) — reject (other providers handle these)
   * 4. Everything else — accept (CSS auth server opaque tokens)
   */
  canVerifyToken(token: string): boolean {
    if (!token) {
      return false;
    }
    // Any token containing a dot is not a CSS auth opaque token.
    // CSS auth server issues tokens in the format userId:grantId:secret (no dots).
    // This correctly excludes JWTs (2 dots), and any other dot-containing format.
    if (token.includes('.')) {
      return false;
    }
    // Tokens with known prefixes belong to other providers
    for (const prefix of CSSAuthIdentityProvider.EXCLUDED_PREFIXES) {
      if (token.startsWith(prefix)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Validate a token via /internal/token/validate. Returns null if the token is inactive or
   * if the call fails for any reason (fail closed, not open).
   *
   * Results are cached for up to CACHE_TTL_MS to reduce outbound calls when many
   * requests arrive simultaneously carrying the same token (e.g., parallel page load).
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
        return null;
      }

      const data: TokenValidateResponse = await response.json();

      if (!data.active) {
        return null;
      }

      const sub = data.sub ?? data.props?.userId ?? '';
      if (!sub) {
        return null;
      }

      // Convert the upstream IdP's subject ID to the same deterministic UUIDv5
      // that the direct-IdP providers (GoogleIdentityProvider, Auth0IdentityProvider)
      // produce, so principal.id is a valid UUID and database lookups work correctly.
      // The provider is stored in the token props by the auth server at issue time.
      // Falls back to 'google' for tokens issued before this field was added.
      const rawProvider = data.props?.provider;
      // Validate the provider field. Tokens issued before this field was added will have
      // rawProvider === undefined — default to 'google' for backward compatibility.
      // Tokens with an unrecognised provider value are suspicious; log a warning but
      // still proceed with the 'google' default so pre-migration tokens are not broken.
      if (rawProvider !== undefined && rawProvider !== 'google' && rawProvider !== 'auth0') {
        console.warn('[CSSAuthIdentityProvider] unexpected provider value in token props:', rawProvider);
      }
      const provider: 'google' | 'auth0' = rawProvider === 'auth0' ? 'auth0' : 'google';
      const principalId = await providerSubToUuid(provider, sub);

      const expiryMs = data.exp !== undefined ? data.exp * 1000 : Date.now() + 3600_000;

      const principal: AuthenticatedPrincipal = {
        id: principalId,
        type: 'user',
        email: data.props?.email,
        name: data.props?.name,
        authProvider: 'css_auth',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(expiryMs).toISOString(),
        providerSubjectId: sub,
      };

      // Cache the validated principal. Cap the TTL at the token's own expiry so
      // we never serve a principal beyond the token's natural lifetime.
      pruneCache();
      const cacheTtl = Math.min(CACHE_TTL_MS, expiryMs - Date.now());
      if (cacheTtl > 0) {
        tokenValidationCache.set(token, { principal, expiresAt: Date.now() + cacheTtl });
      }

      return principal;
    } catch {
      // Fail closed: if validation fails for any reason, reject the token
      return null;
    }
  }

  /**
   * CSS Auth Server issues tokens for users, not API keys for agents.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateAgentKey(_apiKey: string): Promise<AuthenticatedPrincipal | null> {
    return null;
  }
}
