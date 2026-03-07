/**
 * Tests for <CSSApp> component
 *
 * Validates authentication gating, loading states,
 * and provider composition behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mutable auth state object — mutated in beforeEach and individual tests
const mockAuthState = {
  isAuthenticated: false,
  isLoading: false,
  user: null as { id: string; name: string; email: string } | null,
  token: null as string | null,
  error: null as Error | null,
  authMode: 'mock' as const,
  login: vi.fn(),
  logout: vi.fn(),
};

// Mock the auth module — CSSApp will use these internally
vi.mock('../auth/CSSAuthProvider', () => ({
  CSSAuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="css-auth-provider">{children}</div>
  ),
  useCSSAuth: () => mockAuthState,
  CSSLoginPage: ({ title }: { title?: string }) => (
    <div data-testid="css-login-page">{title || 'Sign in'}</div>
  ),
  DEMO_USERS: [],
}));

// Mock css-client (CSSPuckProvider depends on it)
vi.mock('@pantheon/css-client', () => ({
  CSSClient: vi.fn(),
  createGoogleOAuth: vi.fn(),
  createAuth0OAuth: vi.fn(),
  validateToken: vi.fn(),
  loginMockUser: vi.fn(),
}));

// Mock CSSPuckProvider
vi.mock('../CSSPuckProvider', () => ({
  CSSPuckProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="css-puck-provider">{children}</div>
  ),
}));

// Mock FocusHighlightContext
vi.mock('../FocusHighlightContext', () => ({
  FocusHighlightProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="focus-highlight-provider">{children}</div>
  ),
}));

// Import after mocks are set up
import { CSSApp } from '../CSSApp';

const testConfig = {
  baseUrl: 'http://localhost:8787',
  siteId: 'test-site',
  authMode: 'mock' as const,
};

describe('CSSApp', () => {
  beforeEach(() => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;
    mockAuthState.user = null;
    mockAuthState.token = null;
    mockAuthState.error = null;
    vi.clearAllMocks();
  });

  it('renders children when authenticated', () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: 'user-1', name: 'Test User', email: 'test@example.com' };
    mockAuthState.token = 'tok';

    render(
      <CSSApp config={testConfig}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.getByTestId('child')).toBeVisible();
  });

  it('shows loading fallback while loading', () => {
    mockAuthState.isLoading = true;

    render(
      <CSSApp
        config={testConfig}
        loadingFallback={<div data-testid="loading">Loading...</div>}
      >
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.getByTestId('loading')).toBeVisible();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('shows default loading text when no loadingFallback provided', () => {
    mockAuthState.isLoading = true;

    render(
      <CSSApp config={testConfig}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.getByText('Authenticating...')).toBeInTheDocument();
  });

  it('shows default login page when not authenticated', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;

    render(
      <CSSApp config={testConfig}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.getByTestId('css-login-page')).toBeVisible();
  });

  it('shows custom login fallback when provided', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;

    render(
      <CSSApp
        config={testConfig}
        loginFallback={<div data-testid="custom-login">Custom</div>}
      >
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.getByTestId('custom-login')).toBeVisible();
  });

  it('passes loginPageProps to default login page', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;

    render(
      <CSSApp config={testConfig} loginPageProps={{ title: 'My App' }}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.getByText('My App')).toBeVisible();
  });

  it('wraps children in CSSAuthProvider', () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: 'user-1', name: 'Test User', email: 'test@example.com' };
    mockAuthState.token = 'tok';

    render(
      <CSSApp config={testConfig}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.getByTestId('css-auth-provider')).toBeInTheDocument();
  });
});
