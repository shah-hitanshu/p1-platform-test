/**
 * Authentication Middleware
 *
 * Identity provider configuration, token validation, MAS client creation,
 * and mock auth endpoints for development. Extracted from index.ts.
 */

import { MockIdentityProvider } from '../auth/mock-identity-provider';
import {
  MultiProviderIdentityProvider,
  MockIdentityProviderAdapter,
} from '../auth/identity-provider';
import { GoogleIdentityProvider } from '../auth/google-identity-provider';
import { Auth0IdentityProvider } from '../auth/auth0-identity-provider';
import type { AuthenticatedPrincipal, MockIdentityConfig } from '../types';
import { SiteApiTokenProvider } from '../auth/site-token-provider';
import { AgentApiKeyProvider } from '../auth/agent-api-key-provider';
import { MASClient } from '../services/mas-client';
import { CSSAuthIdentityProvider } from '../auth/css-auth-identity-provider';
import { authOAuthProvider } from '../auth/oauth/oauth-provider-setup';
import { jsonResponse, errorResponse } from '../utils/http-helpers';
import type { Env } from '../index';

/**
 * Default mock identity configuration for development.
 * User/agent IDs must be valid UUIDs to match database schema.
 */
export const DEFAULT_MOCK_CONFIG: MockIdentityConfig = {
  tokenExpiry: '24h',
  users: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'alice@example.com',
      name: 'Alice Developer',
      siteRoles: {
        'site-123': 'admin',
        'site-456': 'developer',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'bob@example.com',
      name: 'Bob Reviewer',
      siteRoles: {
        'site-123': 'team_member',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      email: 'carol@example.com',
      name: 'Carol Editor',
      siteRoles: {
        'site-123': 'developer',
        'site-456': 'admin',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
  ],
  agents: [
    {
      // ID must match database: a0000000-0000-0000-0000-000000000001 (Zappy)
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Zappy AI Assistant',
      apiKey: 'test-agent-key-zappy',
      siteRoles: {
        'site-123': 'editor',
        '5da7f0d0-81d8-4e92-9a4b-a4cb07090768': 'admin',
        '35b800c4-6010-4908-a724-f1512e2a2144': 'admin',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
    {
      // ID must match database: a0000000-0000-0000-0000-000000000002 (Helper)
      id: 'a0000000-0000-0000-0000-000000000002',
      name: 'Helper Bot',
      apiKey: 'test-agent-key-helper',
      siteRoles: { 'site-123': 'viewer', 'site-456': 'editor' },
    },
  ],
};

/**
 * Check whether any real OAuth provider is configured.
 * When true, mock authentication should be disabled.
 */
export function hasOAuthProviders(env: Env): boolean {
  const hasGoogle = env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_ID !== '';
  const hasAuth0 =
    env.AUTH0_ISSUER_BASE_URL !== undefined &&
    env.AUTH0_ISSUER_BASE_URL !== '' &&
    env.AUTH0_AUDIENCE !== undefined &&
    env.AUTH0_AUDIENCE !== '';
  const hasCSSAuth = env.CSS_AUTH_SERVER !== undefined || env.OAUTH_KV !== undefined;
  return hasGoogle || hasAuth0 || hasCSSAuth;
}

/**
 * Build a MultiProviderIdentityProvider with registered providers.
 * Mock provider is always available in non-production environments.
 * Google and Auth0 providers will be added in Phases 2 and 3.
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

  // Google OAuth provider (activated when client ID is configured)
  if (env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_ID !== '') {
    providers.push(new GoogleIdentityProvider({
      clientId: env.GOOGLE_CLIENT_ID,
    }));
  }

  // Auth0 provider (activated when issuer and audience are configured)
  if (
    env.AUTH0_ISSUER_BASE_URL !== undefined &&
    env.AUTH0_ISSUER_BASE_URL !== '' &&
    env.AUTH0_AUDIENCE !== undefined &&
    env.AUTH0_AUDIENCE !== ''
  ) {
    providers.push(new Auth0IdentityProvider({
      issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL,
      newIssuerBaseUrl: env.AUTH0_NEW_ISSUER_BASE_URL,
      audience: env.AUTH0_AUDIENCE,
    }));
  }

  // Site API token provider (always available — validates sat_ tokens against DB)
  providers.push(new SiteApiTokenProvider());

  // Agent API key provider (always available — validates aak_ keys against DB)
  providers.push(new AgentApiKeyProvider());

  // CSS Auth Identity Provider — validates opaque tokens issued by the CSS OAuth server.
  // Added LAST since token validation is async; JWT providers (Google, Auth0) verify locally.
  //
  // Two activation paths (mutually exclusive — OAUTH_KV takes precedence):
  //
  // 1. In-process (merged worker): activated when OAUTH_KV is configured.
  //    Calls authOAuthProvider.fetch() directly — no network hop. The sentinel URL
  //    http://internal/auth/internal/validate distinguishes in-process calls from
  //    external requests, allowing the handler to call oauthHelpers.unwrapToken().
  //
  // 2. HTTP (standalone auth server, deprecated): activated when CSS_AUTH_SERVER
  //    service binding is configured and OAUTH_KV is absent. Calls the external
  //    auth server's POST /internal/token/validate via service binding.
  //    Removed in Phase 4 when CSS_AUTH_SERVER binding is dropped.
  if (env.OAUTH_KV !== undefined) {
    // In-process path — env is passed directly to authOAuthProvider.fetch()
    providers.push(new CSSAuthIdentityProvider({
      oauthProvider: authOAuthProvider,
      oauthEnv: env,
    }));
  } else if (env.CSS_AUTH_SERVER !== undefined) {
    if (env.INTERNAL_SECRET === undefined || env.INTERNAL_SECRET === '') {
      console.warn(
        '[getIdentityProvider] CSS_AUTH_SERVER binding is configured but INTERNAL_SECRET is ' +
        'empty or missing — CSSAuthIdentityProvider will not be registered. ' +
        'Set INTERNAL_SECRET in .dev.vars (local) or Cloudflare secrets (production).',
      );
    } else {
      providers.push(new CSSAuthIdentityProvider({
        authServerUrl: (env.CSS_AUTH_SERVER_URL !== undefined && env.CSS_AUTH_SERVER_URL !== '')
          ? env.CSS_AUTH_SERVER_URL
          : 'http://css-auth-server',
        internalSecret: env.INTERNAL_SECRET,
        fetcher: env.CSS_AUTH_SERVER,
      }));
    }
  }

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
    //   - JWT tokens (dot-containing, e.g. Google/Auth0 JWTs)
    //   - CSS auth server opaque tokens (userId:grantId:secret, no dots)
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

/**
 * Get the MockIdentityProvider for development-only auth endpoints.
 * These endpoints (token issuance, user listing) are mock-specific.
 */
export function getMockIdentityProvider(env: Env): MockIdentityProvider {
  return new MockIdentityProvider({
    config: DEFAULT_MOCK_CONFIG,
    jwtSecret: env.MOCK_JWT_SECRET ?? 'development-secret-must-be-at-least-32-characters',
    tokenExpiry: '24h',
  });
}

/**
 * Handle mock auth endpoints for frontend login (development only).
 */
export async function handleAuthRoutes(
  request: Request,
  path: string,
  env: Env,
): Promise<Response | null> {
  const mockProvider = getMockIdentityProvider(env);

  // GET /api/auth/users - List available users
  if (path === '/api/auth/users' && request.method === 'GET') {
    return jsonResponse({
      users: DEFAULT_MOCK_CONFIG.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        siteRoles: u.siteRoles,
      })),
      agents: DEFAULT_MOCK_CONFIG.agents.map((a) => ({
        id: a.id,
        name: a.name,
        siteRoles: a.siteRoles,
      })),
    });
  }

  // POST /api/auth/token - Issue token for user
  if (path === '/api/auth/token' && request.method === 'POST') {
    const rawBody: unknown = await request.json();
    const body = rawBody as { userId?: string; agentApiKey?: string };

    // Try user token
    if (typeof body.userId === 'string' && body.userId.length > 0) {
      const user = mockProvider.getUser(body.userId);
      if (user === undefined) {
        return errorResponse('User not found', 404);
      }
      const token = await mockProvider.issueToken(body.userId);
      return jsonResponse({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          siteRoles: user.siteRoles,
        },
      });
    }

    return errorResponse('userId is required', 400);
  }

  return null;
}
