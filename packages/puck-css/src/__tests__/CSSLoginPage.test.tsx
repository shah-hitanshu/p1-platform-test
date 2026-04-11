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

vi.mock('../auth/CSSAuthProvider', () => ({
  useCSSAuth: () => mockAuthState,
  DEMO_USERS: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Alice Developer' },
  ],
}));

import { CSSLoginPage } from '../auth/CSSLoginPage';

describe('CSSLoginPage with css-authserver mode', () => {
  beforeEach(() => {
    mockAuthState.isLoading = false;
    mockAuthState.error = null;
    mockAuthState.authMode = 'css-authserver';
    mockLogin.mockClear();
  });

  it('renders a Sign in button for css-authserver mode', () => {
    render(<CSSLoginPage />);
    const button = screen.getByRole('button', { name: /sign in/i });
    expect(button).toBeInTheDocument();
  });

  it('calls login() when the Sign in button is clicked', () => {
    render(<CSSLoginPage />);
    const button = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(button);
    expect(mockLogin).toHaveBeenCalled();
  });

  it('shows loading text when isLoading is true', () => {
    mockAuthState.isLoading = true;
    render(<CSSLoginPage />);
    expect(screen.getByText(/signing in/i)).toBeInTheDocument();
  });

  it('shows CSS Auth Server label in subtitle', () => {
    render(<CSSLoginPage />);
    expect(screen.getByText(/CSS Auth Server/)).toBeInTheDocument();
  });

  it('displays error message when error is present', () => {
    mockAuthState.error = 'Something went wrong';
    render(<CSSLoginPage />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
