/**
 * CSS MCP Server - Cloudflare Worker Entry Point
 *
 * Remote MCP server with OAuth 2.0 authentication via Google.
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
  getGoogleAuthorizationUrl,
  exchangeGoogleCode,
} from './auth/google-handler.js';
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

const mcpApiHandler: ExportedHandler<Env> = {
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

    // Extract user props from the authenticated context.
    // OAuthProvider sets ctx.props with the user identity from the OAuth token.
    // If props is undefined, the request may have bypassed token validation
    // or the library API changed -- log a warning and proceed without acting-user.
    const props = (ctx as ExecutionContext & { props?: UserProps }).props;
    if (props === undefined) {
      console.warn('MCP API handler: ctx.props is undefined -- acting-user context unavailable');
    }

    const server = createMcpServer({
      baseUrl: env.CSS_BACKEND_URL,
      agentId: env.AGENT_ID,
      agentApiKey: env.AGENT_API_KEY,
      serverName: env.MCP_SERVER_NAME,
      serverVersion: env.MCP_SERVER_VERSION,
      actingUser: props ? { id: props.userId, email: props.email, name: props.name } : undefined,
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
        actingUserId: props?.userId,
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

const defaultHandler: ExportedHandler<Env> = {
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

    // OAuth authorize endpoint - redirect to Google
    if (url.pathname === '/authorize') {
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

      // Encode the auth request state into our state parameter
      // so we can resume after Google redirects back
      const stateData = JSON.stringify({
        authRequest: {
          responseType: authRequest.responseType,
          clientId: authRequest.clientId,
          redirectUri: authRequest.redirectUri,
          scope: authRequest.scope,
          state: authRequest.state,
          codeChallenge: authRequest.codeChallenge,
          codeChallengeMethod: authRequest.codeChallengeMethod,
        },
      });
      const encodedState = btoa(stateData);

      // Build the callback URL for Google to redirect to
      const callbackUrl = `${url.origin}/callback`;

      // Redirect to Google
      const googleAuthUrl = getGoogleAuthorizationUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: callbackUrl,
        state: encodedState,
        scope: 'openid email profile',
      });

      return Response.redirect(googleAuthUrl, 302);
    }

    // OAuth callback from Google
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');

      if (code === null || code === '' || stateParam === null || stateParam === '') {
        return new Response('Missing code or state parameter', { status: 400 });
      }

      // Decode the state to recover the original auth request
      const stateData = JSON.parse(atob(stateParam)) as {
        authRequest: {
          responseType: string;
          clientId: string;
          redirectUri: string;
          scope: string[];
          state: string;
          codeChallenge?: string;
          codeChallengeMethod?: string;
        };
      };

      // Exchange the Google auth code for tokens
      const callbackUrl = `${url.origin}/callback`;
      const googleResult = await exchangeGoogleCode({
        code,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: callbackUrl,
      });

      // Get the OAuthHelpers to complete the authorization
      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response('OAuth not configured', { status: 500 });
      }

      // Complete the authorization with user identity from Google
      const { redirectTo } = await oauthHelpers.completeAuthorization({
        request: stateData.authRequest,
        userId: googleResult.user.sub,
        metadata: {
          label: googleResult.user.name ?? googleResult.user.email,
        },
        scope: stateData.authRequest.scope,
        props: {
          userId: googleResult.user.sub,
          email: googleResult.user.email,
          name: googleResult.user.name,
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

const oauthProvider = new OAuthProvider<Env>({
  apiRoute: '/mcp',
  apiHandler: mcpApiHandler,
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  accessTokenTTL: 3600,      // 1 hour
  refreshTokenTTL: 2592000,  // 30 days
});

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
    return oauthProvider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
