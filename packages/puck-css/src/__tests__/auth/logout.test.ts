import { describe, it, expect, vi, beforeEach } from 'vitest';

const brokerLogout = vi.fn();

vi.mock('@pantheon-systems/css-client', () => ({
  brokerLogout: (...args: unknown[]) => brokerLogout(...args) as unknown,
}));

import { performLogout } from '../../auth/logout.js';
import { DEFAULT_TOKEN_KEY, P1_LOGGED_IN_KEY } from '../../auth/storage-keys.js';

const config = { cssBaseUrl: 'https://css-api.example.com' };

describe('performLogout', () => {
  beforeEach(() => {
    localStorage.clear();
    brokerLogout.mockReset();
    localStorage.setItem(DEFAULT_TOKEN_KEY, 'stale-token');
    localStorage.setItem(P1_LOGGED_IN_KEY, '1');
  });

  it('clears the puck-css keys and returns the outcome on signed_out', async () => {
    const outcome = { status: 'signed_out', logoutUrl: 'https://auth0.example.com/v2/logout' };
    brokerLogout.mockResolvedValue(outcome);

    await expect(performLogout(config)).resolves.toEqual(outcome);

    expect(localStorage.getItem(DEFAULT_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(P1_LOGGED_IN_KEY)).toBeNull();
  });

  it('clears the puck-css keys on no_session so local state matches', async () => {
    brokerLogout.mockResolvedValue({ status: 'no_session' });

    await expect(performLogout(config)).resolves.toEqual({ status: 'no_session' });

    expect(localStorage.getItem(DEFAULT_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(P1_LOGGED_IN_KEY)).toBeNull();
  });

  it('leaves both keys in place on error so the logout can be retried', async () => {
    brokerLogout.mockResolvedValue({ status: 'error', message: 'Broker logout failed (502)' });

    const outcome = await performLogout(config);

    expect(outcome).toEqual({ status: 'error', message: 'Broker logout failed (502)' });
    expect(localStorage.getItem(DEFAULT_TOKEN_KEY)).toBe('stale-token');
    expect(localStorage.getItem(P1_LOGGED_IN_KEY)).toBe('1');
  });

  it('clears the caller-supplied tokenStorageKey rather than the default', async () => {
    localStorage.setItem('my_app_token', 'consumer-token');
    brokerLogout.mockResolvedValue({ status: 'no_session' });

    await performLogout({ ...config, tokenStorageKey: 'my_app_token' });

    expect(localStorage.getItem('my_app_token')).toBeNull();
    expect(localStorage.getItem(P1_LOGGED_IN_KEY)).toBeNull();
    // The default key belongs to a different consumer and is not ours to remove.
    expect(localStorage.getItem(DEFAULT_TOKEN_KEY)).toBe('stale-token');
  });

  // tokenStorageKey names the puck-css key. brokerLogout's own storageKey means
  // the broker JWT key, so forwarding ours would send it hunting under a key
  // that never holds a JWT.
  it('does not forward tokenStorageKey into brokerLogout', async () => {
    brokerLogout.mockResolvedValue({ status: 'no_session' });

    await performLogout({ ...config, siteApiToken: 'sat_abc', tokenStorageKey: 'my_app_token' });

    expect(brokerLogout).toHaveBeenCalledWith({
      cssBaseUrl: 'https://css-api.example.com',
      siteApiToken: 'sat_abc',
    });
  });
});
