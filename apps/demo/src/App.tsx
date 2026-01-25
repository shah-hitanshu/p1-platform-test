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
  createCSSPlugin,
  createCSSOverrides,
} from '@pantheon/puck-css';

import { puckConfig } from './puck.config';

// Environment configuration
const config = {
  baseUrl: import.meta.env.VITE_CSS_BASE_URL || 'http://localhost:8787',
  apiKey: import.meta.env.VITE_CSS_API_KEY || '',
  siteId: import.meta.env.VITE_CSS_SITE_ID || '',
  branchId: import.meta.env.VITE_CSS_BRANCH_ID || '',
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
VITE_CSS_BRANCH_ID=your-branch-id
VITE_CSS_USER_ID=demo-user-id`}
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
  } = useCSSPuck();

  // Document management via useDocuments hook
  const { documents, loading: documentsLoading, create, remove } = useDocuments({
    client,
    siteId,
    branchId,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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

  // Create Puck plugin for CSS integration (branch selector + document list in plugin rail)
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
  }), [saveStatus, lastSaved, saveError, saveNow, createCheckpoint, handlePublishSuccess, handlePublishError]);

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
  // Check for required configuration
  if (!config.apiKey || !config.siteId || !config.branchId) {
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
