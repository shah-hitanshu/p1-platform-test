/**
 * Callback Security Integration Tests
 *
 * Validates that the /callback endpoint correctly rejects:
 * (a) tampered state parameters (HMAC signature invalid)
 * (b) redirect_uri that is no longer allowed after /authorize was called
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SELF, fetchMock } from 'cloudflare:test';

// Helper: encode a minimal JWT payload for id_token (header.payload.sig — not verified here)
function makeIdToken(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(JSON.stringify(claims))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${payload}.fakesig`;
}

// Helper: perform a valid /authorize request and return the signed state string
// that the Worker passes to Google.
async function getSignedStateFromAuthorize(redirectUri: string): Promise<string> {
  const authorizeUrl = new URL('http://localhost/authorize');
  authorizeUrl.searchParams.set('client_id', 'test-site-123');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  const authorizeRes = await SELF.fetch(authorizeUrl.toString(), { redirect: 'manual' });
  if (authorizeRes.status !== 302) {
    throw new Error(`Expected 302 from /authorize but got ${String(authorizeRes.status)}`);
  }
  const googleRedirect = new URL(authorizeRes.headers.get('Location') ?? '');
  const state = googleRedirect.searchParams.get('state') ?? '';
  if (!state) throw new Error('No state in Google redirect');
  return state;
}

describe('/callback security: tampered state', () => {
  afterEach(() => {
    try { fetchMock.deactivate(); } catch { /* already inactive */ }
  });

  it('returns 400 when state signature is stripped (bare base64 payload)', async () => {
    // Build a valid-looking unsigned state (old format — no HMAC signature)
    const rawPayload = btoa(JSON.stringify({
      authRequest: {
        responseType: 'code',
        clientId: 'test-site-123',
        redirectUri: 'http://localhost:3000/callback',
        scope: ['openid', 'email', 'profile'],
        state: 'random-state',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
      },
    }));

    const callbackUrl = new URL('http://localhost/callback');
    callbackUrl.searchParams.set('code', 'fake-code');
    callbackUrl.searchParams.set('state', rawPayload);

    const res = await SELF.fetch(callbackUrl.toString(), { redirect: 'manual' });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Invalid or tampered state parameter');
  });

  it('returns 400 when state signature is corrupted', async () => {
    // Get a valid signed state from /authorize, then corrupt the signature
    const validState = await getSignedStateFromAuthorize('http://localhost:3000/callback');
    const dotIndex = validState.lastIndexOf('.');
    const payload = validState.substring(0, dotIndex);
    const corruptedSig = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const tamperedState = `${payload}.${corruptedSig}`;

    const callbackUrl = new URL('http://localhost/callback');
    callbackUrl.searchParams.set('code', 'fake-code');
    callbackUrl.searchParams.set('state', tamperedState);

    const res = await SELF.fetch(callbackUrl.toString(), { redirect: 'manual' });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Invalid or tampered state parameter');
  });

  it('returns 400 when state payload is modified after signing', async () => {
    // Get a valid signed state, decode the payload, mutate clientId, re-encode,
    // but keep the original (now invalid) signature.
    const validState = await getSignedStateFromAuthorize('http://localhost:3000/callback');
    const dotIndex = validState.lastIndexOf('.');
    const originalPayload = validState.substring(0, dotIndex);
    const originalSig = validState.substring(dotIndex + 1);

    // Modify the payload: change clientId to an attacker-controlled value
    const decoded = JSON.parse(atob(originalPayload)) as {
      authRequest: { clientId: string };
    };
    decoded.authRequest.clientId = 'attacker-site';
    const tamperedPayload = btoa(JSON.stringify(decoded));
    const tamperedState = `${tamperedPayload}.${originalSig}`;

    const callbackUrl = new URL('http://localhost/callback');
    callbackUrl.searchParams.set('code', 'fake-code');
    callbackUrl.searchParams.set('state', tamperedState);

    const res = await SELF.fetch(callbackUrl.toString(), { redirect: 'manual' });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Invalid or tampered state parameter');
  });

  it('returns 400 when state is entirely missing the dot separator', async () => {
    const callbackUrl = new URL('http://localhost/callback');
    callbackUrl.searchParams.set('code', 'fake-code');
    callbackUrl.searchParams.set('state', 'nodotsinhere');

    const res = await SELF.fetch(callbackUrl.toString(), { redirect: 'manual' });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Invalid or tampered state parameter');
  });
});

describe('/callback security: redirect_uri re-validation', () => {
  afterEach(() => {
    try { fetchMock.deactivate(); } catch { /* already inactive */ }
  });

  it('returns 400 when state carries a redirect_uri not in allowedOrigins', async () => {
    // The CSS_BACKEND stub only allows: http://localhost:3000 and *-testsite.pantheonsite.io
    // We need a signed state that contains a disallowed redirect_uri.
    //
    // Strategy: build a signed state manually using the same HMAC key that the
    // Worker uses (COOKIE_ENCRYPTION_KEY = 'test-cookie-encryption-key-32chars!!'
    // as configured in vitest.integration.config.ts bindings).
    //
    // Web Crypto is available in the Vitest Cloudflare Workers pool, so we can
    // call crypto.subtle directly in the test.
    const hmacKey = 'test-cookie-encryption-key-32chars!!';
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(hmacKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const statePayload = {
      authRequest: {
        responseType: 'code',
        clientId: 'test-site-123',
        // This URI was never allowed by CSS_BACKEND — simulates a site config change
        redirectUri: 'https://evil.example.com/callback',
        scope: ['openid', 'email', 'profile'],
        state: 'csrf-token',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
      },
    };
    const payload = btoa(JSON.stringify(statePayload));
    const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(payload));
    const sigBase64url = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const signedState = `${payload}.${sigBase64url}`;

    const callbackUrl = new URL('http://localhost/callback');
    callbackUrl.searchParams.set('code', 'fake-code');
    callbackUrl.searchParams.set('state', signedState);

    const res = await SELF.fetch(callbackUrl.toString(), { redirect: 'manual' });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Redirect URI no longer authorized for this client');
  });

  it('succeeds (302) for a valid signed state with an allowed redirect_uri', async () => {
    // Full happy-path sanity check: valid signed state + mocked Google → 302
    const signedState = await getSignedStateFromAuthorize('http://localhost:3000/callback');

    const idToken = makeIdToken({
      sub: 'google-sub-sec-test',
      email: 'sec-test@example.com',
      name: 'Security Test User',
    });
    fetchMock.activate();
    fetchMock
      .get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({ access_token: 'goog-access-sec', id_token: idToken }), {
        headers: { 'Content-Type': 'application/json' },
      });

    const callbackUrl = new URL('http://localhost/callback');
    callbackUrl.searchParams.set('code', 'fake-code-sec');
    callbackUrl.searchParams.set('state', signedState);

    const res = await SELF.fetch(callbackUrl.toString(), { redirect: 'manual' });
    fetchMock.deactivate();

    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('http://localhost:3000/callback');
  });
});
