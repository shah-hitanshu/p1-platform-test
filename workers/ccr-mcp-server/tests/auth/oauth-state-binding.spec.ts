/**
 * OAuth state-binding tests (MCP server entry point)
 *
 * Drives the default handler's /authorize and /callback endpoints to cover the
 * upstream Auth0 leg: the signed state, the forwarded nonce, and rejection of a
 * forged state or a mismatched id-token nonce.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../../src/types.js';

// The default handler reads the OAuth helper from env, never instantiating the
// provider, so a stub avoids its cloudflare: runtime import under the node pool.
vi.mock('@cloudflare/workers-oauth-provider', () => ({ OAuthProvider: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const SIGNING_SECRET = 'test-state-signing-secret';

const AUTH_REQUEST = {
  responseType: 'code',
  clientId: 'mcp-client',
  redirectUri: 'https://client.example/callback',
  scope: ['openid', 'email'],
  state: 'downstream-client-state',
  codeChallenge: 'cc',
  codeChallengeMethod: 'S256',
};

function makeEnv(overrides: Record<string, unknown> = {}): {
  env: Env;
  completeAuthorization: ReturnType<typeof vi.fn>;
} {
  const completeAuthorization = vi.fn(() => Promise.resolve({ redirectTo: 'https://client.example/callback?code=issued' }));
  const env = {
    ENVIRONMENT: 'test',
    CCR_BACKEND_URL: 'http://localhost:8787',
    MCP_SERVER_NAME: 'mcp',
    MCP_SERVER_VERSION: '0.0.0',
    PUBLIC_ORIGIN: 'https://mcp.example',
    AUTH0_CLIENT_ID: 'cid',
    AUTH0_CLIENT_SECRET: 'csecret',
    AUTH0_ISSUER_BASE_URL: 'https://example.auth0.com',
    AUTH0_AUDIENCE: 'https://api.example.com',
    MCP_STATE_SIGNING_SECRET: SIGNING_SECRET,
    OAUTH_KV: {} as KVNamespace,
    OAUTH_PROVIDER: {
      parseAuthRequest: vi.fn(() => Promise.resolve({ ...AUTH_REQUEST })),
      lookupClient: vi.fn(() => Promise.resolve({ clientId: 'mcp-client' })),
      completeAuthorization,
    },
    ...overrides,
  };
  return { env, completeAuthorization };
}

async function invoke(url: string, env: Env): Promise<Response> {
  const { defaultHandler } = await import('../../src/index.js');
  const handler = defaultHandler.fetch;
  if (handler === undefined) {
    throw new Error('defaultHandler.fetch is undefined');
  }
  return handler(new Request(url), env, {} as ExecutionContext);
}

function idTokenWithNonce(nonce: string | undefined): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims: Record<string, unknown> = { sub: 'auth0|user-1', email: 'user@example.com', name: 'User One' };
  if (nonce !== undefined) {
    claims.nonce = nonce;
  }
  const payload = btoa(JSON.stringify(claims));
  return `${header}.${payload}.sig`;
}

function mockTokenEndpoint(idToken: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      access_token: 'at_abc',
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: 3600,
    }),
  });
}

describe('OAuth authorize endpoint', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('refuses to start the flow when the state-signing secret is unset', async () => {
    const { env } = makeEnv({ MCP_STATE_SIGNING_SECRET: '' });

    const res = await invoke('https://mcp.example/authorize', env);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('server_error');
  });

  it('signs the state and forwards a matching nonce to Auth0', async () => {
    const { verifyAndParseState } = await import('../../src/auth/state-signing.js');
    const { env } = makeEnv();

    const res = await invoke('https://mcp.example/authorize', env);

    expect(res.status).toBe(302);
    const locationHeader = res.headers.get('Location');
    if (locationHeader === null) {
      throw new Error('missing Location header');
    }
    const location = new URL(locationHeader);
    expect(location.hostname).toBe('example.auth0.com');

    const stateParam = location.searchParams.get('state');
    const urlNonce = location.searchParams.get('nonce');
    if (stateParam === null || urlNonce === null) {
      throw new Error('missing state or nonce');
    }
    expect(urlNonce).toMatch(/^[0-9a-f]{32}$/);

    // The state verifies under the server secret and carries the same nonce.
    const decoded = await verifyAndParseState<{ authRequest: { clientId: string }; nonce: string }>(
      stateParam, SIGNING_SECRET,
    );
    expect(decoded?.authRequest.clientId).toBe('mcp-client');
    expect(decoded?.nonce).toBe(urlNonce);

    // The state is signed, not a plain base64 JSON blob.
    expect(() => JSON.parse(atob(stateParam))).toThrow();
  });
});

describe('OAuth callback endpoint', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects a state that fails signature verification without exchanging the code', async () => {
    const { signState } = await import('../../src/auth/state-signing.js');
    const { env, completeAuthorization } = makeEnv();

    const forged = await signState({ authRequest: AUTH_REQUEST, nonce: 'n' }, 'attacker-key');
    const res = await invoke(`https://mcp.example/callback?code=stolen&state=${encodeURIComponent(forged)}`, env);

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(completeAuthorization).not.toHaveBeenCalled();
  });

  it('rejects an unsigned base64 state (the prior format)', async () => {
    const { env } = makeEnv();

    const unsigned = btoa(JSON.stringify({ authRequest: AUTH_REQUEST }));
    const res = await invoke(`https://mcp.example/callback?code=x&state=${encodeURIComponent(unsigned)}`, env);

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects an id token whose nonce does not match the signed state', async () => {
    const { signState } = await import('../../src/auth/state-signing.js');
    const { env, completeAuthorization } = makeEnv();

    const signed = await signState({ authRequest: AUTH_REQUEST, nonce: 'expected-nonce' }, SIGNING_SECRET);
    mockTokenEndpoint(idTokenWithNonce('different-nonce'));

    const res = await invoke(`https://mcp.example/callback?code=valid&state=${encodeURIComponent(signed)}`, env);

    expect(res.status).toBe(400);
    expect(completeAuthorization).not.toHaveBeenCalled();
  });

  it('rejects an id token carrying no nonce when the state carries one', async () => {
    const { signState } = await import('../../src/auth/state-signing.js');
    const { env, completeAuthorization } = makeEnv();

    const signed = await signState({ authRequest: AUTH_REQUEST, nonce: 'expected-nonce' }, SIGNING_SECRET);
    mockTokenEndpoint(idTokenWithNonce(undefined));

    const res = await invoke(`https://mcp.example/callback?code=valid&state=${encodeURIComponent(signed)}`, env);

    expect(res.status).toBe(400);
    expect(completeAuthorization).not.toHaveBeenCalled();
  });

  it('refuses the callback when the signing secret is unset', async () => {
    const { signState } = await import('../../src/auth/state-signing.js');
    const { env, completeAuthorization } = makeEnv({ MCP_STATE_SIGNING_SECRET: '' });

    const signed = await signState({ authRequest: AUTH_REQUEST, nonce: 'n' }, SIGNING_SECRET);
    const res = await invoke(`https://mcp.example/callback?code=x&state=${encodeURIComponent(signed)}`, env);

    expect(res.status).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(completeAuthorization).not.toHaveBeenCalled();
  });

  it('completes authorization for a valid signed state with a matching nonce', async () => {
    const { signState } = await import('../../src/auth/state-signing.js');
    const { env, completeAuthorization } = makeEnv();

    const signed = await signState({ authRequest: AUTH_REQUEST, nonce: 'shared-nonce' }, SIGNING_SECRET);
    mockTokenEndpoint(idTokenWithNonce('shared-nonce'));

    const res = await invoke(`https://mcp.example/callback?code=valid&state=${encodeURIComponent(signed)}`, env);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://client.example/callback?code=issued');
    expect(completeAuthorization).toHaveBeenCalledTimes(1);
    // The authRequest and scope round-trip through sign/verify into completion.
    expect(completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ clientId: 'mcp-client', scope: ['openid', 'email'] }),
      userId: 'auth0|user-1',
      scope: ['openid', 'email'],
    }));
  });
});
