/**
 * Phase 2: Google Identity Provider
 *
 * Verifies Google OAuth2 ID tokens using JWKS.
 * Implements the IdentityProvider interface for Google-issued JWTs.
 *
 * @see collaborative-state-system-architecture-v2.3.md
 */

import * as jose from 'jose';

import type { AuthenticatedPrincipal } from '../types';
import type { IdentityProvider } from './identity-provider';
import { providerSubToUuid } from './uuid-v5';

/**
 * Google's two valid issuer values.
 * Google tokens may use either format.
 */
const GOOGLE_ISSUERS: string[] = [
  'https://accounts.google.com',
  'accounts.google.com',
];

/**
 * Google's public JWKS endpoint for token verification.
 */
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Configuration for GoogleIdentityProvider.
 */
export interface GoogleIdentityProviderOptions {
  /** Google OAuth client ID (used as audience for token verification) */
  clientId: string;
  /** Optional JWKS resolver — defaults to Google's remote JWKS endpoint */
  jwks?: jose.JWTVerifyGetKey;
}

/**
 * Verifies Google OAuth2 ID tokens and returns AuthenticatedPrincipal.
 *
 * @example
 * ```typescript
 * const provider = new GoogleIdentityProvider({
 *   clientId: 'your-client-id.apps.googleusercontent.com',
 * });
 *
 * const principal = await provider.validateToken(googleIdToken);
 * ```
 */
export class GoogleIdentityProvider implements IdentityProvider {
  readonly name = 'google' as const;

  private readonly clientId: string;
  private readonly jwks: jose.JWTVerifyGetKey;

  constructor(options: GoogleIdentityProviderOptions) {
    this.clientId = options.clientId;
    this.jwks = options.jwks ??
      jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  }

  /**
   * Check if this provider can verify the given token by inspecting the iss claim.
   * Decodes the JWT without verification to read the issuer.
   */
  canVerifyToken(token: string): boolean {
    if (token === '' || !token.includes('.')) {
      return false;
    }
    try {
      const payload = jose.decodeJwt(token);
      return GOOGLE_ISSUERS.includes(payload.iss ?? '');
    } catch {
      return false;
    }
  }

  /**
   * Validate a Google ID token and return an AuthenticatedPrincipal.
   * Performs full signature verification using JWKS.
   */
  async validateToken(
    token: string,
  ): Promise<AuthenticatedPrincipal | null> {
    if (token === '') {
      return null;
    }

    try {
      const { payload } = await jose.jwtVerify(token, this.jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: this.clientId,
        algorithms: ['RS256'],
      });

      const sub = payload.sub;
      const exp = payload.exp;

      if (sub == null || exp == null) {
        return null;
      }

      const email = typeof payload.email === 'string'
        ? payload.email
        : undefined;
      const name = typeof payload.name === 'string'
        ? payload.name
        : undefined;
      const picture = typeof payload.picture === 'string'
        ? payload.picture
        : undefined;
      const tokenExpiry = new Date(exp * 1000).toISOString();
      const id = await providerSubToUuid('google', sub);

      return {
        id,
        type: 'user',
        email,
        name,
        avatarUrl: picture,
        authProvider: 'google',
        pantheonSiteRoles: {},
        tokenExpiry,
        providerSubjectId: sub,
      };
    } catch {
      return null;
    }
  }

  /**
   * Google does not use API keys. Always returns null.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateAgentKey(): Promise<AuthenticatedPrincipal | null> {
    return null;
  }
}
