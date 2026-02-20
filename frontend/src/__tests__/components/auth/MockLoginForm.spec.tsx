/**
 * MockLoginForm Tests (TDD - Red Phase)
 *
 * Tests for the extracted mock login form component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockLoginForm } from '../../../components/auth/MockLoginForm';

// Mock useAuth
const mockLoginWithMock = vi.fn();
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    loginWithMock: mockLoginWithMock,
  }),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MockLoginForm', () => {
  it('should render the user select dropdown', () => {
    render(<MockLoginForm />);

    expect(screen.getByTestId('user-select')).toBeInTheDocument();
  });

  it('should render mock user options', () => {
    render(<MockLoginForm />);

    const select = screen.getByTestId('user-select') as HTMLSelectElement;
    // Should have a placeholder + 3 mock users
    expect(select.options.length).toBeGreaterThanOrEqual(4);
  });

  it('should show user preview when a user is selected', async () => {
    const user = userEvent.setup();

    render(<MockLoginForm />);

    const select = screen.getByTestId('user-select');
    await user.selectOptions(select, '11111111-1111-1111-1111-111111111111');

    expect(screen.getByTestId('user-preview')).toBeInTheDocument();
    expect(screen.getByTestId('preview-name')).toHaveTextContent('Alice Developer');
  });

  it('should call loginWithMock with selected userId on form submit', async () => {
    const user = userEvent.setup();
    mockLoginWithMock.mockResolvedValue(undefined);

    render(<MockLoginForm />);

    const select = screen.getByTestId('user-select');
    await user.selectOptions(select, '11111111-1111-1111-1111-111111111111');

    const loginButton = screen.getByTestId('login-button');
    await user.click(loginButton);

    expect(mockLoginWithMock).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('should navigate to dashboard on successful login', async () => {
    const user = userEvent.setup();
    mockLoginWithMock.mockResolvedValue(undefined);

    render(<MockLoginForm />);

    const select = screen.getByTestId('user-select');
    await user.selectOptions(select, '11111111-1111-1111-1111-111111111111');

    const loginButton = screen.getByTestId('login-button');
    await user.click(loginButton);

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('should show error on login failure', async () => {
    const user = userEvent.setup();
    mockLoginWithMock.mockRejectedValue(new Error('Login failed'));

    render(<MockLoginForm />);

    const select = screen.getByTestId('user-select');
    await user.selectOptions(select, '11111111-1111-1111-1111-111111111111');

    const loginButton = screen.getByTestId('login-button');
    await user.click(loginButton);

    await vi.waitFor(() => {
      expect(screen.getByTestId('login-error')).toBeInTheDocument();
    });
  });

  it('should disable login button when no user is selected', () => {
    render(<MockLoginForm />);

    const loginButton = screen.getByTestId('login-button');
    expect(loginButton).toBeDisabled();
  });
});
