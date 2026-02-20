/**
 * Demo Application
 *
 * Demonstrates Puck editor integration with the Collaborative State System.
 * Uses Puck's Plugin API and Overrides for proper integration.
 * Document management is handled within Puck's plugin rail, not a separate sidebar.
 *
 * Auth is handled by CSSAuthProvider from @pantheon/puck-css.
 * This demo uses the default CSSLoginPage for standalone mode.
 * In an embedded scenario, you'd use useCSSAuth() with your own login UI.
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
  // Auth (from puck-css)
  CSSAuthProvider,
  useCSSAuth,
  CSSLoginPage,
  DEMO_USERS,
  // Editor integration
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
import type { AuthMode, DocumentVersion } from '@pantheon/puck-css';
import type { ComponentDiffWithPosition } from '@pantheon/puck-css';

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
    presence,
    sendFocusRegions: sendFocusRegionsViaWs,
  } = useCSSPuck();

  const { setFocusRegions, clearFocus } = useFocusRegionReporting({
    enabled: envConfig.enablePresence,
    debounceMs: 300,
    heartbeatMs: 15000,
    sendViaWebSocket: sendFocusRegionsViaWs,
  });

  const handleSelectionChange = useCallback((path: string | null, _itemId: string | null) => {
    if (path) {
      setFocusRegions([path]);
    } else {
      clearFocus();
    }
  }, [setFocusRegions, clearFocus]);

  const { documents, loading: documentsLoading, create, remove } = useDocuments({
    client,
    siteId,
    branchId,
  });

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

  const historicalDiffs = useMemo((): ComponentDiffWithPosition[] => {
    if (!isViewingHistoricalVersion || !currentData || !latestVersionData) {
      return [];
    }
    return diffPuckDataWithPositions(currentData, latestVersionData);
  }, [isViewingHistoricalVersion, currentData, latestVersionData]);

  const presenceContext = usePresenceContext();
  const currentUserId = presenceContext?.userId ?? '';

  const focusMap = useMemo(() => {
    if (!presence || !currentData) return new Map();
    const otherActors = presence.actors.filter(a => a.actorId !== currentUserId);
    return createFocusRegionMap(currentData, otherActors);
  }, [presence, currentUserId, currentData]);

  const focusEnabledConfig = useMemo(() => {
    return createFocusHighlightConfig(puckConfig) as typeof puckConfig;
  }, []);

  const effectiveConfig = useMemo(() => {
    let config = focusEnabledConfig;
    if (isViewingHistoricalVersion && historicalDiffs.length > 0) {
      config = createHistoricalVersionConfig(config, historicalDiffs) as typeof puckConfig;
    }
    return config;
  }, [isViewingHistoricalVersion, historicalDiffs, focusEnabledConfig]);

  const puckPermissions = useMemo(() => {
    if (isViewingHistoricalVersion) {
      return { delete: false, drag: false, duplicate: false, edit: false, insert: false };
    }
    return { delete: true, drag: true, duplicate: true, edit: true, insert: true };
  }, [isViewingHistoricalVersion]);

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

  const handleDocumentCreate = useCallback(
    async (path: string) => {
      await create(path);
      handleDocumentSelect(path);
    },
    [create, handleDocumentSelect]
  );

  const handleDocumentDelete = useCallback(
    async (documentId: string, path: string) => {
      await remove(documentId);
      if (selectedPath === path) {
        handleDocumentSelect('');
      }
    },
    [remove, selectedPath, handleDocumentSelect]
  );

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

  const handleStopAgent = useCallback(async (agent: ActorPresence) => {
    if (!currentDocument?.path) return;
    try {
      await client.agentEdit.stopAgent(siteId, branchId, currentDocument.path, agent.actorId);
    } catch (err) {
      console.error('[StopAgent] Error stopping agent:', err);
    }
  }, [client, siteId, branchId, currentDocument?.path]);

  const handleVersionSelect = useCallback((version: DocumentVersion) => {
    const latestVersion = versions[0];
    if (latestVersion && version.id === latestVersion.id) {
      void returnToLatest();
    } else {
      void loadVersion(version);
    }
  }, [versions, loadVersion, returnToLatest]);

  useEffect(() => {
    if (currentDocument?.id) {
      void refreshVersions();
    }
  }, [currentDocument?.id, refreshVersions]);

  const saveStatusRef = useRef(saveStatus);
  const lastSavedRef = useRef(lastSaved);
  const saveErrorRef = useRef(saveError);
  useEffect(() => { saveStatusRef.current = saveStatus; }, [saveStatus]);
  useEffect(() => { lastSavedRef.current = lastSaved; }, [lastSaved]);
  useEffect(() => { saveErrorRef.current = saveError; }, [saveError]);

  const getHasUnsavedChanges = useCallback(() => saveStatusRef.current === 'saving', []);
  const getSaveStatus = useCallback(() => saveStatusRef.current, []);
  const getLastSaved = useCallback(() => lastSavedRef.current, []);
  const getSaveError = useCallback(() => saveErrorRef.current, []);

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
    onSelectionChange: envConfig.enablePresence ? handleSelectionChange : undefined,
  }), [
    branches, currentBranch, switchBranch, getHasUnsavedChanges,
    documents, selectedPath, handleDocumentSelect, handleDocumentCreate, handleDocumentDelete,
    documentsLoading, versions, versionsLoading, viewingVersion, handleVersionSelect,
    handleSelectionChange,
  ]);

  const cssOverrides = useMemo(() => createCSSOverrides({
    getSaveStatus, getLastSaved, getSaveError,
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
    showCollaboratorAvatars: !!presence,
    presence: presence?.actors ?? [],
    showAgentActivityBanner: !!presence?.hasActiveAgents,
    activeAgents: presence?.agents ?? [],
    isAgentEditing: presence?.hasActiveAgents ?? false,
    onStopAgent: handleStopAgent,
  }), [getSaveStatus, getLastSaved, getSaveError, saveNow, createCheckpoint, handlePublishSuccess, handlePublishError, pauseAutoSave, isViewingHistoricalVersion, viewingVersion, returnToLatest, presence, handleStopAgent]);

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const puckPlugins = [cssPlugin] as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const puckOverrides = cssOverrides as any;

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
          // Check current user first, then fall back to demo users for mock mode
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
