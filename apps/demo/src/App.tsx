/**
 * Demo Application
 *
 * Demonstrates Puck editor integration with the Collaborative State System.
 * Uses Puck's Plugin API and Overrides for proper integration.
 * Document management is handled within Puck's plugin rail, not a separate sidebar.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Puck } from '@puckeditor/core';
import '@puckeditor/core/puck.css';

import {
  CSSClient,
  Checkpoint,
  ActorPresence,
} from '@pantheon/css-client';

import {
  CSSPuckProvider,
  useCSSPuck,
  useDocuments,
  useVersions,
  createCSSPlugin,
  createCSSOverrides,
  diffPuckDataWithPositions,
  createHistoricalVersionConfig,
  useFocusRegionReporting,
  createFocusRegionMap,
  createFocusHighlightConfig,
  FocusHighlightProvider,
  usePresenceContext,
} from '@pantheon/puck-css';
import type { DocumentVersion } from '@pantheon/css-client';
import type { ComponentDiffWithPosition } from '@pantheon/puck-css';

// Import puck-css styles for visual comparison
import '@pantheon/puck-css/styles.css';

import { puckConfig } from './puck.config';

// Environment configuration
const config = {
  baseUrl: import.meta.env.VITE_CSS_BASE_URL || 'http://localhost:8787',
  wsBaseUrl: import.meta.env.VITE_CSS_WS_BASE_URL || 'ws://localhost:8787',
  siteId: import.meta.env.VITE_CSS_SITE_ID || '',
  branchId: import.meta.env.VITE_CSS_BRANCH_ID as string | undefined, // Optional - defaults to main
  enableRealtime: import.meta.env.VITE_CSS_ENABLE_REALTIME !== 'false', // Default to true
  enablePresence: import.meta.env.VITE_CSS_ENABLE_PRESENCE !== 'false', // Default to true
};

// Demo users for testing presence
// User IDs must be valid UUIDs matching the CSS backend user registry
const DEMO_USERS = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alice Developer' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Bob Teammate' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Carol Coder' },
];

// Token storage key (matches CSS Admin frontend pattern)
const TOKEN_KEY = 'css_auth_token';

/**
 * Get stored auth token
 */
function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Store auth token
 */
function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Clear stored token
 */
function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Login as a user and get a JWT token from the CSS backend
 */
async function loginAsUser(userId: string): Promise<{ token: string; user: { id: string; name: string; email: string } }> {
  const response = await fetch(`${config.baseUrl}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(error.error || 'Login failed');
  }

  return response.json();
}

/**
 * Generate a consistent hash from a string.
 * Uses a simple but effective hash algorithm (djb2).
 * Must match the algorithm in CollaboratorAvatars.tsx for consistent colors.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Generate a consistent HSL color from a user's ID.
 * Uses the ID to generate a hue, with fixed saturation and lightness
 * for good contrast with white text.
 */
function getAvatarColor(userId: string): string {
  const hash = hashString(userId);
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

interface UserSwitcherProps {
  currentUserId: string;
  onUserChange: (userId: string, userName: string) => void;
}

/**
 * User Switcher Component
 * Allows switching between demo users to test presence features
 */
function UserSwitcher({ currentUserId, onUserChange }: UserSwitcherProps) {
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
        onChange={(e) => {
          const user = DEMO_USERS.find(u => u.id === e.target.value);
          if (user) {
            onUserChange(user.id, user.name);
          }
        }}
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

// Validate configuration
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
 * Full-width Puck editor with CSS plugin in the plugin rail
 */
function AppContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPath = searchParams.get('path');

  const {
    client,
    siteId,
    branchId,
    currentData,
    currentDocument,
    loadDocument,
    saveData,
    saveStatus,
    lastSaved,
    saveError,
    saveNow,
    createCheckpoint,
    branches,
    currentBranch,
    switchBranch,
    pauseAutoSave,
    isViewingHistoricalVersion,
    viewingVersion,
    latestVersionData,
    loadVersion,
    returnToLatest,
    // Phase 9: Presence
    presence,
    // WebSocket focus region sender
    sendFocusRegions: sendFocusRegionsViaWs,
  } = useCSSPuck();

  // Focus region reporting - reports which component the user has selected
  // This helps agents avoid editing regions where a human has focus
  // Pass sendFocusRegions from context to use WebSocket first, with HTTP fallback
  const { setFocusRegions, clearFocus } = useFocusRegionReporting({
    enabled: config.enablePresence,
    debounceMs: 300,
    heartbeatMs: 15000,
    sendViaWebSocket: sendFocusRegionsViaWs,
  });

  // Handle selection changes from Puck for focus region reporting
  const handleSelectionChange = useCallback((path: string | null, _itemId: string | null) => {
    if (path) {
      setFocusRegions([path]);
    } else {
      clearFocus();
    }
  }, [setFocusRegions, clearFocus]);

  // Document management via useDocuments hook
  const { documents, loading: documentsLoading, create, remove } = useDocuments({
    client,
    siteId,
    branchId,
  });

  // Version management via useVersions hook
  const {
    versions,
    loading: versionsLoading,
    refresh: refreshVersions,
  } = useVersions({
    client,
    siteId,
    branchId,
    documentId: currentDocument?.id ?? null,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Compute diffs when viewing a historical version
  const historicalDiffs = useMemo((): ComponentDiffWithPosition[] => {
    if (!isViewingHistoricalVersion || !currentData || !latestVersionData) {
      return [];
    }
    // Compare historical version (before) with latest (after)
    return diffPuckDataWithPositions(currentData, latestVersionData);
  }, [isViewingHistoricalVersion, currentData, latestVersionData]);

  // Get the current user's ID from the presence context to filter them out of focus highlights
  const presenceContext = usePresenceContext();
  const currentUserId = presenceContext?.userId ?? '';

  // Create focus map from other actors' focus regions
  // This shows visual highlights on components that other users/agents are viewing or editing
  // With context-based highlighting, focusMap changes no longer cause config recreation
  const focusMap = useMemo(() => {
    if (!presence || !currentData) return new Map();
    // Filter out the current user - we only show highlights for OTHER actors
    const otherActors = presence.actors.filter(a => a.actorId !== currentUserId);
    return createFocusRegionMap(currentData, otherActors);
  }, [presence, currentUserId, currentData]);

  // Create config with focus highlight wrappers (stable - uses context for actual highlights)
  // The focus highlighting is context-based, so config doesn't need to change when focusMap changes
  const focusEnabledConfig = useMemo(() => {
    return createFocusHighlightConfig(puckConfig) as typeof puckConfig;
  }, []);

  // Create highlighted config when viewing historical version
  // Only changes when viewing history, not on focus region changes
  const effectiveConfig = useMemo(() => {
    let config = focusEnabledConfig;

    // Apply historical version highlighting if viewing old version
    if (isViewingHistoricalVersion && historicalDiffs.length > 0) {
      config = createHistoricalVersionConfig(config, historicalDiffs) as typeof puckConfig;
    }

    return config;
  }, [isViewingHistoricalVersion, historicalDiffs, focusEnabledConfig]);

  // Puck permissions - read-only when viewing historical version
  const puckPermissions = useMemo(() => {
    if (isViewingHistoricalVersion) {
      return {
        delete: false,
        drag: false,
        duplicate: false,
        edit: false,
        insert: false,
      };
    }
    // Explicitly enable all permissions when not viewing historical version
    return {
      delete: true,
      drag: true,
      duplicate: true,
      edit: true,
      insert: true,
    };
  }, [isViewingHistoricalVersion]);

  // Handle document selection
  const handleDocumentSelect = useCallback(
    (path: string) => {
      if (path) {
        setSearchParams({ path });
      } else {
        setSearchParams({});
      }
    },
    [setSearchParams]
  );

  // Handle document creation
  const handleDocumentCreate = useCallback(
    async (path: string) => {
      await create(path);
      handleDocumentSelect(path);
    },
    [create, handleDocumentSelect]
  );

  // Handle document deletion
  const handleDocumentDelete = useCallback(
    async (documentId: string, path: string) => {
      await remove(documentId);
      if (selectedPath === path) {
        handleDocumentSelect('');
      }
    },
    [remove, selectedPath, handleDocumentSelect]
  );

  // Load document when path changes
  useEffect(() => {
    if (!selectedPath) {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    loadDocument(selectedPath)
      .then(() => setLoading(false))
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [selectedPath, loadDocument]);

  const handleChange = useCallback(
    (data: unknown) => {
      saveData(data as Parameters<typeof saveData>[0]);
    },
    [saveData]
  );

  const handlePublishSuccess = useCallback((checkpoint: Checkpoint) => {
    alert(`Published checkpoint: ${checkpoint.name ?? checkpoint.id}`);
  }, []);

  const handlePublishError = useCallback((err: Error) => {
    alert(`Publish failed: ${err.message}`);
  }, []);

  // Handle stop agent - called when user clicks "Stop Agent" button
  const handleStopAgent = useCallback(async (agent: ActorPresence) => {
    if (!currentDocument?.path) {
      console.error('[StopAgent] No document path available');
      return;
    }

    try {
      console.log(`[StopAgent] Stopping agent ${agent.name} (${agent.actorId})`);
      const result = await client.agentEdit.stopAgent(
        siteId,
        branchId,
        currentDocument.path,
        agent.actorId
      );

      if (result.success) {
        if (result.rolledBack) {
          console.log(`[StopAgent] Agent stopped and changes rolled back`);
        } else {
          console.log(`[StopAgent] Agent stopped: ${result.message ?? 'No active session'}`);
        }
      } else {
        console.error('[StopAgent] Failed to stop agent');
      }
    } catch (err) {
      console.error('[StopAgent] Error stopping agent:', err);
    }
  }, [client, siteId, branchId, currentDocument?.path]);

  // Handle version selection - loads the selected version into the editor
  const handleVersionSelect = useCallback((version: DocumentVersion) => {
    // Check if this is the latest version (first in the sorted list)
    const latestVersion = versions[0];
    if (latestVersion && version.id === latestVersion.id) {
      // If selecting the latest version, return to it
      void returnToLatest();
    } else {
      // Load the historical version
      void loadVersion(version);
    }
  }, [versions, loadVersion, returnToLatest]);

  // Refresh versions when document changes or after save
  useEffect(() => {
    if (currentDocument?.id) {
      void refreshVersions();
    }
  }, [currentDocument?.id, refreshVersions]);

  // Use refs for values that change frequently but shouldn't trigger plugin/overrides recreation
  // This prevents the plugin and overrides from being recreated on every save, which causes flicker
  const saveStatusRef = useRef(saveStatus);
  const lastSavedRef = useRef(lastSaved);
  const saveErrorRef = useRef(saveError);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);
  useEffect(() => {
    lastSavedRef.current = lastSaved;
  }, [lastSaved]);
  useEffect(() => {
    saveErrorRef.current = saveError;
  }, [saveError]);

  // Stable getter functions (read from refs to avoid stale closures)
  const getHasUnsavedChanges = useCallback(() => saveStatusRef.current === 'saving', []);
  const getSaveStatus = useCallback(() => saveStatusRef.current, []);
  const getLastSaved = useCallback(() => lastSavedRef.current, []);
  const getSaveError = useCallback(() => saveErrorRef.current, []);

  // Create Puck plugin for CSS integration (branch selector + document list + versions in plugin rail)
  // The plugin uses ContextSyncBridge internally to sync data from CSSPuckContext to Puck
  const cssPlugin = useMemo(() => createCSSPlugin({
    branches,
    currentBranch,
    onBranchSwitch: switchBranch,
    getHasUnsavedChanges,
    documents,
    selectedDocumentPath: selectedPath,
    onDocumentSelect: handleDocumentSelect,
    onDocumentCreate: handleDocumentCreate,
    onDocumentDelete: handleDocumentDelete,
    documentsLoading,
    versions,
    versionsLoading,
    selectedVersionId: viewingVersion?.id ?? undefined,
    onVersionSelect: handleVersionSelect,
    // Focus region reporting - reports component selection to backend for agent collision avoidance
    onSelectionChange: config.enablePresence ? handleSelectionChange : undefined,
  }), [
    branches,
    currentBranch,
    switchBranch,
    getHasUnsavedChanges,
    documents,
    selectedPath,
    handleDocumentSelect,
    handleDocumentCreate,
    handleDocumentDelete,
    documentsLoading,
    versions,
    versionsLoading,
    viewingVersion,
    handleVersionSelect,
    // Focus region reporting for agent collision avoidance
    handleSelectionChange,
  ]);

  // Create Puck overrides for header actions (save indicator, publish button, version banner)
  // IMPORTANT: We use getter functions for saveStatus/lastSaved/saveError to avoid recreating
  // the overrides on every save, which would cause Puck to potentially re-render and flicker.
  const cssOverrides = useMemo(() => createCSSOverrides({
    getSaveStatus,
    getLastSaved,
    getSaveError,
    onRetrySave: saveNow,
    onPublish: createCheckpoint,
    onPublishSuccess: handlePublishSuccess,
    onPublishError: handlePublishError,
    showNamePrompt: true,
    showDefaultPublish: false,
    onPauseAutoSave: pauseAutoSave,
    isViewingHistoricalVersion,
    viewingVersion,
    onReturnToLatest: returnToLatest,
    // Phase 9: Presence features
    showCollaboratorAvatars: !!presence,
    presence: presence?.actors ?? [],
    showAgentActivityBanner: !!presence?.hasActiveAgents,
    activeAgents: presence?.agents ?? [],
    isAgentEditing: presence?.hasActiveAgents ?? false,
    onStopAgent: handleStopAgent,
  }), [getSaveStatus, getLastSaved, getSaveError, saveNow, createCheckpoint, handlePublishSuccess, handlePublishError, pauseAutoSave, isViewingHistoricalVersion, viewingVersion, returnToLatest, presence, handleStopAgent]);

  // Loading state
  if (loading) {
    return (
      <div className="app app--fullscreen">
        <div className="loading">Loading document...</div>
      </div>
    );
  }

  // Error state
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

  // Cast plugin to match Puck's expected types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const puckPlugins = [cssPlugin] as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const puckOverrides = cssOverrides as any;

  // No document selected - show Puck with empty state
  if (!selectedPath || !currentDocument || !currentData) {
    return (
      <div className="app app--fullscreen">
        <Puck
          config={puckConfig}
          data={{ content: [], root: { props: {} } }}
          onChange={() => {}}
          plugins={puckPlugins}
          overrides={puckOverrides}
        />
      </div>
    );
  }

  // Document loaded - show Puck editor
  // When viewing historical version, editor is read-only with diff highlighting
  // Data sync happens via PuckDataSynchronizer in overrides (preserves sidebar state)
  // FocusHighlightProvider enables focus highlighting without config recreation (no flicker)
  return (
    <div className="app app--fullscreen">
      <FocusHighlightProvider focusMap={focusMap}>
        <Puck
          config={effectiveConfig}
          data={currentData}
          onChange={isViewingHistoricalVersion ? () => {} : handleChange}
          plugins={puckPlugins}
          overrides={puckOverrides}
          permissions={puckPermissions}
        />
      </FocusHighlightProvider>
    </div>
  );
}

/**
 * App Component
 * Main entry point with provider setup
 */
export function App() {
  // State for current user (enables user switching for presence demo)
  const [currentUser, setCurrentUser] = useState({
    id: DEMO_USERS[0].id,
    name: DEMO_USERS[0].name,
  });

  // Auth state
  const [authToken, setAuthToken] = useState<string | null>(getStoredToken());
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Login function - gets JWT token from backend
  const performLogin = useCallback(async (userId: string) => {
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await loginAsUser(userId);
      setStoredToken(response.token);
      setAuthToken(response.token);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
      clearStoredToken();
      setAuthToken(null);
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  // Login on mount if no token, or when user changes
  useEffect(() => {
    // Always login as the current user to get a fresh token
    void performLogin(currentUser.id);
  }, [currentUser.id, performLogin]);

  // Handle user change - this will trigger re-login via useEffect
  const handleUserChange = useCallback((userId: string, userName: string) => {
    // Clear old token first
    clearStoredToken();
    setAuthToken(null);
    setCurrentUser({ id: userId, name: userName });
  }, []);

  // Create CSS client with JWT auth provider
  // Recreates when token changes
  const cssClient = useMemo(() => {
    if (!authToken) return null;

    return new CSSClient({
      baseUrl: config.baseUrl,
      authProvider: async () => `Bearer ${authToken}`,
    });
  }, [authToken]);

  // Check for required configuration (branchId is optional - defaults to main)
  if (!config.siteId) {
    return <ConfigWarning />;
  }

  // Show loading during login
  if (isLoggingIn) {
    return (
      <div className="app app--fullscreen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Logging in as {currentUser.name}...</div>
      </div>
    );
  }

  // Show error if login failed
  if (loginError || !cssClient) {
    return (
      <div className="app app--fullscreen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <div style={{ color: 'red' }}>Login failed: {loginError || 'No auth token'}</div>
        <button onClick={() => void performLogin(currentUser.id)}>Retry</button>
      </div>
    );
  }

  return (
    <>
      <CSSPuckProvider
        key={`${currentUser.id}-${authToken}`} // Force remount on user/token change to reset connections
        client={cssClient}
        siteId={config.siteId}
        branchId={config.branchId}
        userId={currentUser.id}
        userName={currentUser.name}
        autoSaveDelay={3000}
        maxRetries={3}
        enableRealtime={config.enableRealtime}
        wsBaseUrl={config.wsBaseUrl}
        realtimeApiKey={authToken ?? undefined}
        presenceEnabled={config.enablePresence}
        userNameResolver={(id) => DEMO_USERS.find(u => u.id === id)?.name}
      >
        <AppContent />
      </CSSPuckProvider>
      <UserSwitcher
        currentUserId={currentUser.id}
        onUserChange={handleUserChange}
      />
    </>
  );
}
