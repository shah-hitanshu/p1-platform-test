/**
 * Auth0CallbackHandler Tests (TDD - Red Phase)
 *
 * Tests for the Auth0 redirect callback handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Auth0CallbackHandler } from '../../../components/auth/Auth0CallbackHandler';

// Mock @auth0/auth0-react
const mockGetAccessTokenSilently = vi.fn();
const mockGetUser = vi.fn();
let mockIsAuthenticated = false;
let mockIsLoading = false;

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    isAuthenticated: mockIsAuthenticated,
    isLoading: mockIsLoading,
    getAccessTokenSilently: mockGetAccessTokenSilently,
    user: mockGetUser(),
  }),
}));

// Mock useAuth
const mockLoginWithAuth0Token = vi.fn();
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    loginWithAuth0Token: mockLoginWithAuth0Token,
    isAuthenticated: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthenticated = false;
  mockIsLoading = false;
  mockGetUser.mockReturnValue(undefined);
});

describe('Auth0CallbackHandler', () => {
  it('should not call loginWithAuth0Token when Auth0 is not authenticated', () => {
    mockIsAuthenticated = false;

    render(<Auth0CallbackHandler />);

    expect(mockLoginWithAuth0Token).not.toHaveBeenCalled();
  });

  it('should call loginWithAuth0Token when Auth0 authentication completes', async () => {
    mockIsAuthenticated = true;
    mockGetAccessTokenSilently.mockResolvedValue('auth0-access-token');
    mockGetUser.mockReturnValue({
      sub: 'auth0|123',
      email: 'alice@company.com',
      name: 'Alice Auth0',
    });

    render(<Auth0CallbackHandler />);

    await vi.waitFor(() => {
      expect(mockGetAccessTokenSilently).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(mockLoginWithAuth0Token).toHaveBeenCalledWith(
        'auth0-access-token',
        { sub: 'auth0|123', email: 'alice@company.com', name: 'Alice Auth0' },
      );
    });
  });

  it('should not call loginWithAuth0Token while Auth0 is still loading', () => {
    mockIsLoading = true;
    mockIsAuthenticated = false;

    render(<Auth0CallbackHandler />);

    expect(mockLoginWithAuth0Token).not.toHaveBeenCalled();
  });
});
