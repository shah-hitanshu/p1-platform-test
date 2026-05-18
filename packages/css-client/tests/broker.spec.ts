/**
 * Broker Auth Tests
 *
 * Tests for the brokered authentication flow where a panel authenticates
 * with a site API token, initiates a user login via Auth0 through the broker,
 * and receives a broker JWT for subsequent API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBrokerAuth } from '../src/broker.js';
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

Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });
Object.defineProperty(global, 'window', {
  value: { localStorage: localStorageMock },
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
