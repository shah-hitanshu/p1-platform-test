/**
 * Phase 3: Auth0 Identity Provider
 *
 * Verifies Auth0-issued JWTs using RS256 + JWKS.
 *
 * @see collaborative-state-system-architecture-v2.3.md
 */

import * as jose from 'jose';

import type { AuthenticatedPrincipal, AuthProvider } from '../types';
import type { IdentityProvider } from './identity-provider';
import { providerSubToUuid } from './uuid-v5';

/**
 * Configuration options for the Auth0IdentityProvider.
 */
export interface Auth0IdentityProviderOptions {
  /** Auth0 issuer base URL (e.g. https://example.auth0.com) */
  issuerBaseUrl: string;
  /** Expected audience for token validation */
  audience: string;
  /** Optional injected JWKS for testing (defaults to remote JWKS) */
  jwks?: jose.JWTVerifyGetKey;
}

/**
 * Check if a URL string is an Auth0 issuer by parsing the hostname.
 * Returns true only if the hostname ends with '.auth0.com' or equals 'auth0.com'.
 */
function isAuth0Issuer(issuer: string): boolean {
  try {
    const url = new URL(issuer);
    return url.hostname === 'auth0.com' || url.hostname.endsWith('.auth0.com');
  } catch {
    return false;
  }
}

/**
 * Auth0 identity provider implementing the IdentityProvider interface.
 * Verifies RS256-signed JWTs against Auth0's JWKS endpoint.
 */
export class Auth0IdentityProvider implements IdentityProvider {
  readonly name: AuthProvider = 'auth0';

  private readonly issuerBaseUrl: string;
  private readonly audience: string;
  private readonly jwks: jose.JWTVerifyGetKey;

  constructor(options: Auth0IdentityProviderOptions) {
    this.issuerBaseUrl = options.issuerBaseUrl;
    this.audience = options.audience;

    this.jwks = options.jwks ??
      jose.createRemoteJWKSet(
        new URL(new URL('.well-known/jwks.json', this.issuerBaseUrl).href),
      );
  }

  /**
   * Check if this provider can verify the given token by inspecting
   * the JWT's `iss` claim without full verification.
   */
  canVerifyToken(token: string): boolean {
    if (token === '' || !token.includes('.')) {
      return false;
    }

    try {
      const payload = jose.decodeJwt(token);
      const iss = typeof payload.iss === 'string'
        ? payload.iss
        : undefined;

      if (iss === undefined) {
        return false;
      }

      if (iss === this.issuerBaseUrl) {
        return true;
      }

      if (isAuth0Issuer(iss)) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Validate a Bearer token and return an AuthenticatedPrincipal,
   * or null if the token is invalid.
   */
  async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
    try {
      const decoded = jose.decodeJwt(token);
      const iss = typeof decoded.iss === 'string' ? decoded.iss : undefined;

      // Select the correct JWKS based on issuer
      const selectedJwks = this.selectJwks(iss);
      if (!selectedJwks) {
        return null;
      }

      const { payload } = await jose.jwtVerify(token, selectedJwks, {
        issuer: iss,
        audience: this.audience,
        algorithms: ['RS256'],
      });

      const sub = payload.sub;
      if (sub === undefined || sub === '') {
        return null;
      }

      const email = typeof payload.email === 'string'
        ? payload.email
        : undefined;
      const scopeStr = typeof payload.scope === 'string'
        ? payload.scope
        : undefined;
      const scopes = scopeStr !== undefined && scopeStr !== ''
        ? scopeStr.split(' ')
        : [];
      const exp = payload.exp;
      const tokenExpiry = exp !== undefined && exp !== 0
        ? new Date(exp * 1000).toISOString()
        : new Date().toISOString();

      const id = await providerSubToUuid('auth0', sub);

      return {
        id,
        type: 'user',
        email,
        authProvider: 'auth0',
        pantheonSiteRoles: {},
        tokenExpiry,
        scopes,
        providerSubjectId: sub,
      };
    } catch {
      return null;
    }
  }

  /**
   * Auth0 does not support agent API keys.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateAgentKey(_apiKey: string): Promise<AuthenticatedPrincipal | null> {
    return null;
  }

  /**
   * Select the correct JWKS keyset based on the token's issuer.
   * Returns the JWKS for the configured issuer, or as fallback
   * for any other auth0.com issuer.
   */
  private selectJwks(iss: string | undefined): jose.JWTVerifyGetKey | undefined {
    if (iss === undefined || iss === '') {
      return undefined;
    }

    if (iss === this.issuerBaseUrl || isAuth0Issuer(iss)) {
      return this.jwks;
    }

    return undefined;
  }
}
