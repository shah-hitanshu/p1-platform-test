/**
 * Tests for <P1App> component
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

// Mock the auth module — P1App imports from the barrel export
vi.mock('../auth/index', () => ({
  P1AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="css-auth-provider">{children}</div>
  ),
  useP1Auth: () => mockAuthState,
  P1LoginPage: ({ title }: { title?: string }) => (
    <div data-testid="css-login-page">{title || 'Sign in'}</div>
  ),
  DEMO_USERS: [],
}));

// Mock css-client (P1PuckProvider depends on it)
vi.mock('@pantheon-systems/css-client', () => ({
  P1Client: vi.fn(),
  createGoogleOAuth: vi.fn(),
  createAuth0OAuth: vi.fn(),
  validateToken: vi.fn(),
  loginMockUser: vi.fn(),
}));

// Mock P1PuckProvider
vi.mock('../editor/P1PuckProvider', () => ({
  P1PuckProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="css-puck-provider">{children}</div>
  ),
}));

// Mock FocusHighlightContext
vi.mock('../core/FocusHighlightContext', () => ({
  FocusHighlightProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="focus-highlight-provider">{children}</div>
  ),
}));

// Import after mocks are set up
import { P1App } from '../editor/P1App';

const testConfig = {
  baseUrl: 'http://localhost:8787',
  siteId: 'test-site',
  authMode: 'mock' as const,
};

describe('P1App', () => {
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
      <P1App config={testConfig}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.getByTestId('child')).toBeVisible();
  });

  it('shows loading fallback while loading', () => {
    mockAuthState.isLoading = true;

    render(
      <P1App
        config={testConfig}
        loadingFallback={<div data-testid="loading">Loading...</div>}
      >
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.getByTestId('loading')).toBeVisible();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('shows default loading text when no loadingFallback provided', () => {
    mockAuthState.isLoading = true;

    render(
      <P1App config={testConfig}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.getByText('Authenticating...')).toBeInTheDocument();
  });

  it('shows default login page when not authenticated', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;

    render(
      <P1App config={testConfig}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.getByTestId('css-login-page')).toBeVisible();
  });

  it('shows custom login fallback when provided', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;

    render(
      <P1App
        config={testConfig}
        loginFallback={<div data-testid="custom-login">Custom</div>}
      >
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.getByTestId('custom-login')).toBeVisible();
  });

  it('passes loginPageProps to default login page', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;

    render(
      <P1App config={testConfig} loginPageProps={{ title: 'My App' }}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.getByText('My App')).toBeVisible();
  });

  it('shows default login page when not authenticated in css-authserver mode', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;
    mockAuthState.authMode = 'css-authserver' as 'mock';

    render(
      <P1App config={{ ...testConfig, authMode: 'css-authserver' as 'mock' }}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.getByTestId('css-login-page')).toBeVisible();
  });

  it('wraps children in P1AuthProvider', () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: 'user-1', name: 'Test User', email: 'test@example.com' };
    mockAuthState.token = 'tok';

    render(
      <P1App config={testConfig}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.getByTestId('css-auth-provider')).toBeInTheDocument();
  });
});
