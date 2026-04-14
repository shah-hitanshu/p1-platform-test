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

vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  Spinner: ({ label, ...props }: Record<string, unknown>) => (
    <div role="status" aria-label={label as string} {...props} />
  ),
  Button: ({ label, children, onClick, disabled, isLoading, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      disabled={(disabled as boolean) || (isLoading as boolean)}
      {...props}
    >
      {(label as string) || (children as React.ReactNode)}
    </button>
  ),
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
