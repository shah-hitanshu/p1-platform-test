import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

vi.mock('../../data/auth', () => ({
  getValidTokens: vi.fn(),
}));

vi.mock('../../p1/editor/user-bar', () => ({
  UserBar: () => <div data-testid="user-bar">UserBar</div>,
}));

import { AuthGate } from '../../p1/editor/auth-gate';
import { getValidTokens } from '../../data/auth';

const mockGetValidTokens = getValidTokens as ReturnType<typeof vi.fn>;

function makeTokens() {
  return {
    id_token: 'id.payload.sig',
    refresh_token: 'refresh',
    access_token: 'access.payload.sig',
    scope: 'openid',
    token_type: 'Bearer',
  };
}

describe('AuthGate', () => {
  beforeEach(() => {
    mockGetValidTokens.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing while auth check is pending', () => {
    mockGetValidTokens.mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <AuthGate><div>protected</div></AuthGate>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders children when authenticated', async () => {
    mockGetValidTokens.mockResolvedValue(makeTokens());
    render(<AuthGate><div>protected content</div></AuthGate>);
    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
  });

  it('renders "Sign in required" when not authenticated', async () => {
    mockGetValidTokens.mockResolvedValue(null);
    render(<AuthGate><div>protected</div></AuthGate>);
    await waitFor(() => {
      expect(screen.getByText('Sign in required')).toBeInTheDocument();
    });
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  it('renders UserBar when auth check completes', async () => {
    mockGetValidTokens.mockResolvedValue(null);
    render(<AuthGate><div>protected</div></AuthGate>);
    await waitFor(() => {
      expect(screen.getByTestId('user-bar')).toBeInTheDocument();
    });
  });

  it('re-checks auth when p1-auth-change event fires', async () => {
    mockGetValidTokens.mockResolvedValue(null);
    render(<AuthGate><div>protected content</div></AuthGate>);
    await waitFor(() => {
      expect(screen.getByText('Sign in required')).toBeInTheDocument();
    });

    mockGetValidTokens.mockResolvedValue(makeTokens());
    await act(async () => {
      window.dispatchEvent(new Event('p1-auth-change'));
    });

    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
  });
});
