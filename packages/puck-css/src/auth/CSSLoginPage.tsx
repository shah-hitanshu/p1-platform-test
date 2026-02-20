/**
 * CSSLoginPage
 *
 * Default login page component for CSS auth integration.
 * This is a convenience component — consumers can build their own login UI
 * using the useCSSAuth() hook instead.
 *
 * Renders login UI appropriate for the current auth mode:
 * - mock: Demo user dropdown selector
 * - google: "Sign in with Google" button
 * - auth0: "Sign in with Auth0" button
 */

import React, { useState } from 'react';
import { useCSSAuth, DEMO_USERS } from './CSSAuthProvider.js';
import type { AuthMode } from './CSSAuthProvider.js';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  background: '#f5f5f5',
};

const cardStyle: React.CSSProperties = {
  background: 'white',
  borderRadius: '12px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
  padding: '40px',
  maxWidth: '400px',
  width: '100%',
  textAlign: 'center',
};

const titleStyle: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 600,
  marginBottom: '8px',
  color: '#1a1a1a',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#666',
  marginBottom: '32px',
};

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 500,
  borderRadius: '8px',
  border: 'none',
  cursor: 'pointer',
  width: '100%',
  transition: 'background 0.2s',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  fontSize: '16px',
  borderRadius: '8px',
  border: '1px solid #ddd',
  background: 'white',
  cursor: 'pointer',
  marginBottom: '16px',
};

const errorStyle: React.CSSProperties = {
  color: '#dc3545',
  fontSize: '14px',
  marginTop: '16px',
  padding: '8px 12px',
  background: '#fff0f0',
  borderRadius: '6px',
};

function MockLogin() {
  const { login, isLoading } = useCSSAuth();
  const [selectedUserId, setSelectedUserId] = useState(DEMO_USERS[0]?.id ?? '');

  return (
    <>
      <select
        style={selectStyle}
        value={selectedUserId}
        onChange={(e) => setSelectedUserId(e.target.value)}
        disabled={isLoading}
      >
        {DEMO_USERS.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <button
        style={{
          ...buttonStyle,
          background: '#0066cc',
          color: 'white',
        }}
        onClick={() => void login(selectedUserId)}
        disabled={isLoading}
      >
        {isLoading ? 'Signing in...' : 'Sign in as Demo User'}
      </button>
    </>
  );
}

function GoogleLogin() {
  const { login, isLoading } = useCSSAuth();

  return (
    <button
      style={{
        ...buttonStyle,
        background: 'white',
        color: '#333',
        border: '1px solid #ddd',
      }}
      onClick={() => void login()}
      disabled={isLoading}
    >
      {isLoading ? (
        'Signing in...'
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </>
      )}
    </button>
  );
}

function Auth0Login() {
  const { login, isLoading } = useCSSAuth();

  return (
    <button
      style={{
        ...buttonStyle,
        background: '#eb5424',
        color: 'white',
      }}
      onClick={() => void login()}
      disabled={isLoading}
    >
      {isLoading ? 'Signing in...' : 'Sign in with Auth0'}
    </button>
  );
}

function getAuthModeLabel(mode: AuthMode): string {
  switch (mode) {
    case 'mock':
      return 'Demo Mode';
    case 'google':
      return 'Google';
    case 'auth0':
      return 'Auth0';
  }
}

export interface CSSLoginPageProps {
  /** Title shown on the login card. Default: "CSS Puck Editor" */
  title?: string;
  /** Subtitle shown below the title. Default: "Sign in to start editing" */
  subtitle?: string;
}

/**
 * Default login page for CSS auth.
 * Uses useCSSAuth() internally — must be rendered within a CSSAuthProvider.
 *
 * This is a convenience component. For custom login UIs (e.g., embedded in
 * a larger app), use useCSSAuth() directly to access login/logout/state.
 */
export function CSSLoginPage({
  title = 'CSS Puck Editor',
  subtitle = 'Sign in to start editing',
}: CSSLoginPageProps): React.ReactElement {
  const { error, authMode } = useCSSAuth();

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>{title}</h1>
        <p style={subtitleStyle}>
          {subtitle} &middot; {getAuthModeLabel(authMode)}
        </p>

        {authMode === 'mock' && <MockLogin />}
        {authMode === 'google' && <GoogleLogin />}
        {authMode === 'auth0' && <Auth0Login />}

        {error && <div style={errorStyle}>{error}</div>}
      </div>
    </div>
  );
}
