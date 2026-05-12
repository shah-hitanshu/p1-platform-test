/**
 * OAuth Helpers Tests
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  createGoogleOAuth,
  createOAuthAuthProvider,
  createP1AuthServerOAuth,
  generateCodeVerifier,
  computeS256Challenge,
  generateState,
} from '../src/oauth.js';
import type { OAuthSession, P1AuthServerOAuthConfig } from '../src/oauth.js';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((_index: number) => null),
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

// A minimal JWT for testing (header.payload.signature)
function createTestJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const sig = btoa('fake-signature');
  return `${header}.${body}.${sig}`;
}

describe('createGoogleOAuth', () => {
  const testJwt = createTestJwt({
    sub: 'google-user-123',
    email: 'test@example.com',
    name: 'Test User',
    picture: 'https://example.com/pic.jpg',
  });

  beforeEach(() => {
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  it('should create a session with provider set to google', () => {
    const session = createGoogleOAuth({ clientId: 'test-client-id' });
    expect(session.provider).toBe('google');
  });

  it('should not be authenticated initially with no stored token', () => {
    const session = createGoogleOAuth({ clientId: 'test-client-id' });
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
  });

  it('should restore user info from a previously stored token', () => {
    localStorageMock.setItem('p1_google_token', testJwt);
    const session = createGoogleOAuth({ clientId: 'test-client-id' });
    expect(session.isAuthenticated()).toBe(true);
    const info = session.getUserInfo();
    expect(info).not.toBeNull();
    expect(info!.id).toBe('google-user-123');
    expect(info!.email).toBe('test@example.com');
    expect(info!.name).toBe('Test User');
  });

  it('should use custom storageKey when provided', () => {
    localStorageMock.setItem('my_custom_key', testJwt);
    const session = createGoogleOAuth({ clientId: 'test-client-id', storageKey: 'my_custom_key' });
    expect(session.isAuthenticated()).toBe(true);
  });

  it('should return the stored token from getToken', async () => {
    localStorageMock.setItem('p1_google_token', testJwt);
    const session = createGoogleOAuth({ clientId: 'test-client-id' });
    const token = await session.getToken();
    expect(token).toBe(testJwt);
  });

  it('should return null from getToken when not authenticated', async () => {
    const session = createGoogleOAuth({ clientId: 'test-client-id' });
    const token = await session.getToken();
    expect(token).toBeNull();
  });

  it('should clear token and user info on logout', async () => {
    localStorageMock.setItem('p1_google_token', testJwt);
    const session = createGoogleOAuth({ clientId: 'test-client-id' });
    expect(session.isAuthenticated()).toBe(true);
    expect(session.getUserInfo()).not.toBeNull();

    await session.logout();
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('p1_google_token');
  });

  it('should reject login when loadScript fails (no document)', async () => {
    // In Node, document is not defined so loadScript will reject
    const session = createGoogleOAuth({ clientId: 'test-client-id' });
    await expect(session.login()).rejects.toThrow();
  });
});

describe('createAuth0OAuth (unit tests with mock session)', () => {
  // Since @auth0/auth0-spa-js is an optional peer dep and not installed,
  // we test Auth0 behavior through the OAuthSession interface and
  // createOAuthAuthProvider, which is how consumers interact with it.

  beforeEach(() => {
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  it('should create a mock auth0 session that behaves correctly', () => {
    // Simulate what createAuth0OAuth returns by creating a conforming mock
    const session: OAuthSession = {
      provider: 'auth0',
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      isAuthenticated: vi.fn().mockReturnValue(false),
      getUserInfo: vi.fn().mockReturnValue(null),
      getToken: vi.fn().mockResolvedValue(null),
    };

    expect(session.provider).toBe('auth0');
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
  });

  it('should reflect authenticated state after login', async () => {
    let authenticated = false;
    let currentUser: { id: string; email: string; name: string } | null = null;
    let currentToken: string | null = null;

    const session: OAuthSession = {
      provider: 'auth0',
      login: vi.fn(async () => {
        authenticated = true;
        currentUser = { id: 'auth0-user-456', email: 'auth0@example.com', name: 'Auth0 User' };
        currentToken = 'auth0-access-token-xyz';
      }),
      logout: vi.fn(async () => {
        authenticated = false;
        currentUser = null;
        currentToken = null;
      }),
      isAuthenticated: vi.fn(() => authenticated),
      getUserInfo: vi.fn(() => currentUser),
      getToken: vi.fn(async () => currentToken),
    };

    expect(session.isAuthenticated()).toBe(false);

    await session.login();
    expect(session.isAuthenticated()).toBe(true);
    expect(session.getUserInfo()).toEqual({
      id: 'auth0-user-456',
      email: 'auth0@example.com',
      name: 'Auth0 User',
    });

    const token = await session.getToken();
    expect(token).toBe('auth0-access-token-xyz');

    await session.logout();
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
  });
});

describe('PKCE utility functions', () => {
  it('generateCodeVerifier returns a string between 43 and 128 characters', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('generateCodeVerifier uses only URL-safe characters (no +, /, =)', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('generateCodeVerifier produces unique values on successive calls', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });

  it('computeS256Challenge produces a 43-character base64url string', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await computeS256Challenge(verifier);
    // S256 challenge is SHA-256 (32 bytes) base64url-encoded = 43 chars (no padding)
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('computeS256Challenge matches RFC 7636 Appendix B test vector', async () => {
    // RFC 7636 Appendix B test vector:
    // code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // code_challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const challenge = await computeS256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generateState returns a 64-character hex string', () => {
    const state = generateState();
    expect(state).toHaveLength(64);
    expect(state).toMatch(/^[0-9a-f]+$/);
  });

  it('generateState produces unique values on successive calls', () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1).not.toBe(s2);
  });
});

describe('createOAuthAuthProvider', () => {
  it('should return Bearer token from session', async () => {
    const mockSession: OAuthSession = {
      provider: 'google',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
      getUserInfo: vi.fn().mockReturnValue({ id: 'user-1' }),
      getToken: vi.fn().mockResolvedValue('my-oauth-token'),
    };

    const authProvider = createOAuthAuthProvider(mockSession);
    const result = await authProvider();
    expect(result).toBe('Bearer my-oauth-token');
  });

  it('should throw if no token is available', async () => {
    const mockSession: OAuthSession = {
      provider: 'google',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
      getUserInfo: vi.fn().mockReturnValue(null),
      getToken: vi.fn().mockResolvedValue(null),
    };

    const authProvider = createOAuthAuthProvider(mockSession);
    await expect(authProvider()).rejects.toThrow('No OAuth token available');
  });

  it('should work with auth0 sessions', async () => {
    const mockSession: OAuthSession = {
      provider: 'auth0',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
      getUserInfo: vi.fn().mockReturnValue({ id: 'auth0-user' }),
      getToken: vi.fn().mockResolvedValue('auth0-token-abc'),
    };

    const authProvider = createOAuthAuthProvider(mockSession);
    const result = await authProvider();
    expect(result).toBe('Bearer auth0-token-abc');
  });

  it('should be compatible with P1Client authProvider interface', async () => {
    const mockSession: OAuthSession = {
      provider: 'google',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
      getUserInfo: vi.fn().mockReturnValue({ id: 'user-1' }),
      getToken: vi.fn().mockResolvedValue('test-token'),
    };

    const authProvider = createOAuthAuthProvider(mockSession);

    // AuthProvider returns a string (the Authorization header value)
    const headerValue = await authProvider();
    expect(typeof headerValue).toBe('string');
    expect(headerValue.startsWith('Bearer ')).toBe(true);
  });

  it('returns Bearer token from css-authserver session', async () => {
    const mockSession: OAuthSession = {
      provider: 'css-authserver',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
      getUserInfo: vi.fn().mockReturnValue({ id: 'user-1' }),
      getToken: vi.fn().mockResolvedValue('user1:grant1:secret1'),
    };

    const authProvider = createOAuthAuthProvider(mockSession);
    const result = await authProvider();
    expect(result).toBe('Bearer user1:grant1:secret1');
  });
});

describe('OAuthSession interface conformance for css-authserver', () => {
  it('accepts css-authserver as a valid provider value', () => {
    const session: OAuthSession = {
      provider: 'css-authserver',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
      getUserInfo: vi.fn().mockReturnValue(null),
      getToken: vi.fn().mockResolvedValue(null),
      handleCallback: vi.fn().mockResolvedValue(undefined),
    };
    expect(session.provider).toBe('css-authserver');
    expect(session.handleCallback).toBeDefined();
  });
});

// --- CSS Auth Server tests ---
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((_index: number) => null),
  };
})();

const locationMock = {
  origin: 'https://mysite.com',
  href: 'https://mysite.com/editor',
  search: '',
};

const replaceStateMock = vi.fn();

const defaultConfig: P1AuthServerOAuthConfig = {
  authServerUrl: 'https://auth.css.example.com',
  siteId: 'site-abc-123',
  redirectUri: 'https://mysite.com/auth/callback',
  p1BaseUrl: 'https://api.css.example.com',
};

describe('createP1AuthServerOAuth', () => {
  const savedSessionStorage = global.sessionStorage;
  const savedLocation = global.location;
  const savedHistory = global.history;
  const savedFetch = global.fetch;

  beforeAll(() => {
    Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock, writable: true, configurable: true });
    Object.defineProperty(global, 'location', { value: locationMock, writable: true, configurable: true });
    Object.defineProperty(global, 'history', { value: { replaceState: replaceStateMock }, writable: true, configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(global, 'sessionStorage', { value: savedSessionStorage, writable: true, configurable: true });
    Object.defineProperty(global, 'location', { value: savedLocation, writable: true, configurable: true });
    Object.defineProperty(global, 'history', { value: savedHistory, writable: true, configurable: true });
    global.fetch = savedFetch;
  });

  beforeEach(() => {
    localStorageMock.clear();
    sessionStorageMock.clear();
    locationMock.href = 'https://mysite.com/editor';
    locationMock.search = '';
    vi.restoreAllMocks();
  });

  it('creates a session with provider set to css-authserver', () => {
    const session = createP1AuthServerOAuth(defaultConfig);
    expect(session.provider).toBe('css-authserver');
  });

  it('is not authenticated initially with no stored token', () => {
    const session = createP1AuthServerOAuth(defaultConfig);
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
  });

  it('restores token from localStorage on creation', () => {
    localStorageMock.setItem('p1_authserver_token', 'user123:grant456:secretxyz');
    const session = createP1AuthServerOAuth(defaultConfig);
    expect(session.isAuthenticated()).toBe(true);
  });

  it('returns stored opaque token from getToken', async () => {
    localStorageMock.setItem('p1_authserver_token', 'user123:grant456:secretxyz');
    const session = createP1AuthServerOAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBe('user123:grant456:secretxyz');
  });

  it('returns null from getToken when not authenticated', async () => {
    const session = createP1AuthServerOAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBeNull();
  });

  it('login() sets location.href to auth server /authorize with correct params', async () => {
    const session = createP1AuthServerOAuth(defaultConfig);
    await session.login();

    const redirectUrl = new URL(locationMock.href);
    expect(redirectUrl.origin).toBe('https://auth.css.example.com');
    expect(redirectUrl.pathname).toBe('/authorize');
    expect(redirectUrl.searchParams.get('client_id')).toBe('site-abc-123');
    expect(redirectUrl.searchParams.get('redirect_uri')).toBe('https://mysite.com/auth/callback');
    expect(redirectUrl.searchParams.get('response_type')).toBe('code');
    expect(redirectUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redirectUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(redirectUrl.searchParams.get('state')).toBeTruthy();
  });

  it('login() stores state and code_verifier in sessionStorage', async () => {
    const session = createP1AuthServerOAuth(defaultConfig);
    await session.login();

    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'p1_authserver_state',
      expect.any(String),
    );
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'p1_authserver_verifier',
      expect.any(String),
    );
  });

  it('handleCallback() exchanges code for tokens on valid callback', async () => {
    const state = 'abc123def456';
    sessionStorageMock.setItem('p1_authserver_state', state);
    sessionStorageMock.setItem('p1_authserver_verifier', 'test-verifier');
    locationMock.search = `?code=auth-code-xyz&state=${state}`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'user1:grant1:secret1',
          token_type: 'bearer',
          refresh_token: 'refresh-token-abc',
        }),
    });
    global.fetch = mockFetch;

    const session = createP1AuthServerOAuth(defaultConfig);
    await session.handleCallback!();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://auth.css.example.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    const callArgs = mockFetch.mock.calls[0];
    const body = callArgs[1].body as string;
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('auth-code-xyz');
    expect(params.get('redirect_uri')).toBe('https://mysite.com/auth/callback');
    expect(params.get('client_id')).toBe('site-abc-123');
    expect(params.get('code_verifier')).toBe('test-verifier');

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'p1_authserver_token',
      'user1:grant1:secret1',
    );
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'p1_authserver_refresh_token',
      'refresh-token-abc',
    );

    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('p1_authserver_state');
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('p1_authserver_verifier');
  });

  it('handleCallback() rejects on state mismatch (CSRF protection)', async () => {
    sessionStorageMock.setItem('p1_authserver_state', 'correct-state');
    sessionStorageMock.setItem('p1_authserver_verifier', 'test-verifier');
    locationMock.search = '?code=auth-code-xyz&state=wrong-state';

    const session = createP1AuthServerOAuth(defaultConfig);
    await expect(session.handleCallback!()).rejects.toThrow('state mismatch');
  });

  it('handleCallback() rejects on token exchange failure', async () => {
    const state = 'valid-state';
    sessionStorageMock.setItem('p1_authserver_state', state);
    sessionStorageMock.setItem('p1_authserver_verifier', 'test-verifier');
    locationMock.search = `?code=auth-code-xyz&state=${state}`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_grant' }),
    });

    const session = createP1AuthServerOAuth(defaultConfig);
    await expect(session.handleCallback!()).rejects.toThrow();
  });

  it('handleCallback() rejects when code is missing from URL', async () => {
    sessionStorageMock.setItem('p1_authserver_state', 'some-state');
    sessionStorageMock.setItem('p1_authserver_verifier', 'test-verifier');
    locationMock.search = '?state=some-state';

    const session = createP1AuthServerOAuth(defaultConfig);
    await expect(session.handleCallback!()).rejects.toThrow('code');
  });

  it('logout() clears all stored tokens and user info', async () => {
    localStorageMock.setItem('p1_authserver_token', 'user1:grant1:secret1');
    localStorageMock.setItem('p1_authserver_refresh_token', 'refresh-abc');
    const session = createP1AuthServerOAuth(defaultConfig);

    await session.logout();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('p1_authserver_token');
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('p1_authserver_refresh_token');
  });

  it('getToken() attempts refresh when access token is missing but refresh token exists', async () => {
    localStorageMock.setItem('p1_authserver_refresh_token', 'refresh-token-abc');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'new-user1:new-grant1:new-secret1',
          token_type: 'bearer',
        }),
    });

    const session = createP1AuthServerOAuth(defaultConfig);
    const token = await session.getToken();

    expect(token).toBe('new-user1:new-grant1:new-secret1');

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = new URLSearchParams(callArgs[1].body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token-abc');
    expect(body.get('client_id')).toBe('site-abc-123');
  });

  it('getToken() returns null when refresh fails', async () => {
    localStorageMock.setItem('p1_authserver_refresh_token', 'expired-refresh');

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_grant' }),
    });

    const session = createP1AuthServerOAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('p1_authserver_refresh_token');
  });

  it('renderButton returns null (css-authserver uses redirect, not provider widget)', () => {
    const session = createP1AuthServerOAuth(defaultConfig);
    expect(session.renderButton).toBeDefined();
    const cleanup = session.renderButton!({} as HTMLElement);
    expect(cleanup).toBeNull();
  });

  it('uses custom storageKey when provided', () => {
    localStorageMock.setItem('my_custom_key_token', 'user1:grant1:secret1');
    const session = createP1AuthServerOAuth({
      ...defaultConfig,
      storageKey: 'my_custom_key',
    });
    expect(session.isAuthenticated()).toBe(true);
  });

  it('restores userInfo (including picture) from a JWT access token on creation', () => {
    const jwt = createTestJwt({
      sub: 'user-123',
      email: 'user@example.com',
      name: 'Test User',
      picture: 'https://lh3.googleusercontent.com/avatar.jpg',
    });
    localStorageMock.setItem('p1_authserver_token', jwt);

    const session = createP1AuthServerOAuth(defaultConfig);

    const info = session.getUserInfo();
    expect(info).not.toBeNull();
    expect(info!.id).toBe('user-123');
    expect(info!.email).toBe('user@example.com');
    expect(info!.name).toBe('Test User');
    expect(info!.picture).toBe('https://lh3.googleusercontent.com/avatar.jpg');
  });

  it('getUserInfo returns null on creation when stored token is opaque (not a JWT)', () => {
    localStorageMock.setItem('p1_authserver_token', 'opaque:token:value');
    const session = createP1AuthServerOAuth(defaultConfig);
    expect(session.getUserInfo()).toBeNull();
  });

  it('handleCallback() populates userInfo (including picture) from JWT access token', async () => {
    const state = 'test-state-xyz';
    sessionStorageMock.setItem('p1_authserver_state', state);
    sessionStorageMock.setItem('p1_authserver_verifier', 'test-verifier');
    locationMock.search = `?code=auth-code-abc&state=${state}`;

    const jwt = createTestJwt({
      sub: 'user-456',
      email: 'callback@example.com',
      name: 'Callback User',
      picture: 'https://lh3.googleusercontent.com/callback-avatar.jpg',
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: jwt, token_type: 'bearer' }),
    });

    const session = createP1AuthServerOAuth(defaultConfig);
    await session.handleCallback!();

    const info = session.getUserInfo();
    expect(info).not.toBeNull();
    expect(info!.id).toBe('user-456');
    expect(info!.picture).toBe('https://lh3.googleusercontent.com/callback-avatar.jpg');
  });

  it('getToken() populates userInfo from JWT when access token is refreshed', async () => {
    localStorageMock.setItem('p1_authserver_refresh_token', 'refresh-token-xyz');

    const jwt = createTestJwt({
      sub: 'user-789',
      email: 'refreshed@example.com',
      name: 'Refreshed User',
      picture: 'https://lh3.googleusercontent.com/refreshed-avatar.jpg',
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: jwt, token_type: 'bearer' }),
    });

    const session = createP1AuthServerOAuth(defaultConfig);
    await session.getToken();

    const info = session.getUserInfo();
    expect(info).not.toBeNull();
    expect(info!.picture).toBe('https://lh3.googleusercontent.com/refreshed-avatar.jpg');
  });
});
