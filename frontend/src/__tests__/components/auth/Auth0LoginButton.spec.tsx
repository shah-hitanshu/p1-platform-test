/**
 * Auth0LoginButton Tests (TDD - Red Phase)
 *
 * Tests for the Auth0 login button component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Auth0LoginButton } from '../../../components/auth/Auth0LoginButton';

// Mock @auth0/auth0-react
const mockLoginWithRedirect = vi.fn();
vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    loginWithRedirect: mockLoginWithRedirect,
    isLoading: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Auth0LoginButton', () => {
  it('should render the Auth0 login button', () => {
    render(<Auth0LoginButton />);

    const button = screen.getByTestId('auth0-login-button');
    expect(button).toBeInTheDocument();
  });

  it('should call loginWithRedirect when clicked', async () => {
    const user = userEvent.setup();

    render(<Auth0LoginButton />);

    const button = screen.getByTestId('auth0-login-button');
    await user.click(button);

    expect(mockLoginWithRedirect).toHaveBeenCalled();
  });
});
