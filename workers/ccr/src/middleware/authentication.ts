/**
 * Authentication Middleware
 *
 * Identity provider configuration, token validation, and MAS client creation.
 * Extracted from index.ts.
 *
 */

import { MockIdentityProvider } from '../auth/mock-identity-provider';
import { DEFAULT_MOCK_CONFIG } from '../auth/mock-auth';
import {
  MultiProviderIdentityProvider,
  MockIdentityProviderAdapter,
} from '../auth/identity-provider';
import { Auth0IdentityProvider } from '../auth/auth0-identity-provider';
import type { AuthenticatedPrincipal } from '../types';
import { SiteApiTokenProvider } from '../auth/site-token-provider';
import { AgentApiKeyProvider } from '../auth/agent-api-key-provider';
import { MASClient } from '../services/mas-client';
import { BrokerJwtIdentityProvider } from '../auth/broker-jwt-identity-provider';
import type { Env } from '../env';

/**
 * Check whether any real auth provider is configured.
 * When true, mock authentication should be disabled.
 */
export function hasRealAuthProviders(env: Env): boolean {
  const hasAuth0 =
    env.AUTH0_ISSUER_BASE_URL !== undefined &&
    env.AUTH0_ISSUER_BASE_URL !== '' &&
    env.AUTH0_AUDIENCE !== undefined &&
    env.AUTH0_AUDIENCE !== '';
  const hasBroker =
    env.GCP_KMS_KEY_RESOURCE !== undefined &&
    env.GCP_KMS_KEY_RESOURCE !== '' &&
    env.MAS_GCP_SERVICE_ACCOUNT_KEY !== undefined &&
    env.MAS_GCP_SERVICE_ACCOUNT_KEY !== '';
  return hasAuth0 || hasBroker;
}

/**
 * Build a MultiProviderIdentityProvider with registered providers.
 */
export function getIdentityProvider(env: Env): MultiProviderIdentityProvider {
  const providers = [];

  // Mock provider: available only in local development for token validation.
  // Sandboxes and production are internet-facing and must use real auth.
  if (env.ENVIRONMENT === 'local') {
    providers.push(new MockIdentityProviderAdapter(
      new MockIdentityProvider({
        config: DEFAULT_MOCK_CONFIG,
        jwtSecret: env.MOCK_JWT_SECRET ?? 'development-secret-must-be-at-least-32-characters',
        tokenExpiry: '24h',
      }),
    ));
  }

  // Auth0 provider (activated when issuer and audience are configured)
  if (
    env.AUTH0_ISSUER_BASE_URL !== undefined &&
    env.AUTH0_ISSUER_BASE_URL !== '' &&
    env.AUTH0_AUDIENCE !== undefined &&
    env.AUTH0_AUDIENCE !== ''
  ) {
    // AUTH0_AUDIENCE is a comma-separated accept-list: a token validates if its
    // `aud` matches any entry, so more than one trusted API audience can be served.
    const audience = env.AUTH0_AUDIENCE
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value !== '');
    providers.push(new Auth0IdentityProvider({
      issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL,
      audience,
    }));
  }

  // Broker JWT provider (activated when GCP KMS key is configured)
  const kmsKeyResource = env.GCP_KMS_KEY_RESOURCE;
  if (
    kmsKeyResource !== undefined &&
    kmsKeyResource !== '' &&
    env.MAS_GCP_SERVICE_ACCOUNT_KEY !== undefined &&
    env.MAS_GCP_SERVICE_ACCOUNT_KEY !== ''
  ) {
    providers.push(new BrokerJwtIdentityProvider({
      issuer: env.BROKER_JWT_ISSUER ?? env.PUBLIC_ORIGIN ?? 'https://css-api.pantheon.io',
      audience: env.BROKER_JWT_AUDIENCE ?? 'css-api',
      serviceAccountKeyJson: env.MAS_GCP_SERVICE_ACCOUNT_KEY,
      keyResource: kmsKeyResource,
    }));
  }

  // Site API token provider (always available — validates sat_ tokens against DB)
  providers.push(new SiteApiTokenProvider());

  // Agent API key provider (always available — validates aak_ keys against DB)
  providers.push(new AgentApiKeyProvider());

  return new MultiProviderIdentityProvider(providers);
}

/**
 * Create a MASClient instance when MAS integration is enabled.
 * Returns undefined when MAS_ENABLED is not 'true' or MAS_BASE_URL is missing.
 */
export function getMASClient(env: Env): MASClient | undefined {
  if (env.MAS_ENABLED !== 'true' || env.MAS_BASE_URL === undefined || env.MAS_BASE_URL === '') {
    return undefined;
  }

  return new MASClient({
    baseUrl: env.MAS_BASE_URL,
    gcpServiceAccountKey: env.MAS_GCP_SERVICE_ACCOUNT_KEY,
    cacheTtlSeconds: env.MAS_CACHE_TTL_SECONDS !== undefined && env.MAS_CACHE_TTL_SECONDS !== ''
      ? parseInt(env.MAS_CACHE_TTL_SECONDS, 10)
      : undefined,
  });
}

/**
 * Authenticate request and return principal.
 */
export async function authenticate(
  request: Request,
  env: Env,
): Promise<AuthenticatedPrincipal | null> {
  const identityProvider = getIdentityProvider(env);

  // Try Bearer token first
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ') === true) {
    const token = authHeader.substring(7);
    return await identityProvider.validateToken(token);
  }

  // Try API key from header
  const apiKey = request.headers.get('X-API-Key');
  if (apiKey !== null && apiKey !== '') {
    // Site API tokens (sat_ prefix) are validated as tokens, not agent keys
    if (apiKey.startsWith('sat_')) {
      return await identityProvider.validateToken(apiKey);
    }
    return await identityProvider.validateAgentKey(apiKey);
  }

  // Try from query params (for WebSocket - browsers can't send custom headers)
  const url = new URL(request.url);
  const queryApiKey = url.searchParams.get('apiKey');
  if (queryApiKey !== null && queryApiKey !== '') {
    // Site API tokens (sat_ prefix) are validated as tokens
    if (queryApiKey.startsWith('sat_')) {
      return await identityProvider.validateToken(queryApiKey);
    }
    // Try validateToken for all other credentials — this handles:
    //   - JWT tokens (dot-containing, e.g. Auth0/broker JWTs)
    // The MultiProviderIdentityProvider routes to the correct provider via canVerifyToken().
    // Fall back to validateAgentKey for aak_ agent API keys, which return null from validateToken.
    const tokenResult = await identityProvider.validateToken(queryApiKey);
    if (tokenResult !== null) {
      return tokenResult;
    }
    // Try as agent API key (aak_ tokens and other agent credentials)
    return await identityProvider.validateAgentKey(queryApiKey);
  }

  return null;
}
