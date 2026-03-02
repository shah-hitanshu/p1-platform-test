/**
 * Demo Application
 *
 * Demonstrates Puck editor integration with the Collaborative State System.
 * Uses the stable consumer API hooks (useCSSEditor) for minimal boilerplate.
 *
 * Auth is handled by CSSAuthProvider from @pantheon/puck-css.
 * This demo uses the default CSSLoginPage for standalone mode.
 */

import { useMemo, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Puck } from '@puckeditor/core';
import '@puckeditor/core/puck.css';

import { CSSClient } from '@pantheon/css-client';

import {
  // Auth
  CSSAuthProvider,
  useCSSAuth,
  CSSLoginPage,
  DEMO_USERS,
  // Provider
  CSSPuckProvider,
  // Stable consumer API
  useCSSEditor,
} from '@pantheon/puck-css';
import type { AuthMode, Checkpoint } from '@pantheon/puck-css';

// Import puck-css styles for visual comparison
import '@pantheon/puck-css/styles.css';

import { puckConfig } from './puck.config';

// Environment configuration
const envConfig = {
  baseUrl: import.meta.env.VITE_CSS_BASE_URL || 'http://localhost:8787',
  wsBaseUrl: import.meta.env.VITE_CSS_WS_BASE_URL || 'ws://localhost:8787',
  siteId: import.meta.env.VITE_CSS_SITE_ID || '',
  branchId: import.meta.env.VITE_CSS_BRANCH_ID as string | undefined,
  enableRealtime: import.meta.env.VITE_CSS_ENABLE_REALTIME !== 'false',
  enablePresence: import.meta.env.VITE_CSS_ENABLE_PRESENCE !== 'false',
  authMode: (import.meta.env.VITE_AUTH_MODE || 'mock') as AuthMode,
};

/**
 * Generate a consistent hash from a string.
 * Uses djb2 algorithm. Must match CollaboratorAvatars.tsx for consistent colors.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

function getAvatarColor(userId: string): string {
  const hash = hashString(userId);
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

/**
 * User Switcher Component
 * Allows inline switching between demo users without bouncing to login page.
 * Only visible in mock auth mode.
 */
function UserSwitcher() {
  const { user, login } = useCSSAuth();
  const currentUserId = user?.id ?? DEMO_USERS[0].id;
  const currentUser = DEMO_USERS.find(u => u.id === currentUserId) || DEMO_USERS[0];
  const avatarColor = getAvatarColor(currentUser.id);

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 9999,
      background: 'white',
      borderRadius: '12px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '14px',
    }}>
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: avatarColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 'bold',
        fontSize: '14px',
      }}>
        {currentUser.name.charAt(0)}
      </div>
      <select
        value={currentUserId}
        onChange={(e) => void login(e.target.value)}
        style={{
          padding: '8px 12px',
          borderRadius: '6px',
          border: '1px solid #ddd',
          background: 'white',
          cursor: 'pointer',
          fontSize: '14px',
          minWidth: '150px',
        }}
      >
        {DEMO_USERS.map(user => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <Link
        to="/merge"
        style={{
          fontSize: '13px',
          color: '#0066cc',
          textDecoration: 'none',
          padding: '6px 12px',
          borderRadius: '6px',
          border: '1px solid #0066cc',
          whiteSpace: 'nowrap',
        }}
      >
        Merge review
      </Link>
    </div>
  );
}

function ConfigWarning() {
  return (
    <div className="config-warning">
      <h2>Configuration Required</h2>
      <p>Please set the following environment variables in your .env file:</p>
      <pre>
{`VITE_CSS_BASE_URL=http://localhost:8787
VITE_CSS_SITE_ID=your-site-id

# Optional - defaults to main branch if not set:
# VITE_CSS_BRANCH_ID=your-branch-id`}
      </pre>
    </div>
  );
}

/**
 * Main Application Content
 *
 * Uses useCSSEditor for a complete Puck + CSS integration with minimal code.
 * Version management, safe data, stable plugins/overrides, and historical
 * version protection are all handled internally by the hook.
 */
function AppContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const documentPath = searchParams.get('path') || '/home';

  const handleDocumentSelect = useCallback(
    (path: string) => {
      setSearchParams(path ? { path } : {});
    },
    [setSearchParams]
  );

  const { loading, error, puckProps } = useCSSEditor({
    documentPath,
    puckConfig,
    pluginOptions: {
      onDocumentSelect: handleDocumentSelect,
      selectedDocumentPath: documentPath,
    },
    overrideOptions: {
      showNamePrompt: true,
      showDefaultPublish: false,
      onPublishSuccess: (checkpoint: Checkpoint) => {
        alert(`Published checkpoint: ${checkpoint.name ?? checkpoint.id}`);
      },
      onPublishError: (err: Error) => {
        alert(`Publish failed: ${err.message}`);
      },
    },
  });

  if (loading) {
    return (
      <div className="app app--fullscreen">
        <div className="loading">Loading document...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app app--fullscreen">
        <div className="error">
          <h3>Error loading document</h3>
          <p>{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app app--fullscreen">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Puck {...puckProps as any} />
    </div>
  );
}

/**
 * Authenticated App Shell
 * Sources auth state from CSSAuthProvider via useCSSAuth().
 */
function AuthenticatedApp() {
  const { user, token, authMode } = useCSSAuth();

  const cssClient = useMemo(() => {
    if (!token) return null;
    return new CSSClient({
      baseUrl: envConfig.baseUrl,
      authProvider: async () => `Bearer ${token}`,
    });
  }, [token]);

  if (!envConfig.siteId) {
    return <ConfigWarning />;
  }

  if (!cssClient || !user || !token) {
    return (
      <div className="app app--fullscreen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Initializing...</div>
      </div>
    );
  }

  return (
    <>
      <CSSPuckProvider
        key={`${user.id}-${token}`}
        client={cssClient}
        siteId={envConfig.siteId}
        branchId={envConfig.branchId}
        userId={user.id}
        userName={user.name}
        autoSaveDelay={3000}
        maxRetries={3}
        enableRealtime={envConfig.enableRealtime}
        wsBaseUrl={envConfig.wsBaseUrl}
        realtimeApiKey={token}
        presenceEnabled={envConfig.enablePresence}
        userNameResolver={(id) => {
          if (id === user.id) return user.name;
          return DEMO_USERS.find(u => u.id === id)?.name;
        }}
      >
        <AppContent />
      </CSSPuckProvider>
      {authMode === 'mock' && <UserSwitcher />}
    </>
  );
}

/**
 * App Component — thin shell.
 * All auth logic lives in @pantheon/puck-css (CSSAuthProvider).
 * The demo app only provides env config and the Puck component config.
 */
export function App() {
  return (
    <CSSAuthProvider
      authMode={envConfig.authMode}
      cssBaseUrl={envConfig.baseUrl}
      googleClientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}
      auth0Domain={import.meta.env.VITE_AUTH0_DOMAIN}
      auth0ClientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      auth0Audience={import.meta.env.VITE_AUTH0_AUDIENCE}
    >
      <AppGate />
    </CSSAuthProvider>
  );
}

function AppGate() {
  const { isAuthenticated, isLoading } = useCSSAuth();

  if (isLoading) {
    return (
      <div className="app app--fullscreen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <CSSLoginPage />;
  }

  return <AuthenticatedApp />;
}
