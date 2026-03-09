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

import React, { useState, useRef, useEffect } from 'react';
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
  const { isLoading, renderLoginButton } = useCSSAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !renderLoginButton) return;
    const cleanup = renderLoginButton(containerRef.current);
    return () => { cleanup?.(); };
  }, [renderLoginButton]);

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: '12px' }}>Signing in...</div>;
  }

  return <div ref={containerRef} style={{ display: 'flex', justifyContent: 'center' }} />;
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
