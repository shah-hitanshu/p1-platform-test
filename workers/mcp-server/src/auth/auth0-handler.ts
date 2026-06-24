/**
 * Auth0 OAuth handler for the MCP server.
 *
 * Builds the upstream authorization URL, exchanges the auth code for tokens,
 * decodes the ID token claims, and refreshes the access token so an MCP session
 * can outlive the upstream token.
 *
 * Functional duplicate of workers/src/auth/oauth/auth0-handler.ts, would be nice to consolidate
 *
 * when a pattern for sharing code between the two workers is added
*/

import { decodeJwt } from 'jose';

export interface Auth0AuthUrlParams {
  issuerBaseUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  audience?: string;
  nonce?: string;
}

export interface Auth0CodeExchangeParams {
  code: string;
  issuerBaseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Auth0User {
  sub: string;
  email: string;
  name?: string;
  email_verified?: boolean;
  /** Echoed back from the authorization request; compared against the signed state. */
  nonce?: string;
}

export interface Auth0CodeExchangeResult {
  accessToken: string;
  user: Auth0User;
  /** Present when the `offline_access` scope was granted; used to mint fresh access tokens. */
  refreshToken?: string;
  /** Access-token lifetime in seconds, as reported by Auth0. */
  expiresIn: number;
}

export interface Auth0RefreshParams {
  refreshToken: string;
  issuerBaseUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface Auth0RefreshResult {
  accessToken: string;
  /** Auth0 returns a new refresh token only when rotation is enabled; otherwise undefined. */
  refreshToken?: string;
  expiresIn: number;
}

function normalizeIssuer(issuerBaseUrl: string): string {
  let s = issuerBaseUrl;
  while (s.endsWith('/')) {
    s = s.slice(0, -1);
  }
  return s;
}

export function getAuth0AuthorizationUrl(params: Auth0AuthUrlParams): string {
  const issuer = normalizeIssuer(params.issuerBaseUrl);
  const url = new URL(`${issuer}/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('state', params.state);
  if (params.audience !== undefined && params.audience !== '') {
    url.searchParams.set('audience', params.audience);
  }
  if (params.nonce !== undefined && params.nonce !== '') {
    url.searchParams.set('nonce', params.nonce);
  }
  return url.toString();
}

/**
 * Decode the payload of an Auth0 ID token. No signature check is needed: the
 * token arrives directly from Auth0's token endpoint over HTTPS.
 */
function decodeAuth0IdTokenClaims(idToken: string): Auth0User {
  const claims = decodeJwt(idToken) as unknown as Auth0User;
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new Error('Invalid ID token: missing sub claim');
  }
  if (typeof claims.email !== 'string' || claims.email === '') {
    throw new Error('Invalid ID token: missing email claim');
  }
  return claims;
}

export async function exchangeAuth0Code(
  params: Auth0CodeExchangeParams,
): Promise<Auth0CodeExchangeResult> {
  const issuer = normalizeIssuer(params.issuerBaseUrl);
  const tokenUrl = `${issuer}/oauth/token`;

  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    let errorMessage = `Auth0 token exchange failed (HTTP ${String(response.status)})`;
    try {
      const errorData: { error?: string; error_description?: string } = await response.json();
      errorMessage = `Auth0 token exchange failed: ${errorData.error ?? 'unknown'} - ${errorData.error_description ?? ''}`;
    } catch {
      // non-JSON body — use generic message
    }
    throw new Error(errorMessage);
  }

  const tokenData: {
    access_token: string;
    id_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
  } = await response.json();

  if (!tokenData.access_token) {
    throw new Error('Auth0 token exchange failed: access_token missing or empty in response');
  }
  const user = decodeAuth0IdTokenClaims(tokenData.id_token);
  return {
    accessToken: tokenData.access_token,
    user,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
  };
}

export async function refreshAuth0Token(
  params: Auth0RefreshParams,
): Promise<Auth0RefreshResult> {
  const issuer = normalizeIssuer(params.issuerBaseUrl);
  const tokenUrl = `${issuer}/oauth/token`;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    let errorMessage = `Auth0 token refresh failed (HTTP ${String(response.status)})`;
    try {
      const errorData: { error?: string; error_description?: string } = await response.json();
      errorMessage = `Auth0 token refresh failed: ${errorData.error ?? 'unknown'} - ${errorData.error_description ?? ''}`;
    } catch {
      // non-JSON body — use generic message
    }
    throw new Error(errorMessage);
  }

  const tokenData: {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
  } = await response.json();

  if (!tokenData.access_token) {
    throw new Error('Auth0 token refresh failed: access_token missing or empty in response');
  }
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
  };
}

export interface UpstreamRefreshDeps {
  issuerBaseUrl: string;
  clientId: string;
  clientSecret: string;
}

/** Props carried in an OAuthProvider token that the refresh callback reads and rewrites. */
export interface RefreshableProps {
  auth0AccessToken: string;
  auth0RefreshToken?: string;
  auth0ExpiresAt?: number;
  [key: string]: unknown;
}

interface TokenExchangeOptions {
  grantType: string;
  props: RefreshableProps;
}

interface TokenExchangeResult {
  newProps?: RefreshableProps;
  accessTokenTTL?: number;
}

/**
 * Builds the OAuthProvider `tokenExchangeCallback`.
 *
 * The MCP server forwards the user's upstream Auth0 token to the backend, so an
 * OAuthProvider token must never outlive it. On the refresh grant the callback
 * mints a fresh upstream token and matches the issued token's TTL to it; on the
 * authorization-code grant it caps the TTL to the upstream token's remaining
 * life. Without a stored refresh token (no `offline_access`) the refresh grant
 * is a no-op and the session ends when the upstream token expires.
 */
export function makeTokenExchangeCallback(
  deps: UpstreamRefreshDeps,
): (options: TokenExchangeOptions) => Promise<TokenExchangeResult | undefined> {
  return async ({ grantType, props }) => {
    if (grantType === 'authorization_code') {
      const ttl = remainingLifetime(props.auth0ExpiresAt);
      return ttl === undefined ? undefined : { accessTokenTTL: ttl };
    }

    if (grantType === 'refresh_token') {
      const refreshToken = props.auth0RefreshToken;
      if (refreshToken === undefined || refreshToken === '') {
        return undefined;
      }
      const refreshed = await refreshAuth0Token({ refreshToken, ...deps });
      const nowSeconds = Math.floor(Date.now() / 1000);
      return {
        newProps: {
          ...props,
          auth0AccessToken: refreshed.accessToken,
          auth0RefreshToken: refreshed.refreshToken ?? refreshToken,
          auth0ExpiresAt: nowSeconds + refreshed.expiresIn,
        },
        accessTokenTTL: refreshed.expiresIn,
      };
    }

    return undefined;
  };
}

function remainingLifetime(expiresAt: number | undefined): number | undefined {
  if (expiresAt === undefined) {
    return undefined;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.max(1, expiresAt - nowSeconds);
}
