/**
 * Auth Server Integration Tests (Miniflare / @cloudflare/vitest-pool-workers)
 *
 * Tests the actual Worker behavior using the Cloudflare runtime.
 * CSS_BACKEND service binding is stubbed via vitest.integration.config.ts.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SELF, fetchMock, env } from 'cloudflare:test';

// fetchMock intercepts outbound fetch calls made by the Worker (e.g., to Google OAuth).
// We activate it only in tests that need it and deactivate after each test.

// Helper: encode a minimal JWT payload for id_token (header.payload.sig — not verified here)
function makeIdToken(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${header}.${payload}.fakesig`;
}

describe('GET /health', () => {
  it('returns 200', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect(response.status).toBe(200);
    const rawBody: unknown = await response.json();
    const body = rawBody as { status: string };
    expect(body.status).toBe('healthy');
  });
});

describe('GET /authorize', () => {
  it('returns 400 for unknown site (client_id not found)', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'unknown-site-id');
    url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(400);
  });

  it('returns 400 for disallowed redirect_uri', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'https://evil.com/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(400);
  });

  it('redirects to Google for valid client and redirect_uri', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    // Should redirect to Google
    expect(response.status).toBe(302);
    const location = response.headers.get('Location') ?? '';
    expect(location).toContain('accounts.google.com');
  });

  // T2: second authorize request for same site with a new redirect_uri accumulates URIs
  // (upsertClient path: existing client → oauthHelpers.updateClient() adds new URI)
  it('T2: second authorize with new redirect_uri is accepted (redirect URI accumulation)', async () => {
    // Pre-seed OAUTH_KV with an existing client for test-site-123 that has only
    // http://localhost:3000/callback registered. The second request will use
    // https://live-testsite.pantheonsite.io/callback (new, but allowed by wildcard).
    // upsertClient() must call oauthHelpers.updateClient() to add the new URI.
    const existingClient = {
      clientId: 'test-site-123',
      redirectUris: ['http://localhost:3000/callback'],
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      registrationDate: Math.floor(Date.now() / 1000),
    };
    // env from cloudflare:test is typed as ProvidedEnv; cast to access KV namespace.
    const oauthKv = (env as { OAUTH_KV: KVNamespace }).OAUTH_KV;
    await oauthKv.put('client:test-site-123', JSON.stringify(existingClient));

    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'https://live-testsite.pantheonsite.io/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    // The new redirect_uri matches the wildcard *-testsite.pantheonsite.io (https, S256 PKCE)
    // so it should be accepted (302 to Google), not rejected (400).
    expect(response.status).toBe(302);
    const location = response.headers.get('Location') ?? '';
    expect(location).toContain('accounts.google.com');
  });

  it('SECURITY: rejects wildcard origin for http scheme', async () => {
    // *-testsite.pantheonsite.io only allows https — not http
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'http://live-testsite.pantheonsite.io/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(400);
  });

  it('accepts valid wildcard Pantheon branch URL', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'https://live-testsite.pantheonsite.io/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(302);
    const location = response.headers.get('Location') ?? '';
    expect(location).toContain('accounts.google.com');
  });

  it('SECURITY: rejects missing PKCE (plain method rejected)', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'some-plain-challenge');
    url.searchParams.set('code_challenge_method', 'plain');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    // OAuthProvider rejects plain PKCE when allowPlainPKCE: false
    expect(response.status).not.toBe(302);
  });
});

describe('POST /internal/token/validate', () => {
  it('returns 401 without X-Internal-Secret', async () => {
    const response = await SELF.fetch('http://localhost/internal/token/validate', {
      method: 'POST',
      body: JSON.stringify({ token: 'some-token' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(401);
  });

  // T7d: wrong-secret → 403 in miniflare integration (Finding #4)
  it('T7d: returns 403 with wrong X-Internal-Secret', async () => {
    const response = await SELF.fetch('http://localhost/internal/token/validate', {
      method: 'POST',
      body: JSON.stringify({ token: 'some-token' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': 'wrong-secret-value',
      },
    });
    expect(response.status).toBe(403);
  });

  it('returns { active: false } for invalid token', async () => {
    const response = await SELF.fetch('http://localhost/internal/token/validate', {
      method: 'POST',
      body: JSON.stringify({ token: 'invalid-token-xyz' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': 'test-internal-secret',
      },
    });
    expect(response.status).toBe(200);
    const rawBody: unknown = await response.json();
    const body = rawBody as { active: boolean };
    expect(body.active).toBe(false);
  });

  // T3: valid token → active:true via miniflare (full authorize→callback flow with mocked Google)
  it('T3: returns { active: true } for a valid token obtained from the authorize+callback flow', async () => {
    // Step 1: Start the authorize flow to get the state parameter that Google sends back.
    const authorizeUrl = new URL('http://localhost/authorize');
    authorizeUrl.searchParams.set('client_id', 'test-site-123');
    authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    const authorizeRes = await SELF.fetch(authorizeUrl.toString(), { redirect: 'manual' });
    expect(authorizeRes.status).toBe(302);

    // Extract the state parameter from the redirect to Google
    const googleRedirect = new URL(authorizeRes.headers.get('Location') ?? '');
    const encodedState = googleRedirect.searchParams.get('state') ?? '';
    expect(encodedState).not.toBe('');

    // Step 2: Mock the Google token endpoint for the callback.
    // The Worker calls https://oauth2.googleapis.com/token during /callback processing.
    const googleUserId = 'google-sub-t3-test';
    const idToken = makeIdToken({
      sub: googleUserId,
      email: 't3-user@example.com',
      name: 'T3 Test User',
    });
    fetchMock.activate();
    fetchMock
      .get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({ access_token: 'goog-access-t3', id_token: idToken }), {
        headers: { 'Content-Type': 'application/json' },
      });

    // Step 3: Simulate the Google callback — use a fake code; Worker extracts state from query param.
    // The Worker calls exchangeGoogleCode which POSTs to googleapis.com/token (mocked above).
    const callbackUrl = new URL('http://localhost/callback');
    callbackUrl.searchParams.set('code', 'fake-google-code-t3');
    callbackUrl.searchParams.set('state', encodedState);
    const callbackRes = await SELF.fetch(callbackUrl.toString(), { redirect: 'manual' });
    fetchMock.deactivate();

    // The callback should redirect back to the original redirect_uri with a code
    expect(callbackRes.status).toBe(302);
    const callbackLocation = callbackRes.headers.get('Location') ?? '';
    expect(callbackLocation).toContain('http://localhost:3000/callback');

    // Extract the CSS auth code from the redirect
    const redirectedUrl = new URL(callbackLocation);
    const cssAuthCode = redirectedUrl.searchParams.get('code');
    expect(cssAuthCode).not.toBeNull();
    expect(cssAuthCode).not.toBe('');

    // Step 4: Exchange the CSS auth code for an access token at /token endpoint.
    // The code_verifier for E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM is 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const tokenRes = await SELF.fetch('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: cssAuthCode ?? '',
        redirect_uri: 'http://localhost:3000/callback',
        client_id: 'test-site-123',
        code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const rawTokenBody: unknown = await tokenRes.json();
    const tokenBody = rawTokenBody as { access_token: string };
    const accessToken = tokenBody.access_token;
    expect(accessToken).toBeTruthy();

    // Step 5: Validate the token via /internal/token/validate — should return active:true
    const validateRes = await SELF.fetch('http://localhost/internal/token/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': 'test-internal-secret',
      },
      body: JSON.stringify({ token: accessToken }),
    });
    expect(validateRes.status).toBe(200);
    const rawValidateBody: unknown = await validateRes.json();
    const validateBody = rawValidateBody as { active: boolean; sub: string; props: { email: string; siteId: string } };
    expect(validateBody.active).toBe(true);
    expect(validateBody.sub).toBe(googleUserId);
    expect(validateBody.props.email).toBe('t3-user@example.com');
    expect(validateBody.props.siteId).toBe('test-site-123');
  });

  afterEach(() => {
    try { fetchMock.deactivate(); } catch { /* already inactive */ }
  });
});
