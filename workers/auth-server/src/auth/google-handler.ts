/**
 * Google OAuth Handler
 *
 * Handles the OAuth authorization flow with Google as the upstream IdP.
 * Provides functions for building authorization URLs, exchanging auth codes
 * for tokens, and decoding ID token claims.
 */

// =============================================================================
// Types
// =============================================================================

export interface GoogleAuthUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
}

export interface GoogleCodeExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleUser {
  sub: string;
  email: string;
  name?: string;
  email_verified?: boolean;
}

export interface GoogleCodeExchangeResult {
  accessToken: string;
  user: GoogleUser;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Construct a Google OAuth authorization URL with correct params.
 */
export function getGoogleAuthorizationUrl(params: GoogleAuthUrlParams): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('state', params.state);
  return url.toString();
}

/**
 * Decode the payload of a Google ID token (JWT).
 * No signature validation is needed since we receive it directly
 * from Google's token endpoint over HTTPS.
 */
export function decodeIdTokenClaims(idToken: string): GoogleUser {
  const parts = idToken.split('.');
  if (parts.length < 3) {
    throw new Error('Invalid ID token: expected at least 3 parts');
  }

  const payload = parts[1];
  // Handle base64url encoding (replace - with +, _ with /)
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const decoded = atob(padded);
  const claims = JSON.parse(decoded) as GoogleUser;

  return claims;
}

/**
 * Exchange a Google auth code for tokens and user info.
 */
export async function exchangeGoogleCode(
  params: GoogleCodeExchangeParams,
): Promise<GoogleCodeExchangeResult> {
  const tokenUrl = 'https://oauth2.googleapis.com/token';

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
    let errorMessage = `Google token exchange failed (HTTP ${String(response.status)})`;
    try {
      const errorData: { error?: string; error_description?: string } = await response.json();
      errorMessage = `Google token exchange failed: ${errorData.error ?? 'unknown'} - ${errorData.error_description ?? ''}`;
    } catch {
      // Response body was not valid JSON -- use the generic message
    }
    throw new Error(errorMessage);
  }

  const tokenData: {
    access_token: string;
    id_token: string;
    token_type: string;
    expires_in: number;
  } = await response.json();

  const user = decodeIdTokenClaims(tokenData.id_token);

  return {
    accessToken: tokenData.access_token,
    user,
  };
}
