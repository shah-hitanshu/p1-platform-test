/**
 * Multi-Provider Identity Abstraction Layer
 *
 * Defines the IdentityProvider interface and MultiProviderIdentityProvider
 * that routes tokens to the correct verifier based on the JWT's `iss` claim.
 *
 * @see collaborative-state-system-architecture-v2.3.md
 */

import * as jose from 'jose';

import type { AuthenticatedPrincipal, AuthProvider } from '../types';
import type { MockIdentityProvider } from './mock-identity-provider';

/**
 * Interface for authentication providers.
 * Each provider knows how to verify tokens from a specific issuer.
 */
export interface IdentityProvider {
  /** Provider name for logging/detection */
  readonly name: AuthProvider;

  /** Check if this provider can verify the given token (by inspecting claims) */
  canVerifyToken(token: string): boolean;

  /** Validate a Bearer token and return principal, or null if invalid */
  validateToken(token: string): Promise<AuthenticatedPrincipal | null>;

  /** Validate an agent API key, or null if not supported/invalid */
  validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null>;
}

/**
 * Safely decode a JWT's payload without verification.
 * Returns null if the token is malformed or not a valid JWT.
 *
 * SECURITY NOTE: This is used only for routing (reading the `iss` claim to
 * select the correct provider). The selected provider performs full signature
 * verification in its `validateToken()` method. An attacker forging the `iss`
 * claim will be routed to a provider that will reject the invalid signature.
 */
function safeDecodeJwt(token: string): jose.JWTPayload | null {
  if (token === '' || !token.includes('.')) {
    return null;
  }
  try {
    return jose.decodeJwt(token);
  } catch {
    return null;
  }
}

/**
 * Adapter that wraps the existing MockIdentityProvider to implement
 * the IdentityProvider interface. Avoids modifying the well-tested class.
 */
export class MockIdentityProviderAdapter implements IdentityProvider {
  readonly name: AuthProvider = 'mock';
  private readonly mockProvider: MockIdentityProvider;

  constructor(mockProvider: MockIdentityProvider) {
    this.mockProvider = mockProvider;
  }

  canVerifyToken(token: string): boolean {
    const payload = safeDecodeJwt(token);
    if (!payload) {
      return false;
    }
    return payload.iss === 'mock-identity-provider';
  }

  async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
    const principal = await this.mockProvider.validateToken(token);
    if (principal) {
      principal.authProvider = this.name;
    }
    return principal;
  }

  async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
    const principal = await this.mockProvider.validateAgentKey(apiKey);
    if (principal) {
      principal.authProvider = this.name;
    }
    return principal;
  }
}

/**
 * Routes authentication requests to the appropriate provider based on
 * the JWT's `iss` claim. Tries providers in registration order for API keys.
 */
export class MultiProviderIdentityProvider {
  private readonly providers: IdentityProvider[];

  constructor(providers: IdentityProvider[]) {
    // Detect duplicate provider names to prevent ambiguous routing
    const seen = new Set<AuthProvider>();
    for (const provider of providers) {
      if (seen.has(provider.name)) {
        console.warn(
          'MultiProviderIdentityProvider: duplicate provider name "' +
            provider.name + '" — first registered instance takes priority',
        );
      }
      seen.add(provider.name);
    }
    this.providers = providers;
  }

  /**
   * Validate a Bearer token by routing to the provider that recognizes the issuer.
   * Decodes the JWT (without verification) to read the `iss` claim, then
   * delegates to the matching provider for full verification.
   */
  async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
    if (!token) {
      return null;
    }

    // Find providers that claim they can verify this token
    for (const provider of this.providers) {
      if (provider.canVerifyToken(token)) {
        const principal = await provider.validateToken(token);
        if (principal) {
          return principal;
        }
      }
    }

    return null;
  }

  /**
   * Validate an agent API key by trying each provider in order.
   * Returns the first successful result, or null if no provider validates it.
   */
  async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
    if (!apiKey) {
      return null;
    }

    for (const provider of this.providers) {
      const principal = await provider.validateAgentKey(apiKey);
      if (principal) {
        return principal;
      }
    }

    return null;
  }
}
