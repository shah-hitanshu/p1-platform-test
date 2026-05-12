/**
 * Tests that P1AuthProvider propagates the `picture` field from
 * oauthSession.getUserInfo() into the AuthUser context when authenticating
 * via css-authserver mode.
 *
 * The css-authserver access token is a JWT issued by the auth server. The
 * `createP1AuthServerOAuth` session parses the JWT and exposes `picture`
 * via `getUserInfo()`. `P1AuthProvider` must merge this into `user.picture`
 * for the account avatar in P1EditorHeader to be able to render it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Module-level mocks — declared before any imports of the modules under test
// ---------------------------------------------------------------------------

vi.mock('@pantheon-systems/css-client', () => ({
  createP1AuthServerOAuth: vi.fn(),
  createGoogleOAuth: vi.fn(),
  createAuth0OAuth: vi.fn(),
  validateToken: vi.fn().mockResolvedValue(null),
  loginMockUser: vi.fn(),
}));

import {
  createP1AuthServerOAuth,
  validateToken,
} from '@pantheon-systems/css-client';

import { P1AuthProvider, useP1Auth } from '../auth/P1AuthProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeOAuthSession(overrides: Partial<{
  getToken: ReturnType<typeof vi.fn>;
  isAuthenticated: ReturnType<typeof vi.fn>;
  getUserInfo: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  handleCallback: ReturnType<typeof vi.fn>;
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

function CaptureAuthUser({
  onUser,
}: {
  onUser: (user: ReturnType<typeof useP1Auth>['user']) => void;
}) {
  const { user } = useP1Auth();
  onUser(user);
  return <div data-testid="consumer" data-picture={user?.picture ?? ''} />;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(validateToken).mockResolvedValue(null);
  vi.mocked(createP1AuthServerOAuth).mockReturnValue(makeFakeOAuthSession());
});

describe('P1AuthProvider — avatar picture from oauth getUserInfo', () => {
  it('sets user.picture from validateToken() avatarUrl when existing oauth session is authenticated', async () => {
    const fakeSession = makeFakeOAuthSession({
      isAuthenticated: vi.fn().mockReturnValue(true),
      getToken: vi.fn().mockResolvedValue('access-token-abc'),
      getUserInfo: vi.fn().mockReturnValue(null),
    });
    vi.mocked(createP1AuthServerOAuth).mockReturnValue(fakeSession);
    vi.mocked(validateToken).mockResolvedValue({
      id: 'user-1',
      type: 'user',
      email: 'user@example.com',
      avatarUrl: 'https://lh3.googleusercontent.com/photo.jpg',
    });

    let capturedUser: ReturnType<typeof useP1Auth>['user'] = null;
    render(
      <P1AuthProvider
        authMode="css-authserver"
        p1BaseUrl="http://localhost:8787"
        p1AuthServerUrl="https://auth.example.com"
        siteId="site-1"
      >
        <CaptureAuthUser onUser={(u) => { capturedUser = u; }} />
      </P1AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consumer').getAttribute('data-picture')).toBe(
        'https://lh3.googleusercontent.com/photo.jpg',
      );
    });

    expect(capturedUser).not.toBeNull();
    expect((capturedUser as NonNullable<typeof capturedUser>).picture).toBe('https://lh3.googleusercontent.com/photo.jpg');
  });

  it('falls back to getUserInfo().picture when validateToken() returns no avatarUrl', async () => {
    const fakeSession = makeFakeOAuthSession({
      isAuthenticated: vi.fn().mockReturnValue(true),
      getToken: vi.fn().mockResolvedValue('access-token-abc'),
      getUserInfo: vi.fn().mockReturnValue({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        picture: 'https://lh3.googleusercontent.com/fallback.jpg',
      }),
    });
    vi.mocked(createP1AuthServerOAuth).mockReturnValue(fakeSession);
    vi.mocked(validateToken).mockResolvedValue({
      id: 'user-1',
      type: 'user',
      email: 'user@example.com',
      // no avatarUrl
    });

    let capturedUser: ReturnType<typeof useP1Auth>['user'] = null;
    render(
      <P1AuthProvider
        authMode="css-authserver"
        p1BaseUrl="http://localhost:8787"
        p1AuthServerUrl="https://auth.example.com"
        siteId="site-1"
      >
        <CaptureAuthUser onUser={(u) => { capturedUser = u; }} />
      </P1AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consumer').getAttribute('data-picture')).toBe(
        'https://lh3.googleusercontent.com/fallback.jpg',
      );
    });

    expect(capturedUser).not.toBeNull();
    expect((capturedUser as NonNullable<typeof capturedUser>).picture).toBe('https://lh3.googleusercontent.com/fallback.jpg');
  });

  it('sets user.picture to undefined when getUserInfo() returns no picture', async () => {
    const fakeSession = makeFakeOAuthSession({
      isAuthenticated: vi.fn().mockReturnValue(true),
      getToken: vi.fn().mockResolvedValue('access-token-def'),
      getUserInfo: vi.fn().mockReturnValue({
        id: 'user-2',
        email: 'nopic@example.com',
        name: 'No Pic User',
        picture: undefined,
      }),
    });
    vi.mocked(createP1AuthServerOAuth).mockReturnValue(fakeSession);
    vi.mocked(validateToken).mockResolvedValue({
      id: 'user-2',
      type: 'user',
      email: 'nopic@example.com',
    });

    let capturedUser: ReturnType<typeof useP1Auth>['user'] = null;
    render(
      <P1AuthProvider
        authMode="css-authserver"
        p1BaseUrl="http://localhost:8787"
        p1AuthServerUrl="https://auth.example.com"
        siteId="site-1"
      >
        <CaptureAuthUser onUser={(u) => { capturedUser = u; }} />
      </P1AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    // Wait for loading to settle
    await waitFor(() => {
      expect(capturedUser).not.toBeNull();
    });

    expect((capturedUser as NonNullable<typeof capturedUser>).picture).toBeUndefined();
  });
});
