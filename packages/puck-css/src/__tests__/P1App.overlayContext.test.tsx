/**
 * The editor root has to supply the overlay context PDS overlays read, so that a `Modal`
 * rendered anywhere below it — by editor chrome, by a plugin, or by a consumer's own
 * children — works on the PDS versions the peer range still admits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Modal } from '@pantheon-systems/pds-toolkit-react';

const mockAuthState = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' } as
    | { id: string; name: string; email: string }
    | null,
  token: 'test-token' as string | null,
  error: null as Error | null,
  authMode: 'mock' as const,
  isSessionExpired: false,
  login: vi.fn(),
  logout: vi.fn(),
  getToken: vi.fn().mockResolvedValue('test-token'),
};

vi.mock('../auth/index', () => ({
  P1AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useP1Auth: () => mockAuthState,
  P1LoginPage: () => <div data-testid="css-login-page">Sign in</div>,
  DEMO_USERS: [],
}));

vi.mock('../editor/P1PuckProvider', () => ({
  P1PuckProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../core/P1PuckContext', () => ({
  useP1Puck: () => ({ safeData: { content: [], root: { props: {} }, zones: {} } }),
  P1PuckContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));
vi.mock('../core/PresenceContext', () => ({ useOptionalPresenceContext: () => null }));
vi.mock('@pantheon-systems/css-client', () => ({
  P1Client: vi.fn().mockImplementation(function () { return {}; }),
}));

import { P1App } from '../editor/P1App';

const config = {
  baseUrl: 'http://localhost:8787',
  siteId: 'test-site',
  authMode: 'mock' as const,
};

describe('P1App and the PDS overlay context', () => {
  beforeEach(() => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: 'user-1', name: 'Test User', email: 'test@example.com' };
    mockAuthState.token = 'test-token';
  });

  it('lets children open an overlay without supplying a provider themselves', () => {
    render(
      <P1App config={config}>
        <Modal title="Preview">body</Modal>
      </P1App>,
    );

    expect(screen.getByRole('dialog', { name: 'Preview' })).toBeTruthy();
  });

  it('still covers children while signed out, when the login page is what renders', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.user = null;
    mockAuthState.token = null;

    render(
      <P1App config={config} loginFallback={<Modal title="Sign in first">body</Modal>}>
        <div />
      </P1App>,
    );

    expect(screen.getByRole('dialog', { name: 'Sign in first' })).toBeTruthy();
  });
});
