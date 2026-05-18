/**
 * Tests for silent token refresh feature in P1AuthProvider.
 *
 * Validates:
 * - isSessionExpired is exposed in context, defaulting to false
 * - getToken is exposed in context as a function
 * - getToken returns token from localStorage in mock mode
 * - getToken delegates to oauthSession.getToken() in broker mode
 * - getToken returns null and sets isSessionExpired when oauth token refresh fails
 * - isSessionExpired resets to false after logout
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@pantheon-systems/css-client', () => ({
  createBrokerAuth: vi.fn(),
  validateToken: vi.fn().mockResolvedValue(null),
  loginMockUser: vi.fn(),
}));

import {
  createBrokerAuth,
  validateToken,
} from '@pantheon-systems/css-client';


import { P1AuthProvider, useP1Auth } from '../auth/P1AuthProvider';

function makeFakeOAuthSession(overrides: Partial<{
  getToken: ReturnType<typeof vi.fn>;
  isAuthenticated: ReturnType<typeof vi.fn>;
  getUserInfo: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
}> = {}) {
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

function AuthContextConsumer({
  onContext,
}: {
  onContext: (ctx: ReturnType<typeof useP1Auth>) => void;
}) {
  const ctx = useP1Auth();
  onContext(ctx);
  return (
    <div
      data-testid="consumer"
      data-session-expired={String(ctx.isSessionExpired)}
      data-has-get-token={typeof ctx.getToken === 'function' ? 'true' : 'false'}
    />
  );
}

/** Render a P1AuthProvider in mock mode and return captured context values. */
function renderMockProvider(props: Partial<Parameters<typeof P1AuthProvider>[0]> = {}) {
  const captured: { ctx: ReturnType<typeof useP1Auth> | null } = { ctx: null };

  render(
    <P1AuthProvider
      authMode="mock"
      p1BaseUrl="http://localhost:8787"
      tokenStorageKey="p1_auth_token"
      {...props}
    >
      <AuthContextConsumer onContext={(c) => { captured.ctx = c; }} />
    </P1AuthProvider>,
  );

  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  vi.mocked(validateToken).mockResolvedValue(null);
  vi.mocked(createBrokerAuth).mockReturnValue(makeFakeOAuthSession());
});


describe('P1AuthProvider isSessionExpired', () => {
  it('exposes isSessionExpired in context, defaulting to false', async () => {
    const captured = renderMockProvider();

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    expect(captured.ctx).not.toBeNull();
    expect((captured.ctx as ReturnType<typeof useP1Auth>).isSessionExpired).toBe(false);
  });

  it('exposes getToken function in context', async () => {
    const captured = renderMockProvider();

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    expect(captured.ctx).not.toBeNull();
    expect(typeof (captured.ctx as ReturnType<typeof useP1Auth>).getToken).toBe('function');
  });
});

describe('getToken behavior', () => {
  it('in mock mode returns token from localStorage', async () => {
    localStorage.setItem('p1_auth_token', 'mock-token-123');

    const captured = renderMockProvider({ tokenStorageKey: 'p1_auth_token' });

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    const ctx = captured.ctx as ReturnType<typeof useP1Auth>;
    const result = await ctx.getToken();
    expect(result).toBe('mock-token-123');
  });

  it('in broker mode calls oauthSession.getToken()', async () => {
    const fakeGetToken = vi.fn().mockResolvedValue('broker-token-abc');
    const fakeSession = makeFakeOAuthSession({ getToken: fakeGetToken });
    vi.mocked(createBrokerAuth).mockReturnValue(fakeSession);

    const captured: { ctx: ReturnType<typeof useP1Auth> | null } = { ctx: null };

    render(
      <P1AuthProvider
        authMode="broker"
        p1BaseUrl="http://localhost:8787"
      >
        <AuthContextConsumer onContext={(c) => { captured.ctx = c; }} />
      </P1AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    const ctx = captured.ctx as ReturnType<typeof useP1Auth>;
    const result = await ctx.getToken();

    expect(fakeGetToken).toHaveBeenCalledTimes(1);
    expect(result).toBe('broker-token-abc');
  });

  it('in broker mode returns null and sets isSessionExpired when oauthSession.getToken() returns null', async () => {
    const fakeGetToken = vi.fn().mockResolvedValue(null);
    const fakeSession = makeFakeOAuthSession({
      getToken: fakeGetToken,
      isAuthenticated: vi.fn().mockReturnValue(true),
    });
    vi.mocked(createBrokerAuth).mockReturnValue(fakeSession);

    const captured: { ctx: ReturnType<typeof useP1Auth> | null } = { ctx: null };

    render(
      <P1AuthProvider
        authMode="broker"
        p1BaseUrl="http://localhost:8787"
      >
        <AuthContextConsumer onContext={(c) => { captured.ctx = c; }} />
      </P1AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    const ctx = captured.ctx as ReturnType<typeof useP1Auth>;

    expect(ctx.isSessionExpired).toBe(false);

    let tokenResult: string | null = 'not-called';
    await act(async () => {
      tokenResult = await ctx.getToken();
    });

    expect(tokenResult).toBeNull();

    await waitFor(() => {
      const consumer = screen.getByTestId('consumer');
      expect(consumer.getAttribute('data-session-expired')).toBe('true');
    });
  });
});

describe('isSessionExpired resets on logout', () => {
  it('isSessionExpired is false after logout', async () => {
    const fakeGetToken = vi.fn().mockResolvedValue(null);
    const fakeSession = makeFakeOAuthSession({
      getToken: fakeGetToken,
      isAuthenticated: vi.fn().mockReturnValue(true),
    });
    vi.mocked(createBrokerAuth).mockReturnValue(fakeSession);

    const captured: { ctx: ReturnType<typeof useP1Auth> | null } = { ctx: null };

    render(
      <P1AuthProvider
        authMode="broker"
        p1BaseUrl="http://localhost:8787"
      >
        <AuthContextConsumer onContext={(c) => { captured.ctx = c; }} />
      </P1AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    const ctx = captured.ctx as ReturnType<typeof useP1Auth>;

    await act(async () => {
      await ctx.getToken();
    });

    await waitFor(() => {
      const consumer = screen.getByTestId('consumer');
      expect(consumer.getAttribute('data-session-expired')).toBe('true');
    });

    await act(async () => {
      await ctx.logout();
    });

    await waitFor(() => {
      const consumer = screen.getByTestId('consumer');
      expect(consumer.getAttribute('data-session-expired')).toBe('false');
    });
  });
});
