/**
 * Tests for silent token refresh feature in CSSAuthProvider.
 *
 * Validates:
 * - isSessionExpired is exposed in context, defaulting to false
 * - getToken is exposed in context as a function
 * - getToken returns token from localStorage in mock mode
 * - getToken delegates to oauthSession.getToken() in css-authserver mode
 * - getToken returns null and sets isSessionExpired when oauth token refresh fails
 * - isSessionExpired resets to false after logout
 *
 * NOTE: This is the TDD red-phase test file. The isSessionExpired and getToken
 * fields do not yet exist on CSSAuthContextValue. These tests are expected to
 * fail until the implementation is added.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Module-level mocks — declared before any imports of the modules under test
// ---------------------------------------------------------------------------

vi.mock('@pantheon-systems/css-client', () => ({
  createCSSAuthServerOAuth: vi.fn(),
  createGoogleOAuth: vi.fn(),
  createAuth0OAuth: vi.fn(),
  validateToken: vi.fn().mockResolvedValue(null),
  loginMockUser: vi.fn(),
}));

// Import mocked helpers after mock declarations
import {
  createCSSAuthServerOAuth,
  validateToken,
} from '@pantheon-systems/css-client';

// Import the module under test after mocks are in place
import { CSSAuthProvider, useCSSAuth } from '../auth/CSSAuthProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a complete fake OAuthSession suitable for css-authserver mode. */
function makeFakeOAuthSession(overrides: Partial<{
  getToken: ReturnType<typeof vi.fn>;
  isAuthenticated: ReturnType<typeof vi.fn>;
  getUserInfo: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  handleCallback: ReturnType<typeof vi.fn>;
  renderButton: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    provider: 'css-authserver' as const,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: vi.fn().mockReturnValue(false),
    getUserInfo: vi.fn().mockReturnValue(null),
    getToken: vi.fn().mockResolvedValue(null),
    handleCallback: vi.fn().mockResolvedValue(undefined),
    renderButton: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

/** Consumer component that reads the full auth context and exposes values via data attributes. */
function AuthContextConsumer({
  onContext,
}: {
  onContext: (ctx: ReturnType<typeof useCSSAuth>) => void;
}) {
  const ctx = useCSSAuth();
  onContext(ctx);
  return (
    <div
      data-testid="consumer"
      data-session-expired={String(ctx.isSessionExpired)}
      data-has-get-token={typeof ctx.getToken === 'function' ? 'true' : 'false'}
    />
  );
}

/** Render a CSSAuthProvider in mock mode and return captured context values. */
function renderMockProvider(props: Partial<Parameters<typeof CSSAuthProvider>[0]> = {}) {
  const captured: { ctx: ReturnType<typeof useCSSAuth> | null } = { ctx: null };

  render(
    <CSSAuthProvider
      authMode="mock"
      cssBaseUrl="http://localhost:8787"
      tokenStorageKey="css_auth_token"
      {...props}
    >
      <AuthContextConsumer onContext={(c) => { captured.ctx = c; }} />
    </CSSAuthProvider>,
  );

  return captured;
}

// ---------------------------------------------------------------------------
// beforeEach: reset mocks and localStorage between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  // Default validateToken: returns null (no valid stored token)
  vi.mocked(validateToken).mockResolvedValue(null);

  // Default createCSSAuthServerOAuth: returns a session that is not authenticated
  vi.mocked(createCSSAuthServerOAuth).mockReturnValue(makeFakeOAuthSession());
});

// ---------------------------------------------------------------------------
// Group 1: isSessionExpired in CSSAuthContextValue
// ---------------------------------------------------------------------------

describe('CSSAuthProvider isSessionExpired', () => {
  it('exposes isSessionExpired in context, defaulting to false', async () => {
    const captured = renderMockProvider();

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    expect(captured.ctx).not.toBeNull();
    // isSessionExpired must exist and default to false
    expect((captured.ctx as ReturnType<typeof useCSSAuth>).isSessionExpired).toBe(false);
  });

  it('exposes getToken function in context', async () => {
    const captured = renderMockProvider();

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    expect(captured.ctx).not.toBeNull();
    expect(typeof (captured.ctx as ReturnType<typeof useCSSAuth>).getToken).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Group 2: getToken behavior
// ---------------------------------------------------------------------------

describe('getToken behavior', () => {
  it('in mock mode returns token from localStorage', async () => {
    localStorage.setItem('css_auth_token', 'mock-token-123');

    const captured = renderMockProvider({ tokenStorageKey: 'css_auth_token' });

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    const ctx = captured.ctx as ReturnType<typeof useCSSAuth>;
    const result = await ctx.getToken();
    expect(result).toBe('mock-token-123');
  });

  it('in css-authserver mode calls oauthSession.getToken()', async () => {
    const fakeGetToken = vi.fn().mockResolvedValue('oauth-token-abc');
    const fakeSession = makeFakeOAuthSession({ getToken: fakeGetToken });
    vi.mocked(createCSSAuthServerOAuth).mockReturnValue(fakeSession);

    const captured: { ctx: ReturnType<typeof useCSSAuth> | null } = { ctx: null };

    render(
      <CSSAuthProvider
        authMode="css-authserver"
        cssBaseUrl="http://localhost:8787"
        cssAuthServerUrl="https://auth.example.com"
        siteId="site-1"
      >
        <AuthContextConsumer onContext={(c) => { captured.ctx = c; }} />
      </CSSAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    const ctx = captured.ctx as ReturnType<typeof useCSSAuth>;
    const result = await ctx.getToken();

    expect(fakeGetToken).toHaveBeenCalledTimes(1);
    expect(result).toBe('oauth-token-abc');
  });

  it('in css-authserver mode returns null and sets isSessionExpired when oauthSession.getToken() returns null', async () => {
    const fakeGetToken = vi.fn().mockResolvedValue(null);
    const fakeSession = makeFakeOAuthSession({
      getToken: fakeGetToken,
      // Simulate an authenticated session that then fails to refresh
      isAuthenticated: vi.fn().mockReturnValue(true),
    });
    vi.mocked(createCSSAuthServerOAuth).mockReturnValue(fakeSession);
    // validateToken won't be reached since getToken returns null — keep default null

    const captured: { ctx: ReturnType<typeof useCSSAuth> | null } = { ctx: null };

    render(
      <CSSAuthProvider
        authMode="css-authserver"
        cssBaseUrl="http://localhost:8787"
        cssAuthServerUrl="https://auth.example.com"
        siteId="site-1"
      >
        <AuthContextConsumer onContext={(c) => { captured.ctx = c; }} />
      </CSSAuthProvider>,
    );

    // Wait for the initial auth check to settle
    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    const ctx = captured.ctx as ReturnType<typeof useCSSAuth>;

    // isSessionExpired must start as false
    expect(ctx.isSessionExpired).toBe(false);

    // Call getToken — it should return null and trigger the expiry side-effect
    let tokenResult: string | null = 'not-called';
    await act(async () => {
      tokenResult = await ctx.getToken();
    });

    expect(tokenResult).toBeNull();

    // After the failed refresh, isSessionExpired must become true
    await waitFor(() => {
      const consumer = screen.getByTestId('consumer');
      expect(consumer.getAttribute('data-session-expired')).toBe('true');
    });
  });
});

// ---------------------------------------------------------------------------
// Group 3: isSessionExpired resets on logout
// ---------------------------------------------------------------------------

describe('isSessionExpired resets on logout', () => {
  it('isSessionExpired is false after logout', async () => {
    const fakeGetToken = vi.fn().mockResolvedValue(null);
    const fakeSession = makeFakeOAuthSession({
      getToken: fakeGetToken,
      isAuthenticated: vi.fn().mockReturnValue(true),
    });
    vi.mocked(createCSSAuthServerOAuth).mockReturnValue(fakeSession);

    const captured: { ctx: ReturnType<typeof useCSSAuth> | null } = { ctx: null };

    render(
      <CSSAuthProvider
        authMode="css-authserver"
        cssBaseUrl="http://localhost:8787"
        cssAuthServerUrl="https://auth.example.com"
        siteId="site-1"
      >
        <AuthContextConsumer onContext={(c) => { captured.ctx = c; }} />
      </CSSAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    const ctx = captured.ctx as ReturnType<typeof useCSSAuth>;

    // Trigger session expiry by calling getToken when it returns null
    await act(async () => {
      await ctx.getToken();
    });

    // Confirm isSessionExpired became true before we reset
    await waitFor(() => {
      const consumer = screen.getByTestId('consumer');
      expect(consumer.getAttribute('data-session-expired')).toBe('true');
    });

    // Now call logout — isSessionExpired should be cleared
    await act(async () => {
      await ctx.logout();
    });

    await waitFor(() => {
      const consumer = screen.getByTestId('consumer');
      expect(consumer.getAttribute('data-session-expired')).toBe('false');
    });
  });
});
