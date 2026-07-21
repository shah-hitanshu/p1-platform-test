/**
 * Tests for <P1App> provider composition
 *
 * Validates that P1App creates P1Client, wraps children in
 * P1PuckProvider, and conditionally mounts FocusHighlightProvider.
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
  P1AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="css-auth-provider">{children}</div>
  ),
  useP1Auth: () => mockAuthState,
  P1LoginPage: ({ title }: { title?: string }) => (
    <div data-testid="css-login-page">{title || 'Sign in'}</div>
  ),
  DEMO_USERS: [],
}));

// Use vi.hoisted to define mocks before vi.mock hoisting
const { capturedPuckProviderProps, MockP1Client } = vi.hoisted(() => ({
  capturedPuckProviderProps: vi.fn(),
  MockP1Client: vi.fn().mockImplementation(function () { return {}; }),
}));

// Capture P1PuckProvider props for assertions
vi.mock('../editor/P1PuckProvider', () => ({
  P1PuckProvider: (props: Record<string, unknown>) => {
    const { children, ...rest } = props;
    capturedPuckProviderProps(rest);
    return <div data-testid="css-puck-provider">{children as React.ReactNode}</div>;
  },
}));

// Capture FocusHighlightProvider props
vi.mock('../core/FocusHighlightContext', () => ({
  FocusHighlightProvider: (props: Record<string, unknown>) => {
    const { children } = props;
    return <div data-testid="focus-highlight-provider">{children as React.ReactNode}</div>;
  },
}));

vi.mock('../core/P1PuckContext', () => ({
  useP1Puck: () => ({ safeData: { content: [], root: { props: {} }, zones: {} } }),
  P1PuckContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));
vi.mock('../core/PresenceContext', () => ({
  useOptionalPresenceContext: () => null,
}));

vi.mock('@pantheon-systems/css-client', () => ({
  P1Client: MockP1Client,
}));

import { P1App } from '../editor/P1App';

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

describe('P1App provider composition', () => {
  beforeEach(() => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;
    mockAuthState.user = null;
    mockAuthState.token = null;
    mockAuthState.error = null;
    vi.clearAllMocks();
  });

  it('wraps children in P1PuckProvider when authenticated', () => {
    setAuthenticated();

    render(
      <P1App config={baseConfig}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.getByTestId('css-puck-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('creates P1Client with correct baseUrl and token', async () => {
    setAuthenticated();

    render(
      <P1App config={baseConfig}>
        <div>Hello</div>
      </P1App>
    );

    expect(MockP1Client).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://localhost:8787',
      })
    );

    // Verify authProvider returns Bearer token
    const callArgs = MockP1Client.mock.calls[0][0];
    expect(callArgs.authProvider).toBeDefined();
    const authHeader = await callArgs.authProvider();
    expect(authHeader).toBe('Bearer test-token');
  });

  it('passes config props to P1PuckProvider', () => {
    setAuthenticated();

    render(
      <P1App config={fullConfig}>
        <div>Hello</div>
      </P1App>
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
      <P1App config={{ ...baseConfig, enablePresence: true }}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    // PresenceFocusBridge renders children directly (no wrapper element)
    expect(screen.getByTestId('css-puck-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('does NOT mount FocusHighlightProvider when enablePresence is false', () => {
    setAuthenticated();

    render(
      <P1App config={{ ...baseConfig, enablePresence: false }}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.queryByTestId('focus-highlight-provider')).not.toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('does NOT mount FocusHighlightProvider when enablePresence is undefined', () => {
    setAuthenticated();

    render(
      <P1App config={baseConfig}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.queryByTestId('focus-highlight-provider')).not.toBeInTheDocument();
  });

  it('does not render P1PuckProvider when not authenticated', () => {
    render(
      <P1App config={baseConfig}>
        <div data-testid="child">Hello</div>
      </P1App>
    );

    expect(screen.queryByTestId('css-puck-provider')).not.toBeInTheDocument();
  });

  it('uses clientBaseUrl for P1Client when provided', () => {
    setAuthenticated();

    render(
      <P1App config={{ ...baseConfig, clientBaseUrl: 'http://client.localhost:8787' }}>
        <div>Hello</div>
      </P1App>
    );

    expect(MockP1Client).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://client.localhost:8787',
      })
    );
  });
});
