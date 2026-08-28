import { describe, it, expect } from 'vitest';
import { CompactSign } from 'jose';
import { signState, verifyAndParseState } from '../../../src/auth/oauth/state-signing.js';

const HMAC_KEY = 'test-secret-at-least-32-characters-long';

/** signState() always sets a numeric exp, so a raw JWS is needed to exercise payloads it can't produce. */
async function signRawPayload(payload: object, hmacKey: string): Promise<string> {
  const secret = new TextEncoder().encode(hmacKey);
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secret);
}

describe('signState / verifyAndParseState', () => {
  it('round-trips the original data', async () => {
    const signed = await signState({ txId: 'tx-1', nonce: 'abc' }, HMAC_KEY);
    const parsed = await verifyAndParseState<{ txId: string; nonce: string }>(signed, HMAC_KEY);
    expect(parsed?.txId).toBe('tx-1');
    expect(parsed?.nonce).toBe('abc');
  });

  it('rejects a state verified with the wrong key', async () => {
    const signed = await signState({ txId: 'tx-1' }, HMAC_KEY);
    const parsed = await verifyAndParseState(signed, 'a-completely-different-secret-value');
    expect(parsed).toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const signed = await signState({ txId: 'tx-1' }, HMAC_KEY);
    // Flip a character in the middle of the token rather than the last one:
    // the final base64url character of a segment can have "don't care" bits,
    // so swapping it doesn't reliably change the decoded bytes.
    const mid = Math.floor(signed.length / 2);
    const replacement = signed[mid] === 'a' ? 'b' : 'a';
    const tampered = signed.slice(0, mid) + replacement + signed.slice(mid + 1);
    const parsed = await verifyAndParseState(tampered, HMAC_KEY);
    expect(parsed).toBeNull();
  });

  it('rejects a state that has expired', async () => {
    const signed = await signState({ txId: 'tx-1' }, HMAC_KEY, -1);
    const parsed = await verifyAndParseState(signed, HMAC_KEY);
    expect(parsed).toBeNull();
  });

  it('accepts a state within a custom TTL', async () => {
    const signed = await signState({ txId: 'tx-1' }, HMAC_KEY, 3600);
    const parsed = await verifyAndParseState<{ txId: string }>(signed, HMAC_KEY);
    expect(parsed?.txId).toBe('tx-1');
  });

  it('uses the default TTL (~600s) when none is given', async () => {
    const before = Math.floor(Date.now() / 1000);
    const signed = await signState({ txId: 'tx-1' }, HMAC_KEY);
    const parsed = await verifyAndParseState<{ txId: string; exp: number }>(signed, HMAC_KEY);
    expect(parsed?.exp).toBeGreaterThanOrEqual(before + 599);
    expect(parsed?.exp).toBeLessThanOrEqual(before + 601);
  });

  it('returns null for garbage input', async () => {
    const parsed = await verifyAndParseState('not-a-valid-jws', HMAC_KEY);
    expect(parsed).toBeNull();
  });

  it('rejects a state with no exp claim', async () => {
    const signed = await signRawPayload({ txId: 'tx-1' }, HMAC_KEY);
    const parsed = await verifyAndParseState(signed, HMAC_KEY);
    expect(parsed).toBeNull();
  });

  it('rejects a state with a non-numeric exp claim', async () => {
    const signed = await signRawPayload({ txId: 'tx-1', exp: 'soon' }, HMAC_KEY);
    const parsed = await verifyAndParseState(signed, HMAC_KEY);
    expect(parsed).toBeNull();
  });
});
