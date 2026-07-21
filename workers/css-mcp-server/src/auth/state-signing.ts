/**
 * HMAC-SHA256 signing and verification for the OAuth state parameter.
 *
 * The signed state carries the pending authorization request and a one-time
 * nonce across the Auth0 redirect. Verification on the callback rejects any
 * state this server did not issue.
 */

import { CompactSign, compactVerify } from 'jose';

/** A random 128-bit nonce as a lowercase hex string. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Sign an arbitrary object into a compact JWS token. */
export async function signState(data: object, hmacKey: string): Promise<string> {
  const secret = new TextEncoder().encode(hmacKey);
  return new CompactSign(new TextEncoder().encode(JSON.stringify(data)))
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secret);
}

/** Verify a signed-state token and parse its payload, or null when invalid. */
export async function verifyAndParseState<T>(signedState: string, hmacKey: string): Promise<T | null> {
  try {
    const secret = new TextEncoder().encode(hmacKey);
    const { payload } = await compactVerify(signedState, secret);
    return JSON.parse(new TextDecoder().decode(payload)) as T;
  } catch {
    return null;
  }
}
