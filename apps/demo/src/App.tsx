/**
 * Demo Application
 *
 * Demonstrates Puck editor integration with the Collaborative State System.
 * Uses Puck's Plugin API and Overrides for proper integration.
 * Document management is handled within Puck's plugin rail, not a separate sidebar.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
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
  VersionComparePage,
  diffPuckDataWithPositions,
} from '@pantheon/puck-css';
import type { DocumentVersion, PuckData } from '@pantheon/css-client';
import type { ComponentDiffWithPosition } from '@pantheon/puck-css';

import { puckConfig } from './puck.config';

// Environment configuration
const config = {
  baseUrl: import.meta.env.VITE_CSS_BASE_URL || 'http://localhost:8787',
  apiKey: import.meta.env.VITE_CSS_API_KEY || '',
  siteId: import.meta.env.VITE_CSS_SITE_ID || '',
  branchId: import.meta.env.VITE_CSS_BRANCH_ID as string | undefined, // Optional - defaults to main
  userId: import.meta.env.VITE_CSS_USER_ID || 'demo-user',
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

  // Version comparison state
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [comparisonData, setComparisonData] = useState<{
    beforeVersion: number;
    afterVersion: number;
    diffs: ComponentDiffWithPosition[];
  } | null>(null);

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

  // Handle version selection
  const handleVersionSelect = useCallback((version: DocumentVersion) => {
    setSelectedVersionId(version.id);
  }, []);

  // Handle version comparison
  const handleCompare = useCallback((beforeVersionId: string, afterVersionId: string) => {
    const beforeVersion = versions.find((v) => v.id === beforeVersionId);
    const afterVersion = versions.find((v) => v.id === afterVersionId);

    if (!beforeVersion || !afterVersion) {
      console.error('Version not found for comparison');
      return;
    }

    const beforeData = beforeVersion.snapshot as unknown as PuckData;
    const afterData = afterVersion.snapshot as unknown as PuckData;

    const diffs = diffPuckDataWithPositions(beforeData, afterData);

    setComparisonData({
      beforeVersion: beforeVersion.versionNumber,
      afterVersion: afterVersion.versionNumber,
      diffs,
    });
  }, [versions]);

  // Close comparison view
  const handleCloseComparison = useCallback(() => {
    setComparisonData(null);
    setSelectedVersionId(null);
  }, []);

  // Refresh versions when document changes or after save
  useEffect(() => {
    if (currentDocument?.id) {
      void refreshVersions();
    }
  }, [currentDocument?.id, refreshVersions]);

  // Create Puck plugin for CSS integration (branch selector + document list + versions in plugin rail)
  const cssPlugin = useMemo(() => createCSSPlugin({
    branches,
    currentBranch,
    onBranchSwitch: switchBranch,
    hasUnsavedChanges: saveStatus === 'saving',
    documents,
    selectedDocumentPath: selectedPath,
    onDocumentSelect: handleDocumentSelect,
    onDocumentCreate: handleDocumentCreate,
    onDocumentDelete: handleDocumentDelete,
    documentsLoading,
    versions,
    versionsLoading,
    selectedVersionId: selectedVersionId ?? undefined,
    onVersionSelect: handleVersionSelect,
    onCompare: handleCompare,
  }), [
    branches,
    currentBranch,
    switchBranch,
    saveStatus,
    documents,
    selectedPath,
    handleDocumentSelect,
    handleDocumentCreate,
    handleDocumentDelete,
    documentsLoading,
    versions,
    versionsLoading,
    selectedVersionId,
    handleVersionSelect,
    handleCompare,
  ]);

  // Create Puck overrides for header actions (save indicator, publish button)
  const cssOverrides = useMemo(() => createCSSOverrides({
    saveStatus,
    lastSaved,
    saveError,
    onRetrySave: saveNow,
    onPublish: createCheckpoint,
    onPublishSuccess: handlePublishSuccess,
    onPublishError: handlePublishError,
    showNamePrompt: true,
    showDefaultPublish: false,
    onPauseAutoSave: pauseAutoSave,
  }), [saveStatus, lastSaved, saveError, saveNow, createCheckpoint, handlePublishSuccess, handlePublishError, pauseAutoSave]);

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

  // Show comparison view if comparing versions
  if (comparisonData) {
    return (
      <div className="app app--fullscreen">
        <VersionComparePage
          beforeVersion={comparisonData.beforeVersion}
          afterVersion={comparisonData.afterVersion}
          diffs={comparisonData.diffs}
          onClose={handleCloseComparison}
        />
      </div>
    );
  }

  // Document loaded - show Puck editor
  return (
    <div className="app app--fullscreen">
      <Puck
        config={puckConfig}
        data={currentData}
        onChange={handleChange}
        plugins={puckPlugins}
        overrides={puckOverrides}
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
    >
      <AppContent />
    </CSSPuckProvider>
  );
}
