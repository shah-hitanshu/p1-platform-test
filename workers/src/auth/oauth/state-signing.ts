/**
 * HMAC-SHA256 State Signing for OAuth flows
 *
 * Uses jose's CompactSign/compactVerify for HMAC-SHA256 signing and
 * constant-time verification of the OAuth state parameter.
 */

import { CompactSign, compactVerify } from 'jose';

export async function signState(data: object, hmacKey: string): Promise<string> {
  const secret = new TextEncoder().encode(hmacKey);
  return new CompactSign(new TextEncoder().encode(JSON.stringify(data)))
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secret);
}

export async function verifyAndParseState<T>(signedState: string, hmacKey: string): Promise<T | null> {
  try {
    const secret = new TextEncoder().encode(hmacKey);
    const { payload } = await compactVerify(signedState, secret);
    return JSON.parse(new TextDecoder().decode(payload)) as T;
  } catch {
    return null;
  }
}
