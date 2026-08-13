/**
 * Tests that a deep link survives the broker login round trip.
 *
 * The broker redirects back to the editor root (origin + basePath), so without
 * this the page path and `?branch=` from the dashboard's "Open in visual editor"
 * are lost whenever the user has to authenticate first.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@pantheon-systems/css-client', () => ({
  createBrokerAuth: vi.fn(),
  validateToken: vi.fn().mockResolvedValue(null),
  loginMockUser: vi.fn(),
  hasPendingBrokerLogin: vi.fn().mockReturnValue(false),
  redeemPendingBrokerLogin: vi.fn().mockResolvedValue(null),
}));

import {
  createBrokerAuth,
  validateToken,
  hasPendingBrokerLogin,
  redeemPendingBrokerLogin,
} from '@pantheon-systems/css-client';

import { P1AuthProvider, useP1Auth } from '../auth/P1AuthProvider';

const RETURN_TO_KEY = 'p1_auth_return_to';
const DEEP_LINK = '/p1/about?branch=branch-feature';

function makeFakeOAuthSession(overrides = {}) {
  return {
    provider: 'broker' as const,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: vi.fn().mockReturnValue(false),
    getUserInfo: vi.fn().mockReturnValue(null),
    getToken: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

let replaceSpy: ReturnType<typeof vi.fn>;

/**
 * jsdom's location.replace is non-configurable and cannot navigate, so the
 * whole object is stubbed; the assertion is about the target we ask for.
 */
function setLocation(target: string): void {
  const url = new URL(target, 'http://localhost:3001');
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      replace: replaceSpy,
    },
  });
}

function LoginTrigger() {
  const { login } = useP1Auth();
  return <button data-testid="login" onClick={() => void login()} />;
}

function renderAuth(children: React.ReactNode) {
  return render(
    <P1AuthProvider authMode="broker" p1BaseUrl="http://localhost:8787">
      {children}
    </P1AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(validateToken).mockResolvedValue(null);
  vi.mocked(createBrokerAuth).mockReturnValue(makeFakeOAuthSession() as never);
  vi.mocked(hasPendingBrokerLogin).mockReturnValue(false);
  vi.mocked(redeemPendingBrokerLogin).mockResolvedValue(null);

  replaceSpy = vi.fn();
  setLocation('/p1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('deep link across broker login', () => {
  it('stashes the current path and query before redirecting to the broker', async () => {
    setLocation(DEEP_LINK);
    // login() redirects, so a pending transaction exists afterwards
    vi.mocked(hasPendingBrokerLogin).mockReturnValue(false);
    const session = makeFakeOAuthSession({
      login: vi.fn().mockImplementation(async () => {
        vi.mocked(hasPendingBrokerLogin).mockReturnValue(true);
      }),
    });
    vi.mocked(createBrokerAuth).mockReturnValue(session as never);

    const { getByTestId } = renderAuth(<LoginTrigger />);
    await act(async () => {
      getByTestId('login').click();
    });

    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe(DEEP_LINK);
  });

  it('returns to the stashed deep link after the token is redeemed', async () => {
    sessionStorage.setItem(RETURN_TO_KEY, DEEP_LINK);
    setLocation('/p1');
    vi.mocked(hasPendingBrokerLogin).mockReturnValue(true);
    vi.mocked(redeemPendingBrokerLogin).mockResolvedValue({
      token: 'tok-abc',
      userInfo: { id: 'user-1', name: 'Dev' } as never,
    });

    renderAuth(<div />);

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith(DEEP_LINK);
    });
    // Consumed, so a later reload does not bounce the user again.
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  it('does not redirect when already on the stashed target', async () => {
    setLocation('/p1');
    sessionStorage.setItem(RETURN_TO_KEY, '/p1');
    vi.mocked(hasPendingBrokerLogin).mockReturnValue(true);
    vi.mocked(redeemPendingBrokerLogin).mockResolvedValue({
      token: 'tok-abc',
      userInfo: { id: 'user-1', name: 'Dev' } as never,
    });

    renderAuth(<div />);

    await waitFor(() => {
      expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    });
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  // The value is attacker-influencable only via the user's own session, but a
  // protocol-relative target would still leave the site entirely.
  it('refuses an off-origin stashed target', async () => {
    sessionStorage.setItem(RETURN_TO_KEY, '//evil.example/p1');
    vi.mocked(hasPendingBrokerLogin).mockReturnValue(true);
    vi.mocked(redeemPendingBrokerLogin).mockResolvedValue({
      token: 'tok-abc',
      userInfo: { id: 'user-1', name: 'Dev' } as never,
    });

    renderAuth(<div />);

    await waitFor(() => {
      expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    });
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('drops the stash when login returns without redirecting', async () => {
    setLocation(DEEP_LINK);
    const session = makeFakeOAuthSession({
      getToken: vi.fn().mockResolvedValue('tok-abc'),
    });
    vi.mocked(createBrokerAuth).mockReturnValue(session as never);
    vi.mocked(hasPendingBrokerLogin).mockReturnValue(false);

    const { getByTestId } = renderAuth(<LoginTrigger />);
    await act(async () => {
      getByTestId('login').click();
    });

    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });
});
