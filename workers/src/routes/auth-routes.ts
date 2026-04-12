/**
 * CSS Auth Routes — Google OAuth flow handlers
 *
 * These handlers implement the OAuth 2.0 Authorization Code flow with Google
 * as the upstream IdP. They are mounted at the /auth/ prefix in the main
 * collaborative-state-worker (see workers/src/index.ts) via OAuthProvider.
 *
 * Flow:
 * 1. Browser sends GET /auth/authorize?client_id={siteId}&redirect_uri=...&code_challenge=...
 * 2. Handler validates redirect_uri against site's allowedOrigins (direct DB lookup)
 * 3. Upserts client in OAUTH_KV, calls parseAuthRequest(), redirects to Google
 * 4. Google redirects to GET /auth/callback?code=...&state=...
 * 5. Handler verifies HMAC-signed state, re-validates redirect_uri, exchanges code with
 *    Google, creates CSS token via completeAuthorization, redirects browser to client
 *
 * Tokens are validated by CSSAuthIdentityProvider calling oauthHelpers.unwrapToken()
 * directly — no HTTP round-trip to a separate auth server is needed.
 */

import type { OAuthHelpers, AuthRequest, ClientInfo } from '@cloudflare/workers-oauth-provider';
import { getSiteAllowedOrigins } from '../services/site-service.js';
import { signState, verifyAndParseState } from '../auth/oauth/state-signing.js';
import { getGoogleAuthorizationUrl, exchangeGoogleCode } from '../auth/oauth/google-handler.js';
import { matchesAllowedOrigin } from '../auth/oauth/origin-validator.js';

// =============================================================================
// Environment interface
// Fields required by the auth route handlers. The main worker Env satisfies
// this interface after Phase 4 binding changes.
// =============================================================================

export interface AuthOAuthEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  INTERNAL_SECRET: string;
  OAUTH_KV: KVNamespace;
}

// =============================================================================
// User Props (stored in OAuth token, returned via oauthHelpers.unwrapToken())
// =============================================================================

export interface UserProps {
  userId: string;
  email: string;
  name?: string;
  siteId: string;    // The site the user authenticated for (client_id)
  provider: string;  // Upstream IdP used ('google') — used by CSSAuthIdentityProvider to generate UUIDv5
}

// =============================================================================
// OAuth Helpers Accessor
// =============================================================================

export function getOAuthHelpers(env: AuthOAuthEnv): OAuthHelpers | undefined {
  return (env as AuthOAuthEnv & { OAUTH_PROVIDER?: OAuthHelpers }).OAUTH_PROVIDER;
}

// =============================================================================
// Client Upsert via Direct OAUTH_KV Write
//
// @cloudflare/workers-oauth-provider's lookupClient(clientId) reads:
//   OAUTH_KV.get('client:{clientId}', {type: 'json'})
//
// IMPORTANT: The library's createClient function cannot be used here because it
// always generates a random clientId (ignoring any clientId field in its argument).
// We write directly to KV at key 'client:{siteId}' for new registrations, and use
// oauthHelpers.updateClient() to accumulate validated redirect URIs on existing entries.
// =============================================================================

export async function upsertClient(
  env: AuthOAuthEnv,
  oauthHelpers: OAuthHelpers,
  siteId: string,
  exactRedirectUri: string,
): Promise<void> {
  const existing: ClientInfo | null = await oauthHelpers.lookupClient(siteId);

  if (existing === null) {
    // First authorization for this site — write a new public client registration
    // directly to OAUTH_KV using the site ID as the client ID.
    const clientInfo: ClientInfo = {
      clientId: siteId,
      redirectUris: [exactRedirectUri],
      tokenEndpointAuthMethod: 'none', // Public client (browser SPA — no client secret)
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      registrationDate: Math.floor(Date.now() / 1000),
    };
    await env.OAUTH_KV.put(`client:${siteId}`, JSON.stringify(clientInfo));
  } else {
    // Subsequent authorization — accumulate the validated redirect URI if new.
    const existingUris = existing.redirectUris;
    if (!existingUris.includes(exactRedirectUri)) {
      await oauthHelpers.updateClient(siteId, {
        redirectUris: [...existingUris, exactRedirectUri],
      });
    }
  }
}

// =============================================================================
// Stub API Handler
// The auth OAuthProvider has no resource API — all resource access goes through
// the main worker's own routes. This handler is required by OAuthProvider but
// returns 404 for any request that reaches it.
// =============================================================================

// Use explicit object shapes (not ExportedHandler<>) to satisfy OAuthProvider's
// requirement for a non-optional fetch method on apiHandler and defaultHandler.
export const authApiHandler = {
  fetch(_req: Request, _env: AuthOAuthEnv): Response {
    return new Response('Not Found', { status: 404 });
  },
};

// =============================================================================
// Default Handler (authorize, callback)
// =============================================================================

export const authDefaultHandler = {
  async fetch(request: Request, env: AuthOAuthEnv): Promise<Response> {
    const url = new URL(request.url);

    // GET /auth/authorize — validate client and redirect to Google
    if (url.pathname === '/auth/authorize') {
      // Step 1: Extract client_id and redirect_uri before calling parseAuthRequest(),
      // which calls lookupClient() internally and rejects if client not yet registered.
      const clientId = url.searchParams.get('client_id') ?? '';
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';

      if (!clientId || !redirectUri) {
        return new Response('Missing client_id or redirect_uri', { status: 400 });
      }

      // Step 2: Look up allowed origins directly from the database.
      // Returns null if site not found, empty array if no origins configured.
      let allowedOrigins: string[] | null;
      try {
        allowedOrigins = await getSiteAllowedOrigins(clientId);
      } catch {
        return new Response('Failed to look up site configuration', { status: 503 });
      }

      if (allowedOrigins === null) {
        return new Response('Unknown client (site not found)', { status: 400 });
      }

      // Step 3: Validate redirect_uri against the site's allowedOrigins.
      // Supports exact match and wildcard patterns like *-mysite.pantheonsite.io.
      if (!matchesAllowedOrigin(redirectUri, allowedOrigins)) {
        return new Response('redirect_uri not allowed for this client', { status: 400 });
      }

      // Step 4: Obtain OAuthHelpers — needed for upsert before parseAuthRequest.
      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response('OAuth not configured', { status: 500 });
      }

      // Step 5: Upsert client in OAUTH_KV so parseAuthRequest() can find it.
      await upsertClient(env, oauthHelpers, clientId, redirectUri);

      // Step 6: Parse the full OAuth request — succeeds because client is now registered.
      let authRequest: AuthRequest;
      try {
        authRequest = await oauthHelpers.parseAuthRequest(request);
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : 'Invalid authorization request';
        return new Response(msg, { status: 400 });
      }

      // Encode the auth request into the state parameter for resumption after callback.
      // Signed with INTERNAL_SECRET using HMAC-SHA256 to prevent state forgery.
      const statePayload = {
        authRequest: {
          responseType: authRequest.responseType,
          clientId: authRequest.clientId,
          redirectUri: authRequest.redirectUri,
          scope: authRequest.scope,
          state: authRequest.state,
          codeChallenge: authRequest.codeChallenge,
          codeChallengeMethod: authRequest.codeChallengeMethod,
        },
      };
      const encodedState = await signState(statePayload, env.INTERNAL_SECRET);

      // The callback URL must use the /auth/ prefix since the main worker
      // routes all /auth/* requests to the OAuthProvider.
      const callbackUrl = `${url.origin}/auth/callback`;

      const googleAuthUrl = getGoogleAuthorizationUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: callbackUrl,
        state: encodedState,
        scope: 'openid email profile',
      });

      console.log('[auth] authorize: redirecting to google', { siteId: clientId });
      return Response.redirect(googleAuthUrl, 302);
    }

    // GET /auth/callback — Google redirects back here after user authenticates
    if (url.pathname === '/auth/callback') {
      // TODO: Add Cloudflare Rate Limiting rule on /auth/callback by CF-Connecting-IP
      // to prevent repeated invalid code submissions. Requires platform-level config.
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');

      if (code === null || stateParam === null) {
        return new Response('Missing code or state parameter', { status: 400 });
      }

      interface StatePayload {
        authRequest: {
          responseType: string;
          clientId: string;
          redirectUri: string;
          scope: string[];
          state: string;
          codeChallenge?: string;
          codeChallengeMethod?: string;
        };
      }

      // Verify HMAC-SHA256 signature to prevent state forgery.
      const stateData = await verifyAndParseState<StatePayload>(stateParam, env.INTERNAL_SECRET);
      if (stateData === null) {
        console.log('[auth] callback: invalid state', { reason: 'signature_invalid' });
        return new Response('Invalid or tampered state parameter', { status: 400 });
      }

      // Re-validate redirect_uri at callback time — allowedOrigins may have changed
      // since /auth/authorize was called. The signed state proves the request was
      // unmodified, not that it's still authorized.
      let callbackAllowedOrigins: string[] | null;
      try {
        callbackAllowedOrigins = await getSiteAllowedOrigins(stateData.authRequest.clientId);
      } catch {
        return new Response('Failed to re-validate site configuration', { status: 503 });
      }
      if (
        callbackAllowedOrigins === null ||
        !matchesAllowedOrigin(stateData.authRequest.redirectUri, callbackAllowedOrigins)
      ) {
        console.log('[auth] callback: redirect_uri rejected', { clientId: stateData.authRequest.clientId });
        return new Response('Redirect URI no longer authorized for this client', { status: 400 });
      }

      const callbackUrl = `${url.origin}/auth/callback`;

      let googleResult;
      try {
        googleResult = await exchangeGoogleCode({
          code,
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: callbackUrl,
        });
      } catch {
        return new Response('Failed to exchange code with Google', { status: 502 });
      }

      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response('OAuth not configured', { status: 500 });
      }

      const { redirectTo } = await oauthHelpers.completeAuthorization({
        request: stateData.authRequest as AuthRequest,
        userId: googleResult.user.sub,
        metadata: {
          label: googleResult.user.name ?? googleResult.user.email,
        },
        scope: stateData.authRequest.scope,
        props: {
          userId: googleResult.user.sub,
          email: googleResult.user.email,
          name: googleResult.user.name,
          siteId: stateData.authRequest.clientId,
          provider: 'google',
        } satisfies UserProps,
      });

      console.log('[auth] callback: token issued', {
        siteId: stateData.authRequest.clientId,
        userEmail: googleResult.user.email,
      });
      return Response.redirect(redirectTo, 302);
    }

    return new Response('Not Found', { status: 404 });
  },
};
