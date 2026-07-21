/**
 * CSS MCP Server - Cloudflare Worker Entry Point
 *
 * Remote MCP server with OAuth 2.0 authentication via Auth0.
 * Uses @cloudflare/workers-oauth-provider for the OAuth Authorization Server role
 * and @modelcontextprotocol/sdk for the MCP Streamable HTTP transport.
 */

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type { OAuthHelpers, AuthRequest } from '@cloudflare/workers-oauth-provider';
import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Env } from './types.js';
import { createMcpServer } from './mcp-handler.js';
import {
  getAuth0AuthorizationUrl,
  exchangeAuth0Code,
  makeTokenExchangeCallback,
} from './auth/auth0-handler.js';
import { signState, verifyAndParseState, generateNonce } from './auth/state-signing.js';
import { handleHealthCheck } from './health.js';
import { logBindingModeOnce } from './binding-mode.js';
import { checkOauthRateLimit, shouldBypassRateLimit } from './rate-limit.js';

export { handleHealthCheck };

// =============================================================================
// User Props (stored in OAuth token)
// =============================================================================

interface UserProps {
  userId: string;
  email: string;
  name?: string;
  /** Auth0 access token — forwarded to the CSS backend as Bearer on every API call */
  auth0AccessToken: string;
  /** Auth0 refresh token; the token-exchange callback uses it to mint fresh access tokens. */
  auth0RefreshToken?: string;
  /** Epoch seconds at which auth0AccessToken expires; bounds the issued token's TTL. */
  auth0ExpiresAt?: number;
}

/**
 * PCC-3192 — extract the client IP from the Cloudflare-injected header.
 * Falls back to "unknown" so the key shape stays stable; an "unknown" bucket
 * is shared across requests with no IP, which is intentional fail-safe
 * grouping (better than skipping the limit entirely).
 */
function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/**
 * PCC-3192 — return a 429 Response with a Retry-After hint.
 * Used by the OAuth-endpoint rate-limit gates.
 */
function rateLimited(scope: string): Response {
  return new Response(
    JSON.stringify({ error: 'rate_limited', scope }),
    {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    },
  );
}

// =============================================================================
// MCP API Handler (receives authenticated requests from OAuthProvider)
// =============================================================================

const mcpApiHandler: ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>['fetch']> } = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // PCC-3193: emit a one-shot cold-start log of which CSS_BACKEND mode is in
    // use. Without the binding the agent key transits the public Internet —
    // this is how a future env-config drift becomes visible.
    logBindingModeOnce(env);

    // GET /mcp is for SSE notification streams which require persistent sessions.
    // Stateless workers don't support long-lived SSE, so reject GET requests.
    // The MCP client will fall back to POST-only mode.
    if (request.method === 'GET') {
      return new Response('SSE not supported in stateless mode', { status: 405 });
    }

    // DELETE /mcp is for session termination — not applicable without sessions.
    if (request.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    // /mcp via the OAuth flow requires a user identity, which OAuthProvider
    // injects as ctx.props. A missing props means the token carried no identity,
    // so reject the request rather than calling the backend without one.
    const props = (ctx as ExecutionContext & { props?: UserProps }).props;
    if (props === undefined) {
      console.error('MCP API handler: ctx.props is undefined -- rejecting request');
      return new Response(
        JSON.stringify({ error: 'Unauthorized', reason: 'no authenticated identity in token context' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const server = createMcpServer({
      baseUrl: env.CSS_BACKEND_URL,
      serverName: env.MCP_SERVER_NAME,
      serverVersion: env.MCP_SERVER_VERSION,
      actingUser: { id: props.userId, email: props.email, name: props.name },
      accessToken: props.auth0AccessToken,
      fetcher: env.CSS_BACKEND,
      // PCC-3192 — per-tool rate limiting. Both undefined in local dev
      // (no bindings configured); the wrapper fails OPEN with a one-shot
      // warn in that case.
      rateLimiters: {
        toolsRead: env.RL_TOOLS_READ,
        toolsMutation: env.RL_TOOLS_MUTATION,
        toolsAnon: env.RL_TOOLS_ANON,
      },
      rateLimitContext: {
        actingUserId: props.userId,
        clientIp: getClientIp(request),
      },
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

/**
 * Handle an MCP request authenticated by an agent API key.
 *
 * The caller's key is forwarded to the backend, which resolves the agent from
 * it. No user identity is involved.
 */
async function handleAgentMcpRequest(request: Request, env: Env): Promise<Response> {
  logBindingModeOnce(env);

  if (request.method === 'GET') {
    return new Response('SSE not supported in stateless mode', { status: 405 });
  }
  if (request.method === 'DELETE') {
    return new Response(null, { status: 204 });
  }

  const agentApiKey = request.headers.get('X-API-Key');
  if (agentApiKey == null || agentApiKey === '') {
    return new Response('Unauthorized', { status: 401 });
  }
  const server = createMcpServer({
    baseUrl: env.CSS_BACKEND_URL,
    agentApiKey,
    serverName: env.MCP_SERVER_NAME,
    serverVersion: env.MCP_SERVER_VERSION,
    fetcher: env.CSS_BACKEND,
    rateLimiters: {
      toolsRead: env.RL_TOOLS_READ,
      toolsMutation: env.RL_TOOLS_MUTATION,
      toolsAnon: env.RL_TOOLS_ANON,
    },
    rateLimitContext: { clientIp: getClientIp(request) },
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

// =============================================================================
// Default Handler (unauthenticated routes: health, authorize, callback)
// =============================================================================

/**
 * Extract OAuthHelpers from the environment.
 * OAuthProvider injects a helper object into env at a well-known key.
 * This function centralizes the access pattern so changes to the key
 * only require a single update.
 */
function getOAuthHelpers(env: Env): OAuthHelpers | undefined {
  return (env as Env & { OAUTH_PROVIDER?: OAuthHelpers }).OAUTH_PROVIDER;
}

/**
 * The worker's public-facing origin. Behind the content load balancer the inbound
 * Host is the workers.dev name, so request.url is not the public origin; PUBLIC_ORIGIN
 * pins it. Falls back to the request origin for local dev where it is unset.
 */
function getPublicOrigin(request: Request, env: Env): string {
  const configured: string | undefined = env.PUBLIC_ORIGIN;
  if (configured) {
    let origin = configured;
    while (origin.endsWith('/')) {
      origin = origin.slice(0, -1);
    }
    return origin;
  }
  return new URL(request.url).origin;
}

export const defaultHandler: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealthCheck(env.ENVIRONMENT);
    }

    // PCC-3192 — per-IP rate limit on the unauthenticated OAuth endpoints.
    // /token and /register are intercepted by the wrapping fetch (below)
    // before delegation to OAuthProvider; here we cover /authorize and
    // /callback, which we own.
    //
    // OPTIONS bypass: a 429 here would be returned WITHOUT the CORS headers
    // OAuthProvider sets in its main fetch path, breaking browser-based MCP
    // clients. Preflight requests are cheap, must not be rate-limited.
    if (
      (url.pathname === '/authorize' || url.pathname === '/callback') &&
      !shouldBypassRateLimit(request.method)
    ) {
      const verdict = await checkOauthRateLimit(
        env.RL_OAUTH,
        url.pathname,
        getClientIp(request),
      );
      if (!verdict.allowed) {
        return rateLimited('oauth');
      }
    }

    // OAuth authorize endpoint - redirect to Auth0
    if (url.pathname === '/authorize') {
      // Auth0 issues a verifiable JWT only when an audience is requested; without
      // one the forwarded token is opaque and the backend rejects it. Refuse the
      // flow up front, logging the cause server-side without leaking it to the client.
      if (env.AUTH0_AUDIENCE === undefined || env.AUTH0_AUDIENCE === '') {
        console.error('MCP /authorize refused: AUTH0_AUDIENCE is not configured');
        return new Response(
          JSON.stringify({ error: 'server_error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // The state parameter is HMAC-signed; without the key the callback cannot
      // tell a genuine state from a forged one, so the flow must not start.
      if (env.MCP_STATE_SIGNING_SECRET === undefined || env.MCP_STATE_SIGNING_SECRET === '') {
        console.error('MCP /authorize refused: MCP_STATE_SIGNING_SECRET is not configured');
        return new Response(
          JSON.stringify({ error: 'server_error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response('OAuth not configured', { status: 500 });
      }

      // Parse the incoming OAuth authorization request
      const authRequest: AuthRequest = await oauthHelpers.parseAuthRequest(request);

      // Verify the client exists
      const client = await oauthHelpers.lookupClient(authRequest.clientId);
      if (!client) {
        return new Response('Unknown client', { status: 400 });
      }

      // Sign the auth request and a one-time nonce into the state parameter so
      // the flow can resume after Auth0 redirects back, and so the callback can
      // confirm the state and the id token both belong to this request.
      const nonce = generateNonce();
      const signedState = await signState(
        {
          authRequest: {
            responseType: authRequest.responseType,
            clientId: authRequest.clientId,
            redirectUri: authRequest.redirectUri,
            scope: authRequest.scope,
            state: authRequest.state,
            codeChallenge: authRequest.codeChallenge,
            codeChallengeMethod: authRequest.codeChallengeMethod,
          },
          nonce,
        },
        env.MCP_STATE_SIGNING_SECRET,
      );

      // Build the callback URL for Auth0 to redirect to
      const callbackUrl = `${getPublicOrigin(request, env)}/callback`;

      // Note: RFC 8707 `resource` parameter omitted — Auth0 requires the resource
      // to be registered as an API in the tenant before accepting it. Use `audience`
      // for token scoping instead (AUTH0_AUDIENCE env var).
      const auth0Url = getAuth0AuthorizationUrl({
        issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL,
        clientId: env.AUTH0_CLIENT_ID,
        redirectUri: callbackUrl,
        state: signedState,
        scope: 'openid email profile offline_access',
        audience: env.AUTH0_AUDIENCE,
        nonce,
      });

      return Response.redirect(auth0Url, 302);
    }

    // OAuth callback from Auth0
    if (url.pathname === '/callback') {
      // Without the signing key the state cannot be verified, so the callback
      // cannot trust it. Refuse rather than verify against an empty key.
      if (env.MCP_STATE_SIGNING_SECRET === undefined || env.MCP_STATE_SIGNING_SECRET === '') {
        console.error('MCP /callback refused: MCP_STATE_SIGNING_SECRET is not configured');
        return new Response(
          JSON.stringify({ error: 'server_error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');

      if (code === null || code === '' || stateParam === null || stateParam === '') {
        return new Response('Missing code or state parameter', { status: 400 });
      }

      // Recover the original auth request from the signed state. A null result
      // means the state failed signature verification (forged or tampered) or
      // was not issued by this server; a missing scope array means it is
      // structurally invalid. Either way the callback is rejected before the
      // code is exchanged.
      const stateData = await verifyAndParseState<{
        authRequest: {
          responseType: string;
          clientId: string;
          redirectUri: string;
          scope: string[];
          state: string;
          codeChallenge?: string;
          codeChallengeMethod?: string;
        };
        nonce?: string;
      }>(stateParam, env.MCP_STATE_SIGNING_SECRET);

      if (stateData === null || !Array.isArray(stateData.authRequest.scope)) {
        return new Response(
          JSON.stringify({ error: 'invalid_request', error_description: 'Invalid state parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Exchange the Auth0 auth code for tokens.
      // exchangeAuth0Code throws on network errors or non-ok Auth0 responses.
      const callbackUrl = `${getPublicOrigin(request, env)}/callback`;
      let auth0Result: Awaited<ReturnType<typeof exchangeAuth0Code>>;
      try {
        auth0Result = await exchangeAuth0Code({
          code,
          issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL,
          clientId: env.AUTH0_CLIENT_ID,
          clientSecret: env.AUTH0_CLIENT_SECRET,
          redirectUri: callbackUrl,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Auth0 code exchange failed:', message);
        return new Response(
          JSON.stringify({ error: 'upstream_error', error_description: 'Auth0 token exchange failed' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // The id token's nonce must match the one signed into the state, binding
      // this token to the request this browser started.
      if (stateData.nonce !== undefined && auth0Result.user.nonce !== stateData.nonce) {
        console.error('Auth0 callback rejected: id token nonce does not match state');
        return new Response(
          JSON.stringify({ error: 'invalid_request', error_description: 'Nonce mismatch' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Get the OAuthHelpers to complete the authorization
      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response('OAuth not configured', { status: 500 });
      }

      // Complete the authorization with user identity from Auth0
      const { redirectTo } = await oauthHelpers.completeAuthorization({
        request: stateData.authRequest,
        userId: auth0Result.user.sub,
        metadata: {
          label: auth0Result.user.name ?? auth0Result.user.email,
        },
        scope: stateData.authRequest.scope,
        props: {
          userId: auth0Result.user.sub,
          email: auth0Result.user.email,
          name: auth0Result.user.name,
          auth0AccessToken: auth0Result.accessToken,
          auth0RefreshToken: auth0Result.refreshToken,
          auth0ExpiresAt: Math.floor(Date.now() / 1000) + auth0Result.expiresIn,
        } satisfies UserProps,
      });

      return Response.redirect(redirectTo, 302);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// =============================================================================
// OAuth Provider (wraps the Worker)
// =============================================================================

// Built per request so the token-exchange callback can read Auth0 config from env.
function createOAuthProvider(env: Env): OAuthProvider<Env> {
  return new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler: mcpApiHandler,
    defaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    accessTokenTTL: 3600,      // 1 hour
    refreshTokenTTL: 31536000,  // 365 days
    tokenExchangeCallback: makeTokenExchangeCallback({
      issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL,
      clientId: env.AUTH0_CLIENT_ID,
      clientSecret: env.AUTH0_CLIENT_SECRET,
    }),
  });
}

// PCC-3192 — wrap the OAuthProvider to apply per-IP rate limits on the
// endpoints OAuthProvider owns internally (/token and /register). For
// /authorize and /callback the gate lives inside defaultHandler. We only
// intercept the two endpoints OAuthProvider takes from us; everything
// else (including /mcp, which is handled by ctx.props-injecting machinery
// inside OAuthProvider) is delegated unchanged.
//
// OPTIONS bypass: a 429 returned here would lack CORS headers, breaking
// browser-based MCP clients. OAuthProvider's own fetch path returns the
// CORS preflight response — we must let the request flow through.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Autonomous agents authenticate with their own key in X-API-Key. Route them
    // to the backend pass-through; OAuthProvider only accepts its own issued
    // tokens and would reject a raw agent key.
    const agentApiKey = request.headers.get('X-API-Key');
    if (url.pathname === '/mcp' && agentApiKey != null && agentApiKey !== '') {
      return handleAgentMcpRequest(request, env);
    }

    if (
      (url.pathname === '/token' || url.pathname === '/register') &&
      !shouldBypassRateLimit(request.method)
    ) {
      const verdict = await checkOauthRateLimit(
        env.RL_OAUTH,
        url.pathname,
        getClientIp(request),
      );
      if (!verdict.allowed) {
        return rateLimited('oauth');
      }
    }
    return createOAuthProvider(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
