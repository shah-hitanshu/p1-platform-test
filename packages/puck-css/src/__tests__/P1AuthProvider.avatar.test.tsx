/**
 * Tests that P1AuthProvider propagates the `picture` field from
 * oauthSession.getUserInfo() into the AuthUser context when authenticating
 * via broker mode.
 *
 * The broker access token is validated by the backend. `P1AuthProvider`
 * must merge the avatar URL into `user.picture` for the account avatar
 * in P1EditorHeader to be able to render it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

function CaptureAuthUser({
  onUser,
}: {
  onUser: (user: ReturnType<typeof useP1Auth>['user']) => void;
}) {
  const { user } = useP1Auth();
  onUser(user);
  return <div data-testid="consumer" data-picture={user?.picture ?? ''} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(validateToken).mockResolvedValue(null);
  vi.mocked(createBrokerAuth).mockReturnValue(makeFakeOAuthSession());
});

describe('P1AuthProvider — avatar picture from oauth getUserInfo', () => {
  it('sets user.picture from validateToken() avatarUrl when existing oauth session is authenticated', async () => {
    const fakeSession = makeFakeOAuthSession({
      isAuthenticated: vi.fn().mockReturnValue(true),
      getToken: vi.fn().mockResolvedValue('access-token-abc'),
      getUserInfo: vi.fn().mockReturnValue(null),
    });
    vi.mocked(createBrokerAuth).mockReturnValue(fakeSession);
    vi.mocked(validateToken).mockResolvedValue({
      id: 'user-1',
      type: 'user',
      email: 'user@example.com',
      avatarUrl: 'https://lh3.googleusercontent.com/photo.jpg',
    });

    let capturedUser: ReturnType<typeof useP1Auth>['user'] = null;
    render(
      <P1AuthProvider
        authMode="broker"
        p1BaseUrl="http://localhost:8787"
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
    vi.mocked(createBrokerAuth).mockReturnValue(fakeSession);
    vi.mocked(validateToken).mockResolvedValue({
      id: 'user-1',
      type: 'user',
      email: 'user@example.com',
    });

    let capturedUser: ReturnType<typeof useP1Auth>['user'] = null;
    render(
      <P1AuthProvider
        authMode="broker"
        p1BaseUrl="http://localhost:8787"
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
    vi.mocked(createBrokerAuth).mockReturnValue(fakeSession);
    vi.mocked(validateToken).mockResolvedValue({
      id: 'user-2',
      type: 'user',
      email: 'nopic@example.com',
    });

    let capturedUser: ReturnType<typeof useP1Auth>['user'] = null;
    render(
      <P1AuthProvider
        authMode="broker"
        p1BaseUrl="http://localhost:8787"
      >
        <CaptureAuthUser onUser={(u) => { capturedUser = u; }} />
      </P1AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(capturedUser).not.toBeNull();
    });

    expect((capturedUser as NonNullable<typeof capturedUser>).picture).toBeUndefined();
  });
});
