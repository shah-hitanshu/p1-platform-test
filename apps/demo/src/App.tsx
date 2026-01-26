/**
 * Demo Application
 *
 * Demonstrates Puck editor integration with the Collaborative State System.
 * Uses Puck's Plugin API and Overrides for proper integration.
 * Document management is handled within Puck's plugin rail, not a separate sidebar.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Puck } from '@puckeditor/core';
import '@puckeditor/core/puck.css';

import {
  CSSClient,
  Checkpoint,
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
  apiKey: import.meta.env.VITE_CSS_API_KEY || '',
  siteId: import.meta.env.VITE_CSS_SITE_ID || '',
  branchId: import.meta.env.VITE_CSS_BRANCH_ID as string | undefined, // Optional - defaults to main
  userId: import.meta.env.VITE_CSS_USER_ID || 'demo-user',
  enableRealtime: import.meta.env.VITE_CSS_ENABLE_REALTIME !== 'false', // Default to true
};

// Validate configuration
function ConfigWarning() {
  return (
    <div className="config-warning">
      <h2>Configuration Required</h2>
      <p>Please set the following environment variables in your .env file:</p>
      <pre>
{`VITE_CSS_BASE_URL=http://localhost:8787
VITE_CSS_API_KEY=your-api-key-here
VITE_CSS_SITE_ID=your-site-id
VITE_CSS_USER_ID=demo-user-id

# Optional - defaults to main branch if not set:
# VITE_CSS_BRANCH_ID=your-branch-id`}
      </pre>
    </div>
  );
}

// Create CSS client
const cssClient = new CSSClient({
  baseUrl: config.baseUrl,
  apiKey: config.apiKey,
});

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
  } = useCSSPuck();

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

  // Create highlighted config when viewing historical version
  const effectiveConfig = useMemo(() => {
    if (isViewingHistoricalVersion && historicalDiffs.length > 0) {
      // Type assertion needed because createHistoricalVersionConfig returns a wrapped config
      return createHistoricalVersionConfig(puckConfig, historicalDiffs) as typeof puckConfig;
    }
    return puckConfig;
  }, [isViewingHistoricalVersion, historicalDiffs]);

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

  // Track the last synced key to avoid syncing on every render
  // This ref persists across renders even if child components remount
  const lastSyncedKeyRef = useRef<string | null>(null);

  // Use refs for values that change frequently but shouldn't trigger plugin/overrides recreation
  // This prevents the plugin and overrides from being recreated on every save, which causes flicker
  const saveStatusRef = useRef(saveStatus);
  const currentDataRef = useRef(currentData);
  const lastSavedRef = useRef(lastSaved);
  const saveErrorRef = useRef(saveError);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);
  useEffect(() => {
    currentDataRef.current = currentData;
  }, [currentData]);
  useEffect(() => {
    lastSavedRef.current = lastSaved;
  }, [lastSaved]);
  useEffect(() => {
    saveErrorRef.current = saveError;
  }, [saveError]);

  // Generate a sync key that changes when we want to force Puck to update its data
  // Only sync when document or version changes, NOT when currentData changes from saves
  const targetSyncKey = viewingVersion
    ? `version-${viewingVersion.id}`
    : currentDocument
      ? `doc-${currentDocument.id}-latest`
      : null;

  // Only provide a new dataSyncKey when it's different from what we last synced
  // This prevents re-syncing after saves which would overwrite user edits
  const dataSyncKey = targetSyncKey !== lastSyncedKeyRef.current ? targetSyncKey : null;

  // Update the ref after we determine if sync is needed
  // (The actual sync happens in PuckDataSynchronizer when dataSyncKey is non-null)
  useEffect(() => {
    if (dataSyncKey !== null) {
      lastSyncedKeyRef.current = dataSyncKey;
    }
  }, [dataSyncKey]);

  // Stable getter functions (read from refs to avoid stale closures)
  const getHasUnsavedChanges = useCallback(() => saveStatusRef.current === 'saving', []);
  const getSaveStatus = useCallback(() => saveStatusRef.current, []);
  const getLastSaved = useCallback(() => lastSavedRef.current, []);
  const getSaveError = useCallback(() => saveErrorRef.current, []);

  // Create Puck plugin for CSS integration (branch selector + document list + versions in plugin rail)
  // syncData and dataSyncKey are passed here so PuckDataSynchronizer renders inside Puck's context
  // IMPORTANT: We use refs for saveStatus and currentData to avoid recreating the plugin on every save,
  // which would cause the iframe to flicker/reload
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
    // Data sync props - these render PuckDataSynchronizer inside the plugin (inside Puck's context)
    // We use the ref's current value but only include dataSyncKey in deps (which controls when to sync)
    syncData: currentDataRef.current,
    dataSyncKey,
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
    // Note: saveStatus and currentData are intentionally NOT in deps - we use refs instead
    // dataSyncKey changes when we need to sync, currentDataRef.current will have the right value then
    dataSyncKey,
  ]);

  // Create Puck overrides for header actions (save indicator, publish button, version banner)
  // NOTE: syncData/dataSyncKey are NOT passed here - they're in the plugin above
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
  }), [getSaveStatus, getLastSaved, getSaveError, saveNow, createCheckpoint, handlePublishSuccess, handlePublishError, pauseAutoSave, isViewingHistoricalVersion, viewingVersion, returnToLatest]);

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
  return (
    <div className="app app--fullscreen">
      <Puck
        config={effectiveConfig}
        data={currentData}
        onChange={isViewingHistoricalVersion ? () => {} : handleChange}
        plugins={puckPlugins}
        overrides={puckOverrides}
        permissions={puckPermissions}
      />
    </div>
  );
}

/**
 * App Component
 * Main entry point with provider setup
 */
export function App() {
  // Check for required configuration (branchId is optional - defaults to main)
  if (!config.apiKey || !config.siteId) {
    return <ConfigWarning />;
  }

  return (
    <CSSPuckProvider
      client={cssClient}
      siteId={config.siteId}
      branchId={config.branchId}
      userId={config.userId}
      autoSaveDelay={3000}
      maxRetries={3}
      enableRealtime={config.enableRealtime}
      wsBaseUrl={config.wsBaseUrl}
      realtimeApiKey={config.apiKey}
    >
      <AppContent />
    </CSSPuckProvider>
  );
}
