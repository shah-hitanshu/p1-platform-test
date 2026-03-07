/**
 * Demo Application
 *
 * Demonstrates Puck editor integration with the Collaborative State System.
 * Uses the high-level CSSApp API and stable consumer hooks (useCSSEditor).
 */

import { useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Puck } from '@puckeditor/core';
import '@puckeditor/core/puck.css';

import {
  CSSApp,
  createCSSConfig,
  useCSSAuth,
  DEMO_USERS,
  useCSSEditor,
} from '@pantheon/puck-css';
import type { Checkpoint } from '@pantheon/puck-css';

import '@pantheon/puck-css/styles.css';

import { puckConfig } from './puck.config';

// Build config from env vars (VITE_ prefix strips to CSS_*)
// Override auth-related vars that don't follow CSS_ naming convention
let config: ReturnType<typeof createCSSConfig> | null = null;
let configError: string | null = null;

try {
  config = createCSSConfig(import.meta.env, {
    prefix: 'VITE_',
    overrides: {
      authMode: (import.meta.env.VITE_AUTH_MODE || 'mock') as 'mock' | 'google' | 'auth0',
      googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      auth0Domain: import.meta.env.VITE_AUTH0_DOMAIN,
      auth0ClientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
      auth0Audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      enableRealtime: import.meta.env.VITE_CSS_ENABLE_REALTIME !== 'false',
      enablePresence: import.meta.env.VITE_CSS_ENABLE_PRESENCE !== 'false',
    },
  });
} catch (err) {
  configError = err instanceof Error ? err.message : String(err);
}

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

/**
 * Main Application Content
 *
 * Uses useCSSEditor for a complete Puck + CSS integration with minimal code.
 */
function AppContent() {
  const { authMode } = useCSSAuth();
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
      {authMode === 'mock' && <UserSwitcher />}
    </div>
  );
}

/**
 * App Component
 *
 * CSSApp handles auth gating, CSSClient creation, and provider composition.
 * The demo only provides config and the editor content.
 */
export function App() {
  if (!config || configError) {
    return (
      <div className="config-warning">
        <h2>Configuration Required</h2>
        {configError && <p style={{ color: '#c00' }}>{configError}</p>}
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

  return (
    <CSSApp
      config={config}
      loginPageProps={{ title: 'CSS Demo', subtitle: 'Sign in to edit' }}
    >
      <AppContent />
    </CSSApp>
  );
}
