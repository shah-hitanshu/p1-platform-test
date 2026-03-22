/**
 * Agent API Key Provider
 *
 * Authenticates agent API keys (aak_ prefixed) by delegating
 * to the agent-api-key-service for hash-based validation.
 * Returns an agent principal with no scopes -- authorization
 * is determined by per-site roles in agent_site_roles.
 *
 * Implements the IdentityProvider interface.
 */

import type { AuthenticatedPrincipal } from '../types';
import type { IdentityProvider } from './identity-provider';
import { validateKey } from '../services/agent-api-key-service';

const KEY_PREFIX = 'aak_';

/**
 * Provider for agent API keys (aak_ prefixed opaque tokens).
 * These keys authenticate AI agents, not users or services.
 *
 * Agent keys are NOT Bearer tokens. They are validated through
 * the validateAgentKey() path, not canVerifyToken()/validateToken().
 */
export class AgentApiKeyProvider implements IdentityProvider {
  readonly name = 'agent_key' as const;

  /**
   * Agent keys are not Bearer tokens and cannot be verified as JWTs.
   * Always returns false so the MultiProvider token routing skips this provider.
   */
  canVerifyToken(_token: string): boolean {
    return false;
  }

  /**
   * Bearer token validation is not supported for agent keys.
   * Always returns null.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateToken(_token: string): Promise<AuthenticatedPrincipal | null> {
    return null;
  }

  /**
   * Validate an agent API key and return an agent principal.
   *
   * Rejects keys that don't start with "aak_" or have no content after
   * the prefix without hitting the database. Valid-looking keys are
   * delegated to the agent-api-key-service for SHA-256 hash lookup.
   */
  async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
    if (!apiKey || !apiKey.startsWith(KEY_PREFIX) || apiKey.length <= KEY_PREFIX.length) {
      return null;
    }

    const result = await validateKey(apiKey);
    if (!result) {
      return null;
    }

    return {
      id: result.agentId,
      type: 'agent',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      authProvider: 'agent_key',
    };
  }
}
