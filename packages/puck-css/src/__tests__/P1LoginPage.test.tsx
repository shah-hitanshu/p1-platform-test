import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const mockLogin = vi.fn();
const mockAuthState = {
  isAuthenticated: false,
  isLoading: false,
  user: null,
  token: null,
  error: null as string | null,
  authMode: 'css-authserver' as string,
  login: mockLogin,
  logout: vi.fn(),
};

vi.mock('../auth/P1AuthProvider', () => ({
  useP1Auth: () => mockAuthState,
  DEMO_USERS: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Alice Developer' },
  ],
}));

import { P1LoginPage } from '../auth/P1LoginPage';

describe('P1LoginPage with css-authserver mode', () => {
  beforeEach(() => {
    mockAuthState.isLoading = false;
    mockAuthState.error = null;
    mockAuthState.authMode = 'css-authserver';
    mockLogin.mockClear();
  });

  it('renders a Sign in button for css-authserver mode', () => {
    render(<P1LoginPage />);
    const button = screen.getByRole('button', { name: /sign in/i });
    expect(button).toBeInTheDocument();
  });

  it('calls login() when the Sign in button is clicked', () => {
    render(<P1LoginPage />);
    const button = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(button);
    expect(mockLogin).toHaveBeenCalled();
  });

  it('shows loading text when isLoading is true', () => {
    mockAuthState.isLoading = true;
    render(<P1LoginPage />);
    expect(screen.getByText(/signing in/i)).toBeInTheDocument();
  });

  it('shows P1 Auth Server label in subtitle', () => {
    render(<P1LoginPage />);
    expect(screen.getByText(/P1 Auth Server/)).toBeInTheDocument();
  });

  it('displays error message when error is present', () => {
    mockAuthState.error = 'Something went wrong';
    render(<P1LoginPage />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
