/**
 * Site API Token Provider
 *
 * Authenticates application-level API tokens (sat_ prefixed) by
 * validating them against hashed tokens stored in the database.
 * Returns a service principal scoped to a specific site.
 *
 * Implements the IdentityProvider interface.
 */

import type { AuthenticatedPrincipal } from '../types';
import type { IdentityProvider } from './identity-provider';
import { validateToken } from '../services/site-api-token-service';

const TOKEN_PREFIX = 'sat_';

/**
 * Provider for site API tokens (sat_ prefixed opaque tokens).
 * These tokens authenticate applications, not users.
 */
export class SiteApiTokenProvider implements IdentityProvider {
  readonly name = 'site_token' as const;

  /**
   * Check if this provider can verify the given token.
   * Returns true for tokens starting with "sat_" followed by at least one character.
   */
  canVerifyToken(token: string): boolean {
    return token.startsWith(TOKEN_PREFIX) && token.length > TOKEN_PREFIX.length;
  }

  /**
   * Validate a site API token and return a service principal.
   */
  async validateToken(
    token: string,
  ): Promise<AuthenticatedPrincipal | null> {
    if (!token || !this.canVerifyToken(token)) {
      return null;
    }

    const result = await validateToken(token);
    if (!result) {
      return null;
    }

    return {
      id: result.tokenId,
      type: 'service',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      scopes: result.scopes,
      siteId: result.siteId,
      authProvider: 'site_token',
    };
  }

  /**
   * Site tokens do not use API keys. Always returns null.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateAgentKey(): Promise<AuthenticatedPrincipal | null> {
    return null;
  }
}
