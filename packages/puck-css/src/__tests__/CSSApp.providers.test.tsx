/**
 * Tests for <CSSApp> provider composition
 *
 * Validates that CSSApp creates CSSClient, wraps children in
 * CSSPuckProvider, and conditionally mounts FocusHighlightProvider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mutable auth state — mutated in beforeEach and individual tests
const mockAuthState = {
  isAuthenticated: false,
  isLoading: false,
  user: null as { id: string; name: string; email: string } | null,
  token: null as string | null,
  error: null as Error | null,
  authMode: 'mock' as const,
  isSessionExpired: false,
  login: vi.fn(),
  logout: vi.fn(),
  getToken: vi.fn().mockResolvedValue(null),
};

vi.mock('../auth/index', () => ({
  CSSAuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="css-auth-provider">{children}</div>
  ),
  useCSSAuth: () => mockAuthState,
  CSSLoginPage: ({ title }: { title?: string }) => (
    <div data-testid="css-login-page">{title || 'Sign in'}</div>
  ),
  DEMO_USERS: [],
}));

// Use vi.hoisted to define mocks before vi.mock hoisting
const { capturedPuckProviderProps, MockCSSClient } = vi.hoisted(() => ({
  capturedPuckProviderProps: vi.fn(),
  MockCSSClient: vi.fn().mockImplementation(() => ({})),
}));

// Capture CSSPuckProvider props for assertions
vi.mock('../CSSPuckProvider', () => ({
  CSSPuckProvider: (props: Record<string, unknown>) => {
    const { children, ...rest } = props;
    capturedPuckProviderProps(rest);
    return <div data-testid="css-puck-provider">{children as React.ReactNode}</div>;
  },
}));

// Capture FocusHighlightProvider props
vi.mock('../FocusHighlightContext', () => ({
  FocusHighlightProvider: (props: Record<string, unknown>) => {
    const { children } = props;
    return <div data-testid="focus-highlight-provider">{children as React.ReactNode}</div>;
  },
}));

vi.mock('../CSSPuckContext', () => ({
  useCSSPuck: () => ({ safeData: { content: [], root: { props: {} }, zones: {} } }),
  CSSPuckContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));
vi.mock('../PresenceContext', () => ({
  useOptionalPresenceContext: () => null,
}));

vi.mock('@pantheon/css-client', () => ({
  CSSClient: MockCSSClient,
}));

import { CSSApp } from '../CSSApp';

const baseConfig = {
  baseUrl: 'http://localhost:8787',
  siteId: 'test-site',
  authMode: 'mock' as const,
};

const fullConfig = {
  ...baseConfig,
  branchId: 'feature-branch',
  enableRealtime: true,
  wsBaseUrl: 'ws://localhost:8787',
  enablePresence: true,
  autoSaveDelay: 5000,
  maxRetries: 5,
};

function setAuthenticated() {
  mockAuthState.isAuthenticated = true;
  mockAuthState.user = { id: 'user-1', name: 'Test User', email: 'test@example.com' };
  mockAuthState.token = 'test-token';
  mockAuthState.getToken.mockResolvedValue('test-token');
}

describe('CSSApp provider composition', () => {
  beforeEach(() => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;
    mockAuthState.user = null;
    mockAuthState.token = null;
    mockAuthState.error = null;
    vi.clearAllMocks();
  });

  it('wraps children in CSSPuckProvider when authenticated', () => {
    setAuthenticated();

    render(
      <CSSApp config={baseConfig}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.getByTestId('css-puck-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('creates CSSClient with correct baseUrl and token', async () => {
    setAuthenticated();

    render(
      <CSSApp config={baseConfig}>
        <div>Hello</div>
      </CSSApp>
    );

    expect(MockCSSClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://localhost:8787',
      })
    );

    // Verify authProvider returns Bearer token
    const callArgs = MockCSSClient.mock.calls[0][0];
    expect(callArgs.authProvider).toBeDefined();
    const authHeader = await callArgs.authProvider();
    expect(authHeader).toBe('Bearer test-token');
  });

  it('passes config props to CSSPuckProvider', () => {
    setAuthenticated();

    render(
      <CSSApp config={fullConfig}>
        <div>Hello</div>
      </CSSApp>
    );

    expect(capturedPuckProviderProps).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'test-site',
        branchId: 'feature-branch',
        userId: 'user-1',
        userName: 'Test User',
        enableRealtime: true,
        wsBaseUrl: 'ws://localhost:8787',
        realtimeApiKey: 'test-token',
        presenceEnabled: true,
        autoSaveDelay: 5000,
        maxRetries: 5,
      })
    );
  });

  it('renders PresenceFocusBridge without error when enablePresence is true', () => {
    setAuthenticated();

    render(
      <CSSApp config={{ ...baseConfig, enablePresence: true }}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    // PresenceFocusBridge renders children directly (no wrapper element)
    expect(screen.getByTestId('css-puck-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('does NOT mount FocusHighlightProvider when enablePresence is false', () => {
    setAuthenticated();

    render(
      <CSSApp config={{ ...baseConfig, enablePresence: false }}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.queryByTestId('focus-highlight-provider')).not.toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('does NOT mount FocusHighlightProvider when enablePresence is undefined', () => {
    setAuthenticated();

    render(
      <CSSApp config={baseConfig}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.queryByTestId('focus-highlight-provider')).not.toBeInTheDocument();
  });

  it('does not render CSSPuckProvider when not authenticated', () => {
    render(
      <CSSApp config={baseConfig}>
        <div data-testid="child">Hello</div>
      </CSSApp>
    );

    expect(screen.queryByTestId('css-puck-provider')).not.toBeInTheDocument();
  });

  it('uses clientBaseUrl for CSSClient when provided', () => {
    setAuthenticated();

    render(
      <CSSApp config={{ ...baseConfig, clientBaseUrl: 'http://client.localhost:8787' }}>
        <div>Hello</div>
      </CSSApp>
    );

    expect(MockCSSClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://client.localhost:8787',
      })
    );
  });
});
