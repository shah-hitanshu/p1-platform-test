/**
 * State-signing tests (MCP server)
 *
 * Covers HMAC-SHA256 signing, constant-time verification, and nonce generation
 * for the OAuth state parameter.
 */

import { describe, it, expect } from 'vitest';

const SECRET = 'test-hmac-secret-value';

describe('signState / verifyAndParseState', () => {
  it('round-trips a signed payload back to the original object', async () => {
    const { signState, verifyAndParseState } = await import('../../src/auth/state-signing.js');
    const data = { authRequest: { clientId: 'c1', scope: ['openid'] }, nonce: 'abc123' };

    const signed = await signState(data, SECRET);
    const parsed = await verifyAndParseState<typeof data>(signed, SECRET);

    expect(parsed).toEqual(data);
  });

  it('returns null when the payload is tampered with', async () => {
    const { signState, verifyAndParseState } = await import('../../src/auth/state-signing.js');
    const signed = await signState({ nonce: 'abc123' }, SECRET);

    const [payload, sig] = signed.split('.');
    const tamperedPayload = btoa(JSON.stringify({ nonce: 'evil' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tampered = `${tamperedPayload}.${sig}`;
    expect(payload).not.toBe(tamperedPayload);

    expect(await verifyAndParseState(tampered, SECRET)).toBeNull();
  });

  it('returns null when verified with a different key', async () => {
    const { signState, verifyAndParseState } = await import('../../src/auth/state-signing.js');
    const signed = await signState({ nonce: 'abc123' }, SECRET);

    expect(await verifyAndParseState(signed, 'a-different-secret')).toBeNull();
  });

  it('returns null for an unsigned (plain base64) state', async () => {
    const { verifyAndParseState } = await import('../../src/auth/state-signing.js');
    const unsigned = btoa(JSON.stringify({ authRequest: { clientId: 'c1' } }));

    expect(await verifyAndParseState(unsigned, SECRET)).toBeNull();
  });

  it('returns null for a malformed state with no signature segment', async () => {
    const { verifyAndParseState } = await import('../../src/auth/state-signing.js');
    expect(await verifyAndParseState('not-a-token', SECRET)).toBeNull();
    expect(await verifyAndParseState('', SECRET)).toBeNull();
  });
});

describe('generateNonce', () => {
  it('returns a 32-character hex string', async () => {
    const { generateNonce } = await import('../../src/auth/state-signing.js');
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns a different value on each call', async () => {
    const { generateNonce } = await import('../../src/auth/state-signing.js');
    expect(generateNonce()).not.toBe(generateNonce());
  });
});
