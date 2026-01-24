/**
 * Demo Application
 *
 * Demonstrates Puck editor integration with the Collaborative State System.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Puck } from '@measured/puck';
import '@measured/puck/puck.css';

import {
  CSSClient,
  Checkpoint,
} from '@pantheon/css-client';

import {
  CSSPuckProvider,
  useCSSPuck,
  useDocuments,
  SaveIndicator,
  PublishButton,
  BranchSelector,
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
 * Page List Component
 * Shows documents in the sidebar
 */
interface PageListProps {
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function PageList({ selectedPath, onSelect }: PageListProps) {
  const { client, siteId, branchId } = useCSSPuck();
  const { documents, loading, error, create, remove, refresh } = useDocuments({
    client,
    siteId,
    branchId,
  });

  const [isCreating, setIsCreating] = useState(false);
  const [newPagePath, setNewPagePath] = useState('');

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPagePath.trim()) return;

    const path = newPagePath.startsWith('/') ? newPagePath : `/${newPagePath}`;
    try {
      await create(path);
      setNewPagePath('');
      setIsCreating(false);
      onSelect(path);
    } catch (err) {
      console.error('Failed to create page:', err);
    }
  }, [newPagePath, create, onSelect]);

  const handleDelete = useCallback(async (e: React.MouseEvent, docId: string, path: string) => {
    e.stopPropagation();
    if (!window.confirm(`Delete page "${path}"?`)) return;

    try {
      await remove(docId);
      if (selectedPath === path) {
        onSelect('');
      }
    } catch (err) {
      console.error('Failed to delete page:', err);
    }
  }, [remove, selectedPath, onSelect]);

  if (loading) {
    return <div className="loading">Loading pages...</div>;
  }

  if (error) {
    return (
      <div className="error">
        <h3>Error loading pages</h3>
        <p>{error.message}</p>
        <button className="btn btn-primary" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="sidebar-header">
        <h2>Pages</h2>
        <button
          className="btn btn-small btn-primary"
          onClick={() => setIsCreating(!isCreating)}
        >
          {isCreating ? '×' : '+ New'}
        </button>
      </div>

      <div className="sidebar-content">
        {isCreating && (
          <form className="create-page-form" onSubmit={handleCreate}>
            <input
              type="text"
              placeholder="/page-path"
              value={newPagePath}
              onChange={(e) => setNewPagePath(e.target.value)}
              autoFocus
            />
            <button type="submit" className="btn btn-small btn-primary">
              Create
            </button>
          </form>
        )}

        {documents.length === 0 ? (
          <div className="empty-state">
            <p>No pages yet</p>
            <p>Click &quot;+ New&quot; to create one</p>
          </div>
        ) : (
          <ul className="page-list">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className={`page-item ${selectedPath === doc.path ? 'active' : ''}`}
                onClick={() => onSelect(doc.path)}
              >
                <span className="page-item-path">{doc.path}</span>
                <button
                  className="page-item-delete"
                  onClick={(e) => handleDelete(e, doc.id, doc.path)}
                  aria-label={`Delete ${doc.path}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * Editor Component
 * Wrapper around Puck editor with auto-save integration
 */
interface EditorProps {
  documentPath: string;
}

function Editor({ documentPath }: EditorProps) {
  const {
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Load document when path changes
  useEffect(() => {
    setLoading(true);
    setError(null);

    loadDocument(documentPath)
      .then(() => setLoading(false))
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [documentPath, loadDocument]);

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

  if (loading) {
    return <div className="loading">Loading document...</div>;
  }

  if (error) {
    return (
      <div className="error">
        <h3>Error loading document</h3>
        <p>{error.message}</p>
      </div>
    );
  }

  if (!currentDocument || !currentData) {
    return (
      <div className="error">
        <h3>Document not found</h3>
        <p>The document at &quot;{documentPath}&quot; could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="editor-area">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <span style={{ fontWeight: 500 }}>{documentPath}</span>
          <SaveIndicator
            status={saveStatus}
            lastSaved={lastSaved}
            error={saveError}
            onRetry={saveNow}
          />
        </div>
        <div className="editor-toolbar-right">
          <BranchSelector
            branches={branches}
            currentBranch={currentBranch}
            onSwitch={switchBranch}
            hasUnsavedChanges={saveStatus === 'saving'}
          />
          <PublishButton
            onPublish={createCheckpoint}
            showNamePrompt
            onSuccess={handlePublishSuccess}
            onError={handlePublishError}
            className="btn css-puck-publish-button"
          >
            Publish
          </PublishButton>
        </div>
      </div>

      <div className="editor-content">
        <Puck
          config={puckConfig}
          data={currentData}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}

/**
 * Empty State
 * Shown when no page is selected
 */
function EmptyState() {
  return (
    <div className="empty-state">
      <h3>No page selected</h3>
      <p>Select a page from the sidebar to start editing, or create a new page.</p>
    </div>
  );
}

/**
 * Main Application Layout
 */
function AppContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPath = searchParams.get('path');

  const handleSelectPage = useCallback(
    (path: string) => {
      if (path) {
        setSearchParams({ path });
      } else {
        setSearchParams({});
      }
    },
    [setSearchParams]
  );

  const { branches, currentBranch, switchBranch } = useCSSPuck();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Puck + CSS Demo</h1>
        <div className="header-controls">
          <BranchSelector
            branches={branches}
            currentBranch={currentBranch}
            onSwitch={switchBranch}
          />
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <PageList selectedPath={selectedPath} onSelect={handleSelectPage} />
        </aside>

        <section className="editor-area">
          {selectedPath ? (
            <Editor documentPath={selectedPath} />
          ) : (
            <EmptyState />
          )}
        </section>
      </main>
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
