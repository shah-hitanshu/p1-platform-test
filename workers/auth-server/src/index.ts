/**
 * CSS Auth Server — Cloudflare Worker Entry Point
 *
 * OAuth 2.0 Authorization Server for CSS.
 * Owns the Google OAuth Client ID. Puck-css frontend clients authenticate
 * here instead of registering directly with Google.
 *
 * Flow:
 * 1. Client sends GET /authorize?client_id={site_id}&redirect_uri=...&code_challenge=...
 * 2. Auth server extracts client_id and redirect_uri from query params directly
 * 3. Looks up site's allowedOrigins from main CSS worker (service binding)
 * 4. Validates redirect_uri against allowedOrigins via matchesAllowedOrigin()
 * 5. Upserts the client in OAUTH_KV (direct write for new, oauthHelpers.updateClient() for existing) with the exact redirect_uri
 * 6. Calls oauthHelpers.parseAuthRequest() — succeeds because client is now registered
 * 7. Redirects to Google OAuth (state parameter is HMAC-SHA256 signed with COOKIE_ENCRYPTION_KEY)
 * 8. Google redirects to /callback with auth code
 * 9. Auth server verifies HMAC signature on state, re-validates redirect_uri, exchanges code with Google,
 *    creates CSS token via completeAuthorization
 * 10. Redirects back to the client with the CSS token
 *
 * Resource servers validate tokens via POST /internal/token/validate which calls
 * oauthHelpers.unwrapToken() — NOT via RFC 7662 introspection (not exposed by this library).
 *
 * The MCP server is NOT a consumer of this auth server — it has its own OAuthProvider.
 */

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type { OAuthHelpers, AuthRequest, ClientInfo } from '@cloudflare/workers-oauth-provider';
import type { Env } from './types.js';
import { handleHealthCheck } from './health.js';
import { getGoogleAuthorizationUrl, exchangeGoogleCode } from './auth/google-handler.js';
import { matchesAllowedOrigin } from './auth/origin-validator.js';
import { lookupSiteAuthConfig } from './services/site-lookup.js';

// =============================================================================
// HMAC-SHA256 State Signing
//
// The OAuth state parameter carries the original auth request so it can be
// resumed after the Google callback. Without signing, an attacker who can
// forge the state value could supply an arbitrary clientId/redirectUri.
//
// signState() encodes the payload as base64(JSON) and appends a base64url HMAC
// signature separated by a dot: "<payload>.<sig>". This lets us split at the
// last '.' without ambiguity, and the base64url encoding avoids '.' in the sig.
//
// verifyAndParseState() uses constant-time comparison to prevent timing attacks.
// =============================================================================

/**
 * Signs a state payload using HMAC-SHA256 with the provided key.
 * Returns a string in the format: base64(JSON.stringify(data)).base64url(signature)
 * The dot separator allows splitting at lastIndexOf('.').
 */
async function signState(data: object, hmacKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(hmacKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const payload = btoa(JSON.stringify(data));
  const signature = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(payload));
  const sigBase64url = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.${sigBase64url}`;
}

/**
 * Verifies HMAC-SHA256 signature and parses the state payload.
 * Uses a constant-time comparison to prevent timing attacks.
 * Returns null if the signature is invalid or the payload cannot be parsed.
 */
async function verifyAndParseState<T>(signedState: string, hmacKey: string): Promise<T | null> {
  const dotIndex = signedState.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const payload = signedState.substring(0, dotIndex);
  const providedSig = signedState.substring(dotIndex + 1);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(hmacKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(payload));
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // Constant-time comparison to prevent timing attacks
  if (providedSig.length !== expectedSig.length) return null;
  let diff = 0;
  for (let i = 0; i < providedSig.length; i++) {
    diff |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (diff !== 0) return null;
  try {
    return JSON.parse(atob(payload)) as T;
  } catch {
    return null;
  }
}

// =============================================================================
// User Props (stored in OAuth token, returned via /internal/token/validate)
// =============================================================================

interface UserProps {
  userId: string;
  email: string;
  name?: string;
  siteId: string;    // The site the user authenticated for (client_id)
  provider: string;  // Upstream IdP used ('google', 'auth0', etc.) — used by CSSAuthIdentityProvider to generate the correct UUIDv5
}

// =============================================================================
// OAuth Helpers Accessor
// =============================================================================

function getOAuthHelpers(env: Env): OAuthHelpers | undefined {
  return (env as Env & { OAUTH_PROVIDER?: OAuthHelpers }).OAUTH_PROVIDER;
}

// =============================================================================
// Client Upsert via Direct OAUTH_KV Write
//
// @cloudflare/workers-oauth-provider's lookupClient(clientId) reads:
//   OAUTH_KV.get('client:{clientId}', {type: 'json'})
//
// This is the ONLY state needed for client lookup. Writing the ClientInfo JSON
// directly to KV at key 'client:{siteId}' is equivalent to what the library
// does after dynamic registration.
//
// IMPORTANT: The library's createClient function CANNOT be used here because it always
// generates a random clientId (ignoring any clientId field in its argument).
// This is verified in the library source (dist/oauth-provider.js, function
// OAuthHelpersImpl.createClient: 'const clientId = generateRandomString(16)').
// Calling createClient({ clientId: siteId }) would register a random-ID client
// and lookupClient(siteId) would still return null.
//
// oauthHelpers.updateClient(siteId, ...) IS used for updating existing entries
// because it correctly reads by clientId, merges, and writes back.
//
// Previously validated URIs accumulate. This handles the wildcard case: after
// matchesAllowedOrigin() passes, the exact URI is stored for future lookups.
// =============================================================================

async function upsertClient(
  env: Env,
  oauthHelpers: OAuthHelpers,
  siteId: string,
  exactRedirectUri: string,
): Promise<void> {
  const existing: ClientInfo | null = await oauthHelpers.lookupClient(siteId);

  if (existing === null) {
    // First time this site has authorized — write a new public client registration
    // directly to OAUTH_KV with the site ID as the client ID.
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
    // Subsequent authorization — merge the new exactRedirectUri if not already present.
    // Use oauthHelpers.updateClient() which correctly reads-then-writes by clientId.
    const existingUris = existing.redirectUris ?? [];
    if (!existingUris.includes(exactRedirectUri)) {
      await oauthHelpers.updateClient(siteId, {
        redirectUris: [...existingUris, exactRedirectUri],
      });
    }
    // If already present, nothing to do — the library will accept it in parseAuthRequest.
  }
}

// =============================================================================
// Stub API Handler (auth server has no resource API)
// Resource servers validate tokens via /internal/token/validate, not /auth-api endpoints.
// =============================================================================

const stubApiHandler: ExportedHandler<Env> = {
  fetch(): Response {
    return new Response('Not Found', { status: 404 });
  },
};

// =============================================================================
// Default Handler (health, authorize, callback, token validate)
// =============================================================================

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // GET /health
    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealthCheck(env.ENVIRONMENT);
    }

    // POST /internal/token/validate
    // Called by resource servers (main CSS worker) via service binding to validate
    // opaque access tokens. Uses oauthHelpers.unwrapToken() to decrypt stored props.
    // Protected by X-Internal-Secret header.
    // Auth: 401 if header is absent, 403 if header is present but wrong.
    if (url.pathname === '/internal/token/validate' && request.method === 'POST') {
      const secret = request.headers.get('X-Internal-Secret');
      if (secret === null) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (secret !== env.INTERNAL_SECRET) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rawBody: unknown = await request.json();
      const body = rawBody as { token?: string };
      const token = body.token;
      if (token === undefined || typeof token !== 'string' || token === '') {
        return new Response(JSON.stringify({ error: 'Missing token' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response(JSON.stringify({ error: 'OAuth not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const tokenData = await oauthHelpers.unwrapToken<UserProps>(token);

      if (!tokenData) {
        return new Response(JSON.stringify({ active: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // TokenSummary (from @cloudflare/workers-oauth-provider) shape:
      //   tokenData.userId       — the authenticated user's ID (top-level, from TokenBase)
      //   tokenData.expiresAt    — token expiry unix timestamp (top-level, from TokenBase)
      //   tokenData.grant.props  — decrypted UserProps stored at authorization time
      return new Response(JSON.stringify({
        active: true,
        sub: tokenData.userId,
        exp: tokenData.expiresAt,
        props: tokenData.grant.props,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /authorize — validate client and redirect to Google
    if (url.pathname === '/authorize') {
      // Step 1: Extract client_id and redirect_uri from query params BEFORE
      // calling parseAuthRequest(), because parseAuthRequest() calls lookupClient()
      // internally and rejects the request if the client is not yet registered.
      const clientId = url.searchParams.get('client_id') ?? '';
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';

      if (!clientId || !redirectUri) {
        return new Response('Missing client_id or redirect_uri', { status: 400 });
      }

      // Step 2: Look up the site's allowed origins via the main CSS worker service binding.
      // CSS_BACKEND is required at runtime for authorization to function.
      if (!env.CSS_BACKEND) {
        return new Response('CSS_BACKEND service binding not configured', { status: 500 });
      }
      let siteAuthConfig;
      try {
        siteAuthConfig = await lookupSiteAuthConfig(env.CSS_BACKEND, env.INTERNAL_SECRET, clientId);
      } catch {
        return new Response('Failed to look up site configuration', { status: 503 });
      }

      if (!siteAuthConfig) {
        return new Response('Unknown client (site not found)', { status: 400 });
      }

      // Step 3: Validate redirect_uri against site's allowedOrigins
      // (supports exact match and wildcard patterns like *-mysite.pantheonsite.io)
      if (!matchesAllowedOrigin(redirectUri, siteAuthConfig.allowedOrigins)) {
        return new Response('redirect_uri not allowed for this client', { status: 400 });
      }

      // Step 4: Obtain OAuthHelpers early — needed for upsert before parseAuthRequest.
      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response('OAuth not configured', { status: 500 });
      }

      // Step 5: Upsert the client in OAUTH_KV with client:{siteId} key.
      // This is required because parseAuthRequest() calls lookupClient() internally
      // and rejects the request if the client is not registered.
      // upsertClient() either creates the site's client KV entry (first visit)
      // or adds the validated exact redirect_uri to the existing entry.
      // NOTE: The library's createClient is NOT used — it ignores any provided
      // clientId and generates a random one. See Design Decision #1.
      await upsertClient(env, oauthHelpers, clientId, redirectUri);

      // Step 6: Parse the full OAuth request — now succeeds because client is registered.
      let authRequest: AuthRequest;
      try {
        authRequest = await oauthHelpers.parseAuthRequest(request);
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : 'Invalid authorization request';
        return new Response(msg, { status: 400 });
      }

      // Encode the auth request into the state parameter for resumption after Google callback.
      // The state is HMAC-SHA256 signed to prevent forgery of clientId/redirectUri.
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
      const encodedState = await signState(statePayload, env.COOKIE_ENCRYPTION_KEY);

      const callbackUrl = `${url.origin}/callback`;

      const googleAuthUrl = getGoogleAuthorizationUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: callbackUrl,
        state: encodedState,
        scope: 'openid email profile',
      });

      console.log('[auth] authorize: redirecting to google', { siteId: clientId });
      return Response.redirect(googleAuthUrl, 302);
    }

    // GET /callback — Google redirects back here after user authenticates
    if (url.pathname === '/callback') {
      // TODO: Add Cloudflare Rate Limiting rule on /callback by CF-Connecting-IP to prevent
      // repeated invalid code submissions. This requires a Cloudflare Rate Limiting configuration
      // (platform-level) — cannot be enforced purely in Worker code without a KV counter binding.
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');

      if (!code || !stateParam) {
        return new Response('Missing code or state parameter', { status: 400 });
      }

      type StatePayload = {
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

      // Verify HMAC-SHA256 signature on the state parameter to prevent forgery.
      const stateData = await verifyAndParseState<StatePayload>(stateParam, env.COOKIE_ENCRYPTION_KEY);
      if (stateData === null) {
        console.log('[auth] callback: invalid state', { reason: 'signature_invalid' });
        return new Response('Invalid or tampered state parameter', { status: 400 });
      }

      // Re-validate redirect_uri against site's allowedOrigins at callback time.
      // The allowedOrigins may have changed since /authorize was called, and the signed
      // state only proves the request was unmodified — not that it's still authorized.
      if (!env.CSS_BACKEND) {
        return new Response('CSS_BACKEND service binding not configured', { status: 500 });
      }
      let callbackSiteConfig;
      try {
        callbackSiteConfig = await lookupSiteAuthConfig(env.CSS_BACKEND, env.INTERNAL_SECRET, stateData.authRequest.clientId);
      } catch {
        return new Response('Failed to re-validate site configuration', { status: 503 });
      }
      if (!callbackSiteConfig || !matchesAllowedOrigin(stateData.authRequest.redirectUri, callbackSiteConfig.allowedOrigins)) {
        console.log('[auth] callback: redirect_uri rejected', { clientId: stateData.authRequest.clientId });
        return new Response('Redirect URI no longer authorized for this client', { status: 400 });
      }

      const callbackUrl = `${url.origin}/callback`;

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

      console.log('[auth] callback: token issued', { siteId: stateData.authRequest.clientId, userEmail: googleResult.user.email });
      return Response.redirect(redirectTo, 302);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// =============================================================================
// OAuth Provider Export
// =============================================================================

export default new OAuthProvider<Env>({
  apiRoute: '/auth-api',  // Stub route — auth server has no resource API
  apiHandler: stubApiHandler,
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  allowPlainPKCE: false,  // Enforce S256 only (OAuth 2.1 requirement)
  accessTokenTTL: 3600,      // 1 hour
  refreshTokenTTL: 2592000,  // 30 days
});
