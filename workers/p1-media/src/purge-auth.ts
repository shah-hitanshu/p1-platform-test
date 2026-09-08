/**
 * Operator-token gate for the hard-purge endpoint. This is the entire security
 * boundary — there is no CCR check behind it — so it fails closed and compares in
 * constant time.
 */

import type { Env } from './types';

export const PURGE_TOKEN_HEADER = 'X-Purge-Token';

/**
 * Compares SHA-256 digests, not raw strings: digests are fixed-length, so the
 * comparison leaks neither the secret's length nor a matching prefix. The loop
 * XOR-accumulates over all 32 bytes with no early return — a `===` or a short-circuit
 * here is exactly the bug this module exists to prevent. (Workers' own
 * crypto.subtle.timingSafeEqual is avoided because it throws on unequal input lengths,
 * reintroducing a length oracle.)
 */
export async function tokensMatch(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Fail closed: an unset or blank PURGE_ADMIN_TOKEN never matches any presented value —
 * 'unconfigured' (not 'denied') so the handler can answer 503 instead of 401 and an
 * operator sees "misconfigured" rather than "wrong token".
 */
export async function authorizePurge(
  request: Request,
  env: Env,
): Promise<'ok' | 'unconfigured' | 'denied'> {
  const expected = env.PURGE_ADMIN_TOKEN;
  if (expected === undefined || expected.trim() === '') return 'unconfigured';

  const presented = request.headers.get(PURGE_TOKEN_HEADER);
  if (presented === null || presented === '') return 'denied';

  return (await tokensMatch(presented, expected)) ? 'ok' : 'denied';
}
