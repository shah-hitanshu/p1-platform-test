/**
 * Auth0 OAuth Handler
 *
 * Handles the OAuth authorization flow with Auth0 as the upstream IdP.
 * Provides functions for building authorization URLs, exchanging auth codes
 * for tokens, and decoding ID token claims.
 */

import { decodeJwt } from 'jose';

// =============================================================================
// Types
// =============================================================================

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
  nonce?: string;
}

export interface Auth0CodeExchangeResult {
  accessToken: string;
  user: Auth0User;
}

// =============================================================================
// Functions
// =============================================================================

function normalizeIssuer(issuerBaseUrl: string): string {
  let s = issuerBaseUrl;
  while (s.endsWith('/')) {
    s = s.slice(0, -1);
  }
  return s;
}

/**
 * Construct an Auth0 authorization URL with correct params.
 */
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
 * Decode the payload of an Auth0 ID token (JWT).
 * No signature validation is needed since we receive it directly
 * from Auth0's token endpoint over HTTPS.
 */
export function decodeAuth0IdTokenClaims(idToken: string): Auth0User {
  const claims = decodeJwt(idToken) as unknown as Auth0User;

  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new Error('Invalid ID token: missing sub claim');
  }
  if (typeof claims.email !== 'string' || claims.email === '') {
    throw new Error('Invalid ID token: missing email claim');
  }

  return claims;
}

/**
 * Exchange an Auth0 auth code for tokens and user info.
 */
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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    let errorMessage = `Auth0 token exchange failed (HTTP ${String(response.status)})`;
    try {
      const errorData: { error?: string; error_description?: string } = await response.json();
      errorMessage = `Auth0 token exchange failed: ${errorData.error ?? 'unknown'} - ${errorData.error_description ?? ''}`;
    } catch {
      // Response body was not valid JSON
    }
    throw new Error(errorMessage);
  }

  const tokenData: {
    access_token: string;
    id_token: string;
    token_type: string;
    expires_in: number;
  } = await response.json();

  const user = decodeAuth0IdTokenClaims(tokenData.id_token);

  return {
    accessToken: tokenData.access_token,
    user,
  };
}
