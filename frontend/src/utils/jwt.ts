/**
 * JWT Utility
 *
 * Decode JWT payloads without verification. Used for extracting display
 * information (user name, email, expiry) from provider-issued tokens.
 * Actual token validation is performed by the backend.
 */

/**
 * Decode the payload segment of a JWT without signature verification.
 * Returns the parsed payload object, or null if the token is malformed.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // Convert base64url to standard base64
    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    // Pad to multiple of 4
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

    const jsonStr = atob(padded);
    const payload = JSON.parse(jsonStr) as Record<string, unknown>;

    if (typeof payload !== 'object' || payload === null) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Check whether a JWT's `exp` claim indicates the token has expired.
 * Returns true if the token is expired, has no exp claim, or is invalid.
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return true;

  const exp = payload.exp;
  if (typeof exp !== 'number') return true;

  // Current time in seconds
  const now = Math.floor(Date.now() / 1000);

  return exp <= now;
}
