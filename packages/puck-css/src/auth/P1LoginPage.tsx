/**
 * P1LoginPage
 *
 * Default login page component for P1 auth integration.
 * This is a convenience component — consumers can build their own login UI
 * using the useP1Auth() hook instead.
 *
 * Renders login UI appropriate for the current auth mode:
 * - mock: Demo user dropdown selector
 * - broker: "Sign in" button via auth broker
 */

import React, { useState } from 'react';
import { useP1Auth, DEMO_USERS } from './P1AuthProvider.js';
import type { AuthMode } from './P1AuthProvider.js';

const LOGIN_BUTTON_CSS = `
.css-login-btn { background: #2563eb; }
.css-login-btn:hover:not(:disabled) { background: #1d4ed8; }
.css-login-btn:disabled { opacity: 0.7; cursor: not-allowed; }
`;

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

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 600,
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

function MockLogin() {
  const { login, isLoading } = useP1Auth();
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
        className="css-login-btn"
        style={primaryButtonStyle}
        onClick={() => void login(selectedUserId)}
        disabled={isLoading}
      >
        {isLoading ? 'Signing in...' : 'Sign in as Demo User'}
      </button>
    </>
  );
}

function BrokerLogin() {
  const { login, isLoading } = useP1Auth();

  return (
    <button
      className="css-login-btn"
      style={primaryButtonStyle}
      onClick={() => void login()}
      disabled={isLoading}
    >
      {isLoading ? 'Signing in...' : 'Sign in'}
    </button>
  );
}

function getAuthModeLabel(mode: AuthMode): string {
  switch (mode) {
    case 'mock':
      return 'Demo Mode';
    case 'broker':
      return 'Broker';
  }
}

export interface P1LoginPageProps {
  /** Title shown on the login card. Default: "P1 Puck Editor" */
  title?: string;
  subtitle?: string;
}

/**
 * Default login page for P1 auth.
 * Uses useP1Auth() internally — must be rendered within a P1AuthProvider.
 *
 * This is a convenience component. For custom login UIs (e.g., embedded in
 * a larger app), use useP1Auth() directly to access login/logout/state.
 */
export function P1LoginPage({
  title = 'P1 Puck Editor',
  subtitle = 'Sign in to start editing',
}: P1LoginPageProps): React.ReactElement {
  const { error, authMode } = useP1Auth();

  return (
    <div style={containerStyle}>
      <style dangerouslySetInnerHTML={{ __html: LOGIN_BUTTON_CSS }} />
      <div style={cardStyle}>
        <h1 style={titleStyle}>{title}</h1>
        <p style={subtitleStyle}>
          {subtitle} &middot; {getAuthModeLabel(authMode)}
        </p>

        {authMode === 'mock' && <MockLogin />}
        {authMode === 'broker' && <BrokerLogin />}

        {error && <div style={errorStyle}>{error}</div>}
      </div>
    </div>
  );
}
