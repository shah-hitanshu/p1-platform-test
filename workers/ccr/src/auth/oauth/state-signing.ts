/**
 * HMAC-SHA256 State Signing for OAuth flows
 *
 * Uses jose's CompactSign/compactVerify for HMAC-SHA256 signing and
 * constant-time verification of the OAuth state parameter.
 */

import { CompactSign, compactVerify } from 'jose';

export const DEFAULT_STATE_TTL_SECONDS = 600;

export async function signState(
  data: object,
  hmacKey: string,
  ttlSeconds: number = DEFAULT_STATE_TTL_SECONDS,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const secret = new TextEncoder().encode(hmacKey);
  return new CompactSign(new TextEncoder().encode(JSON.stringify({ ...data, exp })))
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secret);
}

export async function verifyAndParseState<T>(signedState: string, hmacKey: string): Promise<T | null> {
  try {
    const secret = new TextEncoder().encode(hmacKey);
    const { payload } = await compactVerify(signedState, secret);
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}
