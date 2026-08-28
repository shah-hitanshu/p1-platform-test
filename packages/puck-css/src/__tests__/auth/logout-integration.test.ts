// Deliberately does NOT mock brokerLogout. The seam between puck-css's token
// key and css-client's broker JWT key is the thing under test, and a mock of
// brokerLogout is exactly what hides it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { performLogout } from '../../auth/logout.js';
import { DEFAULT_TOKEN_KEY, P1_LOGGED_IN_KEY } from '../../auth/storage-keys.js';

// Where css-client stores the broker JWT. P1AuthProvider builds its session
// without a storageKey, so this is where the credential actually lands.
const BROKER_JWT_KEY = 'ccr_broker_token';

describe('performLogout against the real brokerLogout', () => {
  const savedFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ logoutUrl: 'https://auth0.example.com/v2/logout' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = savedFetch;
  });

  it('reaches the broker when the caller overrides its own token key', async () => {
    localStorage.setItem(BROKER_JWT_KEY, 'broker-jwt-value');
    localStorage.setItem(P1_LOGGED_IN_KEY, '1');

    // Exactly what P1AuthProvider sends: its own key, which is not the JWT key.
    const outcome = await performLogout({
      cssBaseUrl: 'https://css-api.example.com',
      tokenStorageKey: DEFAULT_TOKEN_KEY,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/p1/auth/logout');
    expect(outcome).toEqual({
      status: 'signed_out',
      logoutUrl: 'https://auth0.example.com/v2/logout',
    });
    expect(localStorage.getItem(BROKER_JWT_KEY)).toBeNull();
    expect(localStorage.getItem(P1_LOGGED_IN_KEY)).toBeNull();
  });

  it('calls backend without Authorization when no broker JWT is stored (seam: puck key not forwarded)', async () => {
    // Only the puck-css key is set — the broker JWT key (ccr_broker_token) is empty.
    // The broker call must go out without Authorization, proving the puck key
    // was not forwarded as a credential.
    localStorage.setItem(DEFAULT_TOKEN_KEY, 'not-a-broker-jwt');

    const outcome = await performLogout({
      cssBaseUrl: 'https://css-api.example.com',
      tokenStorageKey: DEFAULT_TOKEN_KEY,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
    expect(outcome).toEqual({ status: 'signed_out', logoutUrl: 'https://auth0.example.com/v2/logout' });
  });
});
