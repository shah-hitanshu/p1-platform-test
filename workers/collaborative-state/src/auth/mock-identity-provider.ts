/**
 * Phase 2.1: Mock Identity Provider
 *
 * Provides authentication for local development without external dependencies.
 * Issues JWTs for test users and validates agent API keys.
 *
 * @see collaborative-state-system-architecture-v2.2.md
 */

import * as jose from 'jose';

import type {
  AuthenticatedPrincipal,
  MockIdentityConfig,
  MockUser,
  MockAgent,
  PantheonRole,
} from '../types';

/**
 * JWT issuer used for all tokens issued by the mock provider.
 */
const ISSUER = 'mock-identity-provider';

/**
 * Minimum required length for JWT secret.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Default token expiry if not specified.
 */
const DEFAULT_TOKEN_EXPIRY = '24h';

/**
 * Configuration options for the MockIdentityProvider.
 */
export interface MockIdentityProviderOptions {
  /** The mock identity configuration with users and agents */
  config: MockIdentityConfig;
  /** Secret for signing JWTs (must be at least 32 characters) */
  jwtSecret: string;
  /** Token expiry duration (e.g., '1h', '24h'). Defaults to '24h' */
  tokenExpiry?: string;
}

/**
 * JWT payload structure for user tokens.
 */
interface UserTokenPayload {
  sub: string;
  email: string;
  name: string;
  type: 'user';
  siteRoles: Record<string, PantheonRole>;
}

/**
 * Mock identity provider for local development.
 * Issues JWTs and validates tokens/API keys without external dependencies.
 *
 * @example
 * ```typescript
 * const provider = new MockIdentityProvider({
 *   config: loadedConfig,
 *   jwtSecret: env.MOCK_JWT_SECRET,
 *   tokenExpiry: '24h',
 * });
 *
 * // Issue token for user
 * const token = await provider.issueToken('user-alice');
 *
 * // Validate token
 * const principal = await provider.validateToken(token);
 *
 * // Validate agent API key
 * const agentPrincipal = await provider.validateAgentKey('test-agent-key');
 * ```
 */
export class MockIdentityProvider {
  private readonly config: MockIdentityConfig;
  private readonly secret: Uint8Array;
  private readonly tokenExpiry: string;

  constructor(options: MockIdentityProviderOptions) {
    // Validate jwtSecret
    if (options.jwtSecret === '') {
      throw new Error('jwtSecret is required');
    }
    if (options.jwtSecret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `jwtSecret must be at least ${String(MIN_SECRET_LENGTH)} characters`,
      );
    }

    // Validate config
    if (!Array.isArray(options.config.users)) {
      throw new Error('config.users is required');
    }
    if (!Array.isArray(options.config.agents)) {
      throw new Error('config.agents is required');
    }

    this.config = options.config;
    this.secret = new TextEncoder().encode(options.jwtSecret);
    this.tokenExpiry = options.tokenExpiry ?? DEFAULT_TOKEN_EXPIRY;
  }

  /**
   * Issues a JWT for the specified user.
   * @param userId - The ID of the user to issue a token for
   * @returns A signed JWT string
   * @throws If the user is not found in the configuration
   */
  async issueToken(userId: string): Promise<string> {
    const user = this.getUser(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const payload: UserTokenPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      type: 'user',
      siteRoles: user.siteRoles,
    };

    const token = await new jose.SignJWT(payload as unknown as jose.JWTPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(this.tokenExpiry)
      .sign(this.secret);

    return token;
  }

  /**
   * Validates a JWT and returns the authenticated principal.
   * @param token - The JWT to validate
   * @returns The authenticated principal, or null if invalid
   */
  async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
    if (!token) {
      return null;
    }

    try {
      const { payload } = await jose.jwtVerify(token, this.secret, {
        issuer: ISSUER,
      });

      // Extract claims
      const sub = payload.sub;
      const type = payload.type as 'user' | 'agent' | 'service' | undefined;
      const email = payload.email as string | undefined;
      const name = payload.name as string | undefined;
      const siteRoles = payload.siteRoles as
        | Record<string, PantheonRole>
        | undefined;
      const exp = payload.exp;

      if (sub == null || type == null || exp == null) {
        return null;
      }

      // Convert expiration to ISO string
      const tokenExpiry = new Date(exp * 1000).toISOString();

      return {
        id: sub,
        type,
        email,
        name,
        pantheonSiteRoles: siteRoles ?? {},
        tokenExpiry,
      };
    } catch {
      // Token is invalid (expired, wrong signature, malformed, etc.)
      return null;
    }
  }

  /**
   * Validates an agent API key and returns the authenticated principal.
   * @param apiKey - The API key to validate
   * @returns The authenticated principal, or null if invalid
   */
  async validateAgentKey(
    apiKey: string,
  ): Promise<AuthenticatedPrincipal | null> {
    // Maintain async signature for consistency with validateToken
    await Promise.resolve();

    if (apiKey === '') {
      return null;
    }

    const agent = this.config.agents.find((a) => a.apiKey === apiKey);
    if (!agent) {
      return null;
    }

    // Agent tokens expire 24 hours from now
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    return {
      id: agent.id,
      type: 'agent',
      // Agents don't have email - intentionally omitted
      pantheonSiteRoles: agent.siteRoles as unknown as Record<
        string,
        PantheonRole
      >,
      tokenExpiry,
    };
  }

  /**
   * Gets a user by ID from the configuration.
   * @param userId - The user ID to look up
   * @returns The user, or undefined if not found
   */
  getUser(userId: string): MockUser | undefined {
    return this.config.users.find((u) => u.id === userId);
  }

  /**
   * Gets a user by email from the configuration.
   * @param email - The email address to look up
   * @returns The user, or undefined if not found
   */
  getUserByEmail(email: string): MockUser | undefined {
    return this.config.users.find((u) => u.email === email);
  }

  /**
   * Gets an agent by ID from the configuration.
   * @param agentId - The agent ID to look up
   * @returns The agent, or undefined if not found
   */
  getAgent(agentId: string): MockAgent | undefined {
    return this.config.agents.find((a) => a.id === agentId);
  }
}
