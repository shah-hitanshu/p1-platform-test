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
  InlineMessage: ({ title, children, ...props }: Record<string, unknown>) => (
    <div role="alert" {...props}>{(title as string)}{(children as React.ReactNode)}</div>
  ),
  StatusBadge: ({ label, children, ...props }: Record<string, unknown>) => (
    <span {...props}>{(label as string) || (children as React.ReactNode)}</span>
  ),
  Select: ({ label, value, options, onOptionSelect, disabled, showLabel, id, ...props }: Record<string, unknown>) => (
    <div>
      {(showLabel !== false) && <label htmlFor={id as string}>{label as string}</label>}
      <select
        id={id as string}
        value={value as string}
        onChange={(e) => (onOptionSelect as (opt: { label: string; value: string }) => void)?.({ label: e.target.value, value: e.target.value })}
        disabled={disabled as boolean}
        {...props}
      >
        <option value="">Select an option</option>
        {((options as Array<{ label: string; value: string }>) ?? []).map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  ),
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
