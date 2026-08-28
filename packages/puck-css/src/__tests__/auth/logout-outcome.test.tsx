/**
 * The provider's logout contract: it hands the outcome back rather than
 * writing to `error`. That slot is the login slot — it is set on a token
 * validation failure that still leaves the user signed in, and cleared only by
 * a later login. Reusing it for logout showed "you are still signed in" on a
 * session where no logout was ever attempted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

vi.mock('@pantheon-systems/css-client', () => ({
  createBrokerAuth: vi.fn(),
  validateToken: vi.fn().mockResolvedValue(null),
  loginMockUser: vi.fn(),
  hasPendingBrokerLogin: vi.fn().mockReturnValue(false),
  redeemPendingBrokerLogin: vi.fn().mockResolvedValue(null),
  brokerLogout: vi.fn(),
}));

import { brokerLogout, createBrokerAuth, validateToken } from '@pantheon-systems/css-client';
import { P1AuthProvider, useP1Auth } from '../../auth/P1AuthProvider';
import { DEFAULT_TOKEN_KEY, P1_LOGGED_IN_KEY } from '../../auth/storage-keys';

const BROKER_JWT_KEY = 'ccr_broker_token';

function renderProvider(authMode: 'mock' | 'broker') {
  const captured: { ctx: ReturnType<typeof useP1Auth> | null } = { ctx: null };

  function Consumer() {
    captured.ctx = useP1Auth();
    return null;
  }

  render(
    <P1AuthProvider authMode={authMode} p1BaseUrl="http://localhost:8787">
      <Consumer />
    </P1AuthProvider>,
  );

  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(validateToken).mockResolvedValue(null);
  vi.mocked(createBrokerAuth).mockReturnValue({
    provider: 'broker' as const,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    isAuthenticated: vi.fn().mockReturnValue(false),
    getUserInfo: vi.fn().mockReturnValue(null),
    getToken: vi.fn().mockResolvedValue(null),
  });
});

describe('P1AuthProvider.logout() outcome', () => {
  it('returns the error outcome and leaves the login error slot untouched', async () => {
    localStorage.setItem(BROKER_JWT_KEY, 'broker-jwt');
    localStorage.setItem(P1_LOGGED_IN_KEY, '1');
    vi.mocked(brokerLogout).mockResolvedValue({
      status: 'error',
      message: 'Broker logout failed (502)',
    });

    const captured = renderProvider('broker');

    let outcome;
    await act(async () => {
      outcome = await captured.ctx!.logout();
    });

    expect(outcome).toEqual({ status: 'error', message: 'Broker logout failed (502)' });
    // The whole point: a failed logout must not land in the login slot, where
    // it would outlive the attempt and be rendered on an unrelated screen.
    expect(captured.ctx!.error).toBeNull();
    // Credential kept so the user can retry.
    expect(localStorage.getItem(BROKER_JWT_KEY)).toBe('broker-jwt');
    expect(localStorage.getItem(P1_LOGGED_IN_KEY)).toBe('1');
  });

  it('returns the signed_out outcome so the caller can navigate', async () => {
    localStorage.setItem(BROKER_JWT_KEY, 'broker-jwt');
    vi.mocked(brokerLogout).mockResolvedValue({
      status: 'signed_out',
      logoutUrl: 'https://auth0.example.com/v2/logout',
    });

    const captured = renderProvider('broker');

    let outcome;
    await act(async () => {
      outcome = await captured.ctx!.logout();
    });

    expect(outcome).toEqual({
      status: 'signed_out',
      logoutUrl: 'https://auth0.example.com/v2/logout',
    });
    expect(captured.ctx!.error).toBeNull();
  });

  it('reports no_session in mock mode, where there is no Auth0 session to end', async () => {
    localStorage.setItem(DEFAULT_TOKEN_KEY, 'mock-token');
    localStorage.setItem(P1_LOGGED_IN_KEY, '1');

    const captured = renderProvider('mock');

    let outcome;
    await act(async () => {
      outcome = await captured.ctx!.logout();
    });

    expect(outcome).toEqual({ status: 'no_session' });
    expect(brokerLogout).not.toHaveBeenCalled();
    expect(localStorage.getItem(DEFAULT_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(P1_LOGGED_IN_KEY)).toBeNull();
  });
});
