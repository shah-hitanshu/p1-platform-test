/**
 * Logout state round trip: POST /broker/logout → the state it signs →
 * GET /broker/logout/complete.
 *
 * broker-routes.spec.ts mocks state-signing, so the two routes are joined there
 * only by a hand-written object of the right shape — rename a field on either
 * side and every test in that file still passes while production breaks. This
 * file uses the real signer so the contract between them is actually checked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/types/auth.js';
import type { Env } from '../../../src/index.js';

vi.mock('../../../src/middleware/authentication.js', () => ({
  authenticate: vi.fn(),
}));

vi.mock('../../../src/services/site-service.js', () => ({
  getCachedSiteAllowedOrigins: vi.fn(),
}));

const INTERNAL_SECRET = 'test-secret-at-least-32-characters-long';
const SITE_ORIGIN = 'https://mysite.example.com';
const RETURN_TO = `${SITE_ORIGIN}/goodbye`;

/** What the nonce-claim RPC does. Tests swap this to drive the failure paths. */
let nonceClaim: () => Promise<Response> = async () =>
  new Response(JSON.stringify({ claimed: true }), {
    headers: { 'Content-Type': 'application/json' },
  });

function createMockBrokerTx(): DurableObjectNamespace {
  return {
    idFromName: vi.fn((name: string) => ({ toString: () => name }) as DurableObjectId),
    get: vi.fn(
      () =>
        ({
          fetch: vi.fn(() => nonceClaim()),
          id: {} as DurableObjectId,
        }) as unknown as DurableObjectStub,
    ),
    idFromString: vi.fn(),
    newUniqueId: vi.fn(),
  } as unknown as DurableObjectNamespace;
}

function createEnv(): Env {
  return {
    BROKER_TX: createMockBrokerTx(),
    AUTH0_CLIENT_ID: 'test-client-id',
    AUTH0_CLIENT_SECRET: 'test-client-secret',
    AUTH0_ISSUER_BASE_URL: 'https://example.auth0.com',
    MAS_GCP_SERVICE_ACCOUNT_KEY: '{}',
    GCP_KMS_KEY_RESOURCE: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
    BROKER_JWT_AUDIENCE: 'css-api',
    INTERNAL_SECRET,
    PUBLIC_ORIGIN: 'https://css.example.com',
  } as unknown as Env;
}

function sitePrincipal(): AuthenticatedPrincipal {
  return {
    id: 'auth0|user-1',
    type: 'user',
    authProvider: 'broker',
    pantheonSiteRoles: {},
    siteId: 'site-123',
    tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  };
}

/** Pulls the `state` the mint route signed back out of the Auth0 logout URL. */
function stateFromLogoutUrl(logoutUrl: string): string {
  const auth0Url = new URL(logoutUrl);
  const callback = auth0Url.searchParams.get('returnTo');
  expect(callback).not.toBeNull();
  const state = new URL(callback!).searchParams.get('state');
  expect(state).not.toBeNull();
  return state!;
}

async function mintLogout(body?: Record<string, unknown>): Promise<string> {
  const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
  const request = new Request('https://css.example.com/broker/logout', {
    method: 'POST',
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });

  const response = await handleBrokerRoutes(request, createEnv(), '/broker/logout');
  expect(response?.status).toBe(200);
  const parsed: { logoutUrl: string } = await response!.json();
  return parsed.logoutUrl;
}

async function completeLogout(state: string): Promise<Response> {
  const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
  const request = new Request(
    `https://css.example.com/broker/logout/complete?state=${encodeURIComponent(state)}`,
  );
  const response = await handleBrokerRoutes(request, createEnv(), '/broker/logout/complete');
  expect(response).not.toBeNull();
  return response!;
}

describe('logout state round trip', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    nonceClaim = async () =>
      new Response(JSON.stringify({ claimed: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    const { authenticate } = await import('../../../src/middleware/authentication.js');
    const siteService = await import('../../../src/services/site-service.js');
    vi.mocked(authenticate).mockResolvedValue(sitePrincipal());
    vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([SITE_ORIGIN]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carries an authorized returnTo from the mint route through to the redirect', async () => {
    const logoutUrl = await mintLogout({ returnTo: RETURN_TO });

    const auth0Url = new URL(logoutUrl);
    expect(auth0Url.origin + auth0Url.pathname).toBe('https://example.auth0.com/v2/logout');
    expect(auth0Url.searchParams.get('client_id')).toBe('test-client-id');
    expect(auth0Url.searchParams.get('returnTo')).toBe(
      `https://css.example.com/broker/logout/complete?state=${encodeURIComponent(stateFromLogoutUrl(logoutUrl))}`,
    );

    const response = await completeLogout(stateFromLogoutUrl(logoutUrl));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(RETURN_TO);
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('shows the logged-out page when the state carries no returnTo', async () => {
    const logoutUrl = await mintLogout();

    const response = await completeLogout(stateFromLogoutUrl(logoutUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toContain('Logged out');
  });

  it('does not sign a returnTo the site has not registered', async () => {
    const siteService = await import('../../../src/services/site-service.js');
    vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([SITE_ORIGIN]);

    const logoutUrl = await mintLogout({ returnTo: 'https://evil.example.com/steal' });

    // The rejection has to be invisible downstream too, not just absent from the
    // mint response — so complete the round trip rather than inspecting the state.
    const response = await completeLogout(stateFromLogoutUrl(logoutUrl));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Logged out');
  });

  it('replaying a completed logout shows the page instead of redirecting again', async () => {
    const logoutUrl = await mintLogout({ returnTo: RETURN_TO });
    const state = stateFromLogoutUrl(logoutUrl);

    const first = await completeLogout(state);
    expect(first.status).toBe(302);

    nonceClaim = async () =>
      new Response(JSON.stringify({ claimed: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    const replay = await completeLogout(state);

    expect(replay.status).toBe(200);
    expect(replay.headers.get('Location')).toBeNull();
    expect(await replay.text()).toContain('Logged out');
  });

  // Auth0 has already ended the session by the time this route runs, so a claim
  // that cannot be read must cost the redirect, not turn into a JSON error page.
  it.each([
    ['the DO returns an error status', async () => new Response('boom', { status: 500 })],
    [
      'the DO returns 200 with an unparseable body',
      async () =>
        new Response('<html>not json</html>', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ],
    ['the DO is unreachable', async () => Promise.reject(new Error('no instance'))],
  ])('shows the page rather than an error when %s', async (_label, claim) => {
    const logoutUrl = await mintLogout({ returnTo: RETURN_TO });

    nonceClaim = claim;
    const response = await completeLogout(stateFromLogoutUrl(logoutUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Location')).toBeNull();
    expect(await response.text()).toContain('Logged out');
  });
});
