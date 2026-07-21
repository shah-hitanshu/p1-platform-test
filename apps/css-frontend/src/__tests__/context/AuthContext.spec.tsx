/**
 * AuthContext Tests (TDD - Red Phase)
 *
 * Tests for multi-provider authentication context (Google, Auth0, Mock).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../../context/AuthContext';
import { useAuth } from '../../hooks/useAuth';

// Mock the auth API module
vi.mock('../../api/auth', () => ({
  loginAsUser: vi.fn(),
}));

// Mock the client module
vi.mock('../../api/client', () => ({
  setToken: vi.fn(),
  clearToken: vi.fn(),
  getToken: vi.fn(() => null),
}));

import { loginAsUser } from '../../api/auth';
import { setToken, clearToken, getToken } from '../../api/client';

const mockedLoginAsUser = vi.mocked(loginAsUser);
const mockedSetToken = vi.mocked(setToken);
const mockedClearToken = vi.mocked(clearToken);
const mockedGetToken = vi.mocked(getToken);

/**
 * Helper component to expose auth context values for testing.
 */
function AuthConsumer({ onRender }: { onRender?: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onRender?.(auth);
  return (
    <div>
      <span data-testid="is-authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="is-loading">{String(auth.isLoading)}</span>
      <span data-testid="active-provider">{auth.activeProvider ?? 'null'}</span>
      <span data-testid="user-name">{auth.user?.name ?? 'null'}</span>
      <span data-testid="user-email">{auth.user?.email ?? 'null'}</span>
      <button data-testid="logout-btn" onClick={auth.logout}>Logout</button>
    </div>
  );
}

const USER_KEY = 'css_auth_user';
const PROVIDER_KEY = 'css_auth_provider';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('AuthProvider - initial state', () => {
  it('should start with no user and loading true, then resolve to not authenticated', async () => {
    mockedGetToken.mockReturnValue(null);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
    expect(screen.getByTestId('user-name').textContent).toBe('null');
    expect(screen.getByTestId('active-provider').textContent).toBe('null');
  });

  it('should restore session from localStorage on mount', async () => {
    const storedUser = { id: '123', email: 'alice@example.com', name: 'Alice', siteRoles: {} };
    localStorage.setItem(USER_KEY, JSON.stringify(storedUser));
    localStorage.setItem(PROVIDER_KEY, 'mock');

    // Return a non-expired mock token
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp: futureExp }));
    const fakeToken = `header.${payload}.sig`;
    mockedGetToken.mockReturnValue(fakeToken);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('Alice');
    expect(screen.getByTestId('active-provider').textContent).toBe('mock');
  });

  it('should clear expired token on mount', async () => {
    const storedUser = { id: '123', email: 'alice@example.com', name: 'Alice', siteRoles: {} };
    localStorage.setItem(USER_KEY, JSON.stringify(storedUser));
    localStorage.setItem(PROVIDER_KEY, 'mock');

    // Return an expired token
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const payload = btoa(JSON.stringify({ exp: pastExp }));
    const fakeToken = `header.${payload}.sig`;
    mockedGetToken.mockReturnValue(fakeToken);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
    expect(mockedClearToken).toHaveBeenCalled();
  });
});

describe('AuthProvider - loginWithMock', () => {
  it('should call loginAsUser and store user/token', async () => {
    const mockUser = { id: '123', email: 'alice@example.com', name: 'Alice', siteRoles: {} };
    mockedLoginAsUser.mockResolvedValue({ token: 'mock-jwt-token', user: mockUser });
    mockedGetToken.mockReturnValue(null);

    let loginWithMock: ((userId: string) => Promise<void>) | undefined;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(auth) => { loginWithMock = auth.loginWithMock; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await act(async () => {
      await loginWithMock!('123');
    });

    expect(mockedLoginAsUser).toHaveBeenCalledWith('123');
    expect(mockedSetToken).toHaveBeenCalledWith('mock-jwt-token');
    expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('Alice');
    expect(screen.getByTestId('active-provider').textContent).toBe('mock');
  });
});

describe('AuthProvider - loginWithGoogle', () => {
  it('should decode Google ID token and set user info', async () => {
    mockedGetToken.mockReturnValue(null);

    // Build a fake Google ID token
    const googlePayload = {
      sub: 'google-uid-456',
      email: 'alice@gmail.com',
      name: 'Alice G',
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const header = btoa(JSON.stringify({ alg: 'RS256' }));
    const body = btoa(JSON.stringify(googlePayload));
    const googleToken = `${header}.${body}.signature`;

    let loginWithGoogle: ((credential: string) => Promise<void>) | undefined;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(auth) => { loginWithGoogle = auth.loginWithGoogle; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await act(async () => {
      await loginWithGoogle!(googleToken);
    });

    expect(mockedSetToken).toHaveBeenCalledWith(googleToken);
    expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('Alice G');
    expect(screen.getByTestId('user-email').textContent).toBe('alice@gmail.com');
    expect(screen.getByTestId('active-provider').textContent).toBe('google');
  });

  it('should throw if Google token cannot be decoded', async () => {
    mockedGetToken.mockReturnValue(null);

    let loginWithGoogle: ((credential: string) => Promise<void>) | undefined;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(auth) => { loginWithGoogle = auth.loginWithGoogle; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await expect(
      act(async () => {
        await loginWithGoogle!('invalid-token');
      })
    ).rejects.toThrow();
  });
});

describe('AuthProvider - loginWithAuth0Token', () => {
  it('should store Auth0 token and set user from provided profile', async () => {
    mockedGetToken.mockReturnValue(null);

    const auth0Payload = {
      sub: 'auth0|789',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const header = btoa(JSON.stringify({ alg: 'RS256' }));
    const body = btoa(JSON.stringify(auth0Payload));
    const auth0Token = `${header}.${body}.signature`;

    const auth0User = {
      sub: 'auth0|789',
      email: 'alice@company.com',
      name: 'Alice Auth0',
    };

    let loginWithAuth0Token: ((token: string, profile: { sub: string; email?: string; name?: string }) => Promise<void>) | undefined;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(auth) => { loginWithAuth0Token = auth.loginWithAuth0Token; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await act(async () => {
      await loginWithAuth0Token!(auth0Token, auth0User);
    });

    expect(mockedSetToken).toHaveBeenCalledWith(auth0Token);
    expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('Alice Auth0');
    expect(screen.getByTestId('user-email').textContent).toBe('alice@company.com');
    expect(screen.getByTestId('active-provider').textContent).toBe('auth0');
  });
});

describe('AuthProvider - logout', () => {
  it('should clear token, user, and provider on logout', async () => {
    // Start authenticated
    const mockUser = { id: '123', email: 'alice@example.com', name: 'Alice', siteRoles: {} };
    mockedLoginAsUser.mockResolvedValue({ token: 'mock-token', user: mockUser });
    mockedGetToken.mockReturnValue(null);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    // Re-render with stored user
    localStorage.setItem(USER_KEY, JSON.stringify(mockUser));
    localStorage.setItem(PROVIDER_KEY, 'mock');

    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp: futureExp }));
    mockedGetToken.mockReturnValue(`h.${payload}.s`);

    // We need to re-render to pick up the stored state
    const { unmount } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      const elements = screen.getAllByTestId('is-authenticated');
      expect(elements[elements.length - 1].textContent).toBe('true');
    });

    // Click logout
    const logoutBtns = screen.getAllByTestId('logout-btn');
    await userEvent.click(logoutBtns[logoutBtns.length - 1]);

    expect(mockedClearToken).toHaveBeenCalled();

    const authElements = screen.getAllByTestId('is-authenticated');
    expect(authElements[authElements.length - 1].textContent).toBe('false');

    unmount();
  });
});

describe('AuthProvider - activeProvider tracking', () => {
  it('should set activeProvider to mock after mock login', async () => {
    const mockUser = { id: '123', email: 'alice@example.com', name: 'Alice', siteRoles: {} };
    mockedLoginAsUser.mockResolvedValue({ token: 'mock-token', user: mockUser });
    mockedGetToken.mockReturnValue(null);

    let loginWithMock: ((userId: string) => Promise<void>) | undefined;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(auth) => { loginWithMock = auth.loginWithMock; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await act(async () => {
      await loginWithMock!('123');
    });

    expect(screen.getByTestId('active-provider').textContent).toBe('mock');
  });

  it('should set activeProvider to google after Google login', async () => {
    mockedGetToken.mockReturnValue(null);

    const googlePayload = {
      sub: 'g-123',
      email: 'test@gmail.com',
      name: 'Test User',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const header = btoa(JSON.stringify({ alg: 'RS256' }));
    const body = btoa(JSON.stringify(googlePayload));
    const token = `${header}.${body}.sig`;

    let loginWithGoogle: ((credential: string) => Promise<void>) | undefined;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(auth) => { loginWithGoogle = auth.loginWithGoogle; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await act(async () => {
      await loginWithGoogle!(token);
    });

    expect(screen.getByTestId('active-provider').textContent).toBe('google');
  });

  it('should clear activeProvider on logout', async () => {
    const mockUser = { id: '123', email: 'alice@example.com', name: 'Alice', siteRoles: {} };
    mockedLoginAsUser.mockResolvedValue({ token: 'mock-token', user: mockUser });
    mockedGetToken.mockReturnValue(null);

    let loginWithMock: ((userId: string) => Promise<void>) | undefined;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(auth) => { loginWithMock = auth.loginWithMock; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await act(async () => {
      await loginWithMock!('123');
    });

    expect(screen.getByTestId('active-provider').textContent).toBe('mock');

    // Now logout
    await userEvent.click(screen.getByTestId('logout-btn'));

    expect(screen.getByTestId('active-provider').textContent).toBe('null');
  });
});
