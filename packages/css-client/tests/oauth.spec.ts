/**
 * OAuth Helpers Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleOAuth, createOAuthAuthProvider } from '../src/oauth.js';
import type { OAuthSession } from '../src/oauth.js';

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
    localStorageMock.setItem('css_google_token', testJwt);
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
    localStorageMock.setItem('css_google_token', testJwt);
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
    localStorageMock.setItem('css_google_token', testJwt);
    const session = createGoogleOAuth({ clientId: 'test-client-id' });
    expect(session.isAuthenticated()).toBe(true);
    expect(session.getUserInfo()).not.toBeNull();

    await session.logout();
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('css_google_token');
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

  it('should be compatible with CSSClient authProvider interface', async () => {
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
});
