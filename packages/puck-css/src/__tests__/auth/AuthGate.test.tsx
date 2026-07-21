import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import type { P1AuthContextValue } from '../../auth/P1AuthProvider';

vi.mock('../../auth/P1LoginPage', () => ({
  P1LoginPage: () => <div data-testid="login-page">Login Page</div>,
}));

const mockUseOptionalP1Auth = vi.fn<() => P1AuthContextValue | null>();
vi.mock('../../auth/P1AuthProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/P1AuthProvider')>();
  return { ...actual, useOptionalP1Auth: () => mockUseOptionalP1Auth() };
});

import { AuthGate } from '../../auth/AuthGate';

function makeAuthValue(overrides: Partial<P1AuthContextValue> = {}): P1AuthContextValue {
  return {
    isAuthenticated: false,
    isLoading: false,
    user: null,
    token: null,
    error: null,
    authMode: 'broker',
    login: vi.fn(),
    logout: vi.fn(),
    getToken: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('AuthGate', () => {
  it('renders children when no P1AuthProvider is present', () => {
    mockUseOptionalP1Auth.mockReturnValue(null);
    render(
      <AuthGate>
        <div data-testid="child">Content</div>
      </AuthGate>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
  });

  it('renders nothing while auth is loading', () => {
    mockUseOptionalP1Auth.mockReturnValue(makeAuthValue({ isLoading: true }));
    const { container } = render(
      <AuthGate>
        <div data-testid="child">Content</div>
      </AuthGate>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders login page when not authenticated', () => {
    mockUseOptionalP1Auth.mockReturnValue(makeAuthValue({ isAuthenticated: false }));
    render(
      <AuthGate>
        <div data-testid="child">Content</div>
      </AuthGate>,
    );
    expect(screen.getByTestId('login-page')).toBeDefined();
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('renders children when authenticated', () => {
    mockUseOptionalP1Auth.mockReturnValue(
      makeAuthValue({
        isAuthenticated: true,
        user: { id: 'u1', name: 'Test' },
        token: 'tok',
      }),
    );
    render(
      <AuthGate>
        <div data-testid="child">Content</div>
      </AuthGate>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.queryByTestId('login-page')).toBeNull();
  });
});
