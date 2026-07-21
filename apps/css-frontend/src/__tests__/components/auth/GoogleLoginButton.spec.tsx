/**
 * GoogleLoginButton Tests (TDD - Red Phase)
 *
 * Tests for the Google OAuth login button component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GoogleLoginButton } from '../../../components/auth/GoogleLoginButton';

// Mock @react-oauth/google
vi.mock('@react-oauth/google', () => ({
  GoogleLogin: (props: {
    onSuccess: (response: { credential: string }) => void;
    onError: () => void;
    text?: string;
  }) => (
    <button
      data-testid="google-login-mock"
      onClick={() => props.onSuccess({ credential: 'fake-google-credential' })}
    >
      Sign in with Google
    </button>
  ),
}));

// Mock useAuth
const mockLoginWithGoogle = vi.fn();
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    loginWithGoogle: mockLoginWithGoogle,
  }),
}));

vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  Spinner: ({ label, ...props }: Record<string, unknown>) => (
    <div role="status" aria-label={label as string} {...props} />
  ),
  InlineMessage: ({ title, children, ...props }: Record<string, unknown>) => (
    <div role="alert" {...props}>{(title as string)}{(children as React.ReactNode)}</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GoogleLoginButton', () => {
  it('should render the Google login button', () => {
    render(<GoogleLoginButton />);

    expect(screen.getByTestId('google-login-mock')).toBeInTheDocument();
  });

  it('should call loginWithGoogle on successful authentication', async () => {
    mockLoginWithGoogle.mockResolvedValue(undefined);

    render(<GoogleLoginButton />);

    const button = screen.getByTestId('google-login-mock');
    button.click();

    expect(mockLoginWithGoogle).toHaveBeenCalledWith('fake-google-credential');
  });

  it('should display error message on login failure', async () => {
    mockLoginWithGoogle.mockRejectedValue(new Error('Token validation failed'));

    render(<GoogleLoginButton />);

    const button = screen.getByTestId('google-login-mock');
    button.click();

    // Wait for async error handling
    await vi.waitFor(() => {
      expect(screen.getByTestId('google-login-error')).toBeInTheDocument();
    });
  });
});
