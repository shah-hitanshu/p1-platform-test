/**
 * Broker Auth Tests
 *
 * Tests for the brokered authentication flow where a panel authenticates
 * with a site API token, initiates a user login via Auth0 through the broker,
 * and receives a broker JWT for subsequent API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBrokerAuth, hasPendingBrokerLogin, redeemPendingBrokerLogin } from '../src/broker.js';
import { createOAuthAuthProvider } from '../src/oauth.js';
import type { BrokerAuthConfig } from '../src/broker.js';

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

Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock, writable: true });
Object.defineProperty(global, 'window', {
  value: { localStorage: localStorageMock, sessionStorage: sessionStorageMock },
  writable: true,
  configurable: true,
});

function createTestJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const sig = btoa('fake-signature');
  return `${header}.${body}.${sig}`;
}

const mockFetch = vi.fn();

const defaultConfig: BrokerAuthConfig = {
  cssBaseUrl: 'https://css-api.example.com',
  siteApiToken: 'sat_test-token-123',
  onLoginUrl: vi.fn(),
};

describe('createBrokerAuth', () => {
  const savedFetch = global.fetch;

  beforeEach(() => {
    localStorageMock.clear();
    sessionStorageMock.clear();
    mockFetch.mockReset();
    global.fetch = mockFetch;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = savedFetch;
  });

  it('creates a session with provider set to broker', () => {
    const session = createBrokerAuth(defaultConfig);
    expect(session.provider).toBe('broker');
  });

  it('is not authenticated initially with no stored token', () => {
    const session = createBrokerAuth(defaultConfig);
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
  });

  it('restores token from localStorage on creation', () => {
    const jwt = createTestJwt({
      sub: 'user-123',
      email: 'user@example.com',
      name: 'Test User',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorageMock.setItem('css_broker_token', jwt);
    const session = createBrokerAuth(defaultConfig);
    expect(session.isAuthenticated()).toBe(true);
  });

  it('restores user info from stored JWT on creation', () => {
    const jwt = createTestJwt({
      sub: 'user-123',
      email: 'user@example.com',
      name: 'Test User',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorageMock.setItem('css_broker_token', jwt);
    const session = createBrokerAuth(defaultConfig);
    const info = session.getUserInfo();
    expect(info).not.toBeNull();
    expect(info!.id).toBe('user-123');
    expect(info!.email).toBe('user@example.com');
    expect(info!.name).toBe('Test User');
  });

  it('uses custom storageKey when provided', () => {
    const jwt = createTestJwt({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorageMock.setItem('my_broker_key', jwt);
    const session = createBrokerAuth({ ...defaultConfig, storageKey: 'my_broker_key' });
    expect(session.isAuthenticated()).toBe(true);
  });

  it('returns stored token from getToken', async () => {
    const jwt = createTestJwt({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorageMock.setItem('css_broker_token', jwt);
    const session = createBrokerAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBe(jwt);
  });

  it('returns null from getToken when not authenticated', async () => {
    const session = createBrokerAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBeNull();
  });

  it('returns null from getToken when token is expired', async () => {
    const jwt = createTestJwt({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    localStorageMock.setItem('css_broker_token', jwt);
    const session = createBrokerAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBeNull();
  });

  it('treats token expiring within 5 minutes as expired', async () => {
    const jwt = createTestJwt({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 120,
    });
    localStorageMock.setItem('css_broker_token', jwt);
    const session = createBrokerAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBeNull();
  });

  it('clears token and user info on logout', async () => {
    const jwt = createTestJwt({
      sub: 'user-1',
      email: 'user@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorageMock.setItem('css_broker_token', jwt);
    const session = createBrokerAuth(defaultConfig);
    expect(session.isAuthenticated()).toBe(true);

    await session.logout();
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('css_broker_token');
  });

  describe('login()', () => {
    it('calls POST /broker/login with the site API token', async () => {
      const onLoginUrl = vi.fn();
      const brokerJwt = createTestJwt({
        sub: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-abc-123',
            loginUrl: 'https://css-api.example.com/broker/login/tx-abc-123',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: brokerJwt }),
        });

      const session = createBrokerAuth({ ...defaultConfig, onLoginUrl, pollIntervalMs: 10 });
      await session.login();

      const loginCall = mockFetch.mock.calls[0];
      expect(loginCall[0]).toBe('https://css-api.example.com/broker/login');
      expect(loginCall[1].method).toBe('POST');
      expect(loginCall[1].headers['Authorization']).toBe('Bearer sat_test-token-123');
    });

    it('invokes onLoginUrl with the login URL from the broker', async () => {
      const onLoginUrl = vi.fn();
      const brokerJwt = createTestJwt({
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-abc-123',
            loginUrl: 'https://css-api.example.com/broker/login/tx-abc-123',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: brokerJwt }),
        });

      const session = createBrokerAuth({ ...defaultConfig, onLoginUrl, pollIntervalMs: 10 });
      await session.login();

      expect(onLoginUrl).toHaveBeenCalledWith(
        'https://css-api.example.com/broker/login/tx-abc-123',
      );
    });

    it('polls /broker/redeem until the transaction is approved', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-1',
        email: 'user@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-poll-test',
            loginUrl: 'https://css-api.example.com/broker/login/tx-poll-test',
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'Transaction not found or not approved' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'Transaction not found or not approved' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: brokerJwt }),
        });

      const session = createBrokerAuth({ ...defaultConfig, pollIntervalMs: 10 });
      await session.login();

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('sends transactionId in the redeem request body', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-body-test',
            loginUrl: 'https://css-api.example.com/broker/login/tx-body-test',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: brokerJwt }),
        });

      const session = createBrokerAuth({ ...defaultConfig, pollIntervalMs: 10 });
      await session.login();

      const redeemCall = mockFetch.mock.calls[1];
      expect(redeemCall[0]).toBe('https://css-api.example.com/broker/redeem');
      expect(redeemCall[1].method).toBe('POST');
      expect(redeemCall[1].headers['Content-Type']).toBe('application/json');
      expect(redeemCall[1].headers['Authorization']).toBe('Bearer sat_test-token-123');
      expect(JSON.parse(redeemCall[1].body as string)).toEqual({
        transactionId: 'tx-body-test',
      });
    });

    it('stores the broker JWT in localStorage after successful login', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-1',
        email: 'user@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-store-test',
            loginUrl: 'https://css-api.example.com/broker/login/tx-store-test',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: brokerJwt }),
        });

      const session = createBrokerAuth({ ...defaultConfig, pollIntervalMs: 10 });
      await session.login();

      expect(localStorageMock.setItem).toHaveBeenCalledWith('css_broker_token', brokerJwt);
    });

    it('populates user info from the broker JWT after login', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-456',
        email: 'alice@example.com',
        name: 'Alice',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-info-test',
            loginUrl: 'https://css-api.example.com/broker/login/tx-info-test',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: brokerJwt }),
        });

      const session = createBrokerAuth({ ...defaultConfig, pollIntervalMs: 10 });
      await session.login();

      const info = session.getUserInfo();
      expect(info).not.toBeNull();
      expect(info!.id).toBe('user-456');
      expect(info!.email).toBe('alice@example.com');
      expect(info!.name).toBe('Alice');
    });

    it('throws with HTTP status and server message when /broker/login fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Authentication required' }),
      });

      const session = createBrokerAuth({ ...defaultConfig, pollIntervalMs: 10 });
      await expect(session.login()).rejects.toThrow(/401/);
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Authentication required' }),
      });
      const session2 = createBrokerAuth({ ...defaultConfig, pollIntervalMs: 10 });
      await expect(session2.login()).rejects.toThrow(/Authentication required/);
    });

    it('throws with status when /broker/login returns non-JSON error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      const session = createBrokerAuth({ ...defaultConfig, pollIntervalMs: 10 });
      await expect(session.login()).rejects.toThrow(/503/);
    });

    it('throws when polling exceeds max attempts', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-timeout',
            loginUrl: 'https://css-api.example.com/broker/login/tx-timeout',
          }),
        });

      for (let i = 0; i < 60; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'Not approved' }),
        });
      }

      const session = createBrokerAuth({
        ...defaultConfig,
        pollIntervalMs: 1,
        maxPollAttempts: 3,
      });
      await expect(session.login()).rejects.toThrow('timed out');
    });

    it('throws immediately when redeem returns 410 (expired)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-expired',
            loginUrl: 'https://css-api.example.com/broker/login/tx-expired',
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 410,
          json: () => Promise.resolve({ error: 'Transaction expired' }),
        });

      const session = createBrokerAuth({
        ...defaultConfig,
        pollIntervalMs: 10,
        maxPollAttempts: 50,
      });
      await expect(session.login()).rejects.toThrow(/expired/i);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws immediately when redeem returns 400 (rejected)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-rejected',
            loginUrl: 'https://css-api.example.com/broker/login/tx-rejected',
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'Transaction denied by user' }),
        });

      const session = createBrokerAuth({
        ...defaultConfig,
        pollIntervalMs: 10,
        maxPollAttempts: 50,
      });
      await expect(session.login()).rejects.toThrow(/rejected|denied/i);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('can be aborted via AbortController', async () => {
      const controller = new AbortController();

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-abort',
            loginUrl: 'https://css-api.example.com/broker/login/tx-abort',
          }),
        })
        .mockImplementation(() => new Promise((resolve) => {
          setTimeout(() => resolve({
            ok: false,
            status: 404,
            json: () => Promise.resolve({ error: 'Not approved' }),
          }), 50);
        }));

      const session = createBrokerAuth({
        ...defaultConfig,
        pollIntervalMs: 10,
        signal: controller.signal,
      });

      setTimeout(() => controller.abort(), 20);

      await expect(session.login()).rejects.toThrow('Aborted');
    });
  });

  describe('proxy mode (no siteApiToken)', () => {
    const proxyConfig: BrokerAuthConfig = {
      cssBaseUrl: 'https://css-api.example.com',
      onLoginUrl: vi.fn(),
    };

    it('calls /p1/auth/login without Authorization header', async () => {
      const onLoginUrl = vi.fn();
      const brokerJwt = createTestJwt({
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-proxy-1',
            loginUrl: 'https://auth0.example.com/login',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: brokerJwt }),
        });

      const session = createBrokerAuth({ ...proxyConfig, onLoginUrl, pollIntervalMs: 10 });
      await session.login();

      const loginCall = mockFetch.mock.calls[0];
      expect(loginCall[0]).toBe('/p1/auth/login');
      expect(loginCall[1].method).toBe('POST');
      expect(loginCall[1].headers).not.toHaveProperty('Authorization');
    });

    it('calls /p1/auth/redeem without Authorization header', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-proxy-2',
            loginUrl: 'https://auth0.example.com/login',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: brokerJwt }),
        });

      const session = createBrokerAuth({ ...proxyConfig, pollIntervalMs: 10 });
      await session.login();

      const redeemCall = mockFetch.mock.calls[1];
      expect(redeemCall[0]).toBe('/p1/auth/redeem');
      expect(redeemCall[1].headers).not.toHaveProperty('Authorization');
      expect(JSON.parse(redeemCall[1].body as string)).toEqual({
        transactionId: 'tx-proxy-2',
      });
    });

    it('stores broker JWT in localStorage after proxy login', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-proxy',
        email: 'proxy@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            transactionId: 'tx-proxy-3',
            loginUrl: 'https://auth0.example.com/login',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: brokerJwt }),
        });

      const session = createBrokerAuth({ ...proxyConfig, pollIntervalMs: 10 });
      await session.login();

      expect(localStorageMock.setItem).toHaveBeenCalledWith('css_broker_token', brokerJwt);
      const info = session.getUserInfo();
      expect(info!.id).toBe('user-proxy');
    });
  });

  describe('SSR safety (no window)', () => {
    const brokenPolyfill = {
      getItem() { throw new TypeError('localStorage.getItem is not a function'); },
      setItem() { throw new TypeError('localStorage.setItem is not a function'); },
      removeItem() { throw new TypeError('localStorage.removeItem is not a function'); },
    };
    let savedWindow: typeof globalThis.window;
    let savedLocalStorage: Storage;

    beforeEach(() => {
      savedWindow = global.window;
      savedLocalStorage = global.localStorage;
      Object.defineProperty(global, 'window', { value: undefined, writable: true, configurable: true });
      Object.defineProperty(global, 'localStorage', { value: brokenPolyfill, writable: true });
    });

    afterEach(() => {
      Object.defineProperty(global, 'window', { value: savedWindow, writable: true, configurable: true });
      Object.defineProperty(global, 'localStorage', { value: savedLocalStorage, writable: true });
    });

    it('creates a session without throwing when window is undefined', () => {
      expect(() => createBrokerAuth(defaultConfig)).not.toThrow();
    });

    it('reports not authenticated when window is undefined', () => {
      const session = createBrokerAuth(defaultConfig);
      expect(session.isAuthenticated()).toBe(false);
    });

    it('returns null from getToken when window is undefined', async () => {
      const session = createBrokerAuth(defaultConfig);
      expect(await session.getToken()).toBeNull();
    });

    it('returns null userInfo when window is undefined', () => {
      const session = createBrokerAuth(defaultConfig);
      expect(session.getUserInfo()).toBeNull();
    });

    it('logout does not throw when window is undefined', async () => {
      const session = createBrokerAuth(defaultConfig);
      await expect(session.logout()).resolves.not.toThrow();
    });
  });

  describe('redirect mode login()', () => {
    it('stores transactionId in sessionStorage and calls onLoginUrl', async () => {
      const onLoginUrl = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          transactionId: 'tx-redirect-1',
          loginUrl: 'https://auth0.example.com/authorize?tx=redirect-1',
        }),
      });

      const session = createBrokerAuth({
        ...defaultConfig,
        onLoginUrl,
        loginMode: 'redirect',
      });
      await session.login();

      expect(onLoginUrl).toHaveBeenCalledWith(
        'https://auth0.example.com/authorize?tx=redirect-1',
      );

      const stored = JSON.parse(sessionStorageMock.getItem('css_broker_pending_tx')!);
      expect(stored.transactionId).toBe('tx-redirect-1');
    });

    it('does not poll the redeem endpoint', async () => {
      const onLoginUrl = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          transactionId: 'tx-redirect-no-poll',
          loginUrl: 'https://auth0.example.com/authorize',
        }),
      });

      const session = createBrokerAuth({
        ...defaultConfig,
        onLoginUrl,
        loginMode: 'redirect',
        pollIntervalMs: 10,
      });
      await session.login();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws when /broker/login fails in redirect mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      const session = createBrokerAuth({
        ...defaultConfig,
        loginMode: 'redirect',
      });
      await expect(session.login()).rejects.toThrow(/401/);
    });
  });

  describe('hasPendingBrokerLogin()', () => {
    it('returns false when no pending transaction exists', () => {
      expect(hasPendingBrokerLogin()).toBe(false);
    });

    it('returns true when a pending transaction exists in sessionStorage', () => {
      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-pending' }),
      );
      expect(hasPendingBrokerLogin()).toBe(true);
    });
  });

  describe('redeemPendingBrokerLogin()', () => {
    it('returns null when no pending transaction exists', async () => {
      const result = await redeemPendingBrokerLogin({
        cssBaseUrl: 'https://css-api.example.com',
        siteApiToken: 'sat_test-token-123',
      });
      expect(result).toBeNull();
    });

    it('redeems pending transaction and returns token and user info', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-redirect',
        email: 'redirect@example.com',
        name: 'Redirect User',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-redeem-1' }),
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: brokerJwt }),
      });

      const result = await redeemPendingBrokerLogin({
        cssBaseUrl: 'https://css-api.example.com',
        siteApiToken: 'sat_test-token-123',
      });

      expect(result).not.toBeNull();
      expect(result!.token).toBe(brokerJwt);
      expect(result!.userInfo).not.toBeNull();
      expect(result!.userInfo!.id).toBe('user-redirect');
      expect(result!.userInfo!.email).toBe('redirect@example.com');
    });

    it('stores the redeemed token in localStorage', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-stored',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-store-ls' }),
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: brokerJwt }),
      });

      await redeemPendingBrokerLogin({
        cssBaseUrl: 'https://css-api.example.com',
        siteApiToken: 'sat_test-token-123',
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('css_broker_token', brokerJwt);
    });

    it('clears sessionStorage after successful redeem', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-clear',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-clear' }),
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: brokerJwt }),
      });

      await redeemPendingBrokerLogin({
        cssBaseUrl: 'https://css-api.example.com',
        siteApiToken: 'sat_test-token-123',
      });

      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('css_broker_pending_tx');
    });

    it('throws on 410 (expired) and clears sessionStorage', async () => {
      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-expired' }),
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        json: () => Promise.resolve({ error: 'Transaction expired' }),
      });

      await expect(
        redeemPendingBrokerLogin({
          cssBaseUrl: 'https://css-api.example.com',
          siteApiToken: 'sat_test-token-123',
        }),
      ).rejects.toThrow(/expired/i);

      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('css_broker_pending_tx');
    });

    it('throws on 400 (rejected) and clears sessionStorage', async () => {
      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-rejected' }),
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Transaction rejected' }),
      });

      await expect(
        redeemPendingBrokerLogin({
          cssBaseUrl: 'https://css-api.example.com',
          siteApiToken: 'sat_test-token-123',
        }),
      ).rejects.toThrow(/rejected/i);

      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('css_broker_pending_tx');
    });

    it('uses proxy mode when siteApiToken is not provided', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-proxy',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-proxy-redeem' }),
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: brokerJwt }),
      });

      await redeemPendingBrokerLogin({
        cssBaseUrl: 'https://css-api.example.com',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('/p1/auth/redeem');
    });

    it('preserves sessionStorage when redeem returns 500 (transient error)', async () => {
      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-transient' }),
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' }),
      });

      await expect(
        redeemPendingBrokerLogin({
          cssBaseUrl: 'https://css-api.example.com',
          siteApiToken: 'sat_test-token-123',
        }),
      ).rejects.toThrow(/500/);

      expect(sessionStorageMock.getItem('css_broker_pending_tx')).not.toBeNull();
    });

    it('clears sessionStorage on terminal 410 error', async () => {
      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-terminal' }),
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        json: () => Promise.resolve({ error: 'Transaction expired' }),
      });

      await expect(
        redeemPendingBrokerLogin({
          cssBaseUrl: 'https://css-api.example.com',
          siteApiToken: 'sat_test-token-123',
        }),
      ).rejects.toThrow(/expired/i);

      expect(sessionStorageMock.getItem('css_broker_pending_tx')).toBeNull();
    });

    it('returns null and clears sessionStorage when pending tx has malformed JSON', async () => {
      sessionStorageMock.setItem('css_broker_pending_tx', '{corrupt');

      const result = await redeemPendingBrokerLogin({
        cssBaseUrl: 'https://css-api.example.com',
        siteApiToken: 'sat_test-token-123',
      });

      expect(result).toBeNull();
      expect(sessionStorageMock.getItem('css_broker_pending_tx')).toBeNull();
    });

    it('uses custom storageKey', async () => {
      const brokerJwt = createTestJwt({
        sub: 'user-custom',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      sessionStorageMock.setItem(
        'css_broker_pending_tx',
        JSON.stringify({ transactionId: 'tx-custom' }),
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: brokerJwt }),
      });

      await redeemPendingBrokerLogin({
        cssBaseUrl: 'https://css-api.example.com',
        siteApiToken: 'sat_test-token-123',
        storageKey: 'my_custom_key',
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('my_custom_key', brokerJwt);
    });
  });

  describe('createOAuthAuthProvider compatibility', () => {
    it('works with createOAuthAuthProvider for Bearer tokens', async () => {
      const jwt = createTestJwt({
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      localStorageMock.setItem('css_broker_token', jwt);
      const session = createBrokerAuth(defaultConfig);
      const authProvider = createOAuthAuthProvider(session);

      const result = await authProvider();
      expect(result).toBe(`Bearer ${jwt}`);
    });

    it('throws via createOAuthAuthProvider when token is expired', async () => {
      const jwt = createTestJwt({
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) - 60,
      });
      localStorageMock.setItem('css_broker_token', jwt);
      const session = createBrokerAuth(defaultConfig);
      const authProvider = createOAuthAuthProvider(session);

      await expect(authProvider()).rejects.toThrow('No OAuth token available');
    });
  });
});

/**
 * PCC-3531: the browser is the only party that reliably knows the app's public
 * origin — the server sees an internal listener behind Pantheon's proxy. The client
 * states it and lets the server side decide; it makes no security decision.
 */
describe('createBrokerAuth — origin proposal (PCC-3531)', () => {
  const savedFetch = global.fetch;
  let savedLocation: unknown;

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
    savedLocation = (global.window as { location?: unknown }).location;
    (global.window as { location?: unknown }).location = {
      origin: 'https://live-mysite.pantheonsite.io',
      pathname: '/p1/editor',
    };
  });

  afterEach(() => {
    global.fetch = savedFetch;
    (global.window as { location?: unknown }).location = savedLocation;
  });

  function mockLoginThenRedeem(): void {
    const jwt = createTestJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactionId: 'tx-1', loginUrl: 'https://broker/login/tx-1' }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: jwt }) });
  }

  it('sends the browser origin to the app proxy so the server can compose a proposal', async () => {
    mockLoginThenRedeem();

    // No siteApiToken — proxy mode, as the editor uses.
    const session = createBrokerAuth({
      cssBaseUrl: 'https://css-api.example.com',
      onLoginUrl: vi.fn(),
      pollIntervalMs: 10,
    });
    await session.login();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/p1/auth/login');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ origin: 'https://live-mysite.pantheonsite.io' });
  });

  // No Next.js route in between, so no server hop to compose the redirect.
  it('sends a full proposed redirect URL when talking to the broker directly', async () => {
    mockLoginThenRedeem();

    const session = createBrokerAuth({ ...defaultConfig, onLoginUrl: vi.fn(), pollIntervalMs: 10 });
    await session.login();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://css-api.example.com/broker/login');
    expect(JSON.parse(init.body)).toEqual({
      proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1/editor',
    });
    // The site token still authenticates the call.
    expect(init.headers['Authorization']).toBe('Bearer sat_test-token-123');
  });

  it('omits the proposal rather than guessing when location is unavailable', async () => {
    mockLoginThenRedeem();
    (global.window as { location?: unknown }).location = undefined;

    const session = createBrokerAuth({
      cssBaseUrl: 'https://css-api.example.com',
      onLoginUrl: vi.fn(),
      pollIntervalMs: 10,
    });
    await session.login();

    const [, init] = mockFetch.mock.calls[0];
    if (init.body !== undefined) {
      expect(JSON.parse(init.body)).not.toHaveProperty('origin');
    }
  });
});
