/**
 * CSS Puck Plugin
 *
 * Adds CSS functionality to the Puck editor's plugin rail.
 * Provides branch selection, document management, and other CSS-specific controls.
 */

import React, { useState, useCallback } from 'react';
import type { Branch, Document, DocumentVersion } from '@pantheon/css-client';

/**
 * Props for the CSS Plugin panel content
 */
interface CSSPluginPanelProps {
  /** List of available branches */
  branches: Branch[];
  /** Currently selected branch */
  currentBranch: Branch | null;
  /** Callback when branch is switched */
  onBranchSwitch: (branchId: string) => void;
  /** Whether there are unsaved changes */
  hasUnsavedChanges?: boolean;
  /** List of documents on the current branch */
  documents?: Document[];
  /** Currently selected document path */
  selectedDocumentPath?: string | null;
  /** Callback when a document is selected */
  onDocumentSelect?: (path: string) => void;
  /** Callback to create a new document */
  onDocumentCreate?: (path: string) => Promise<void>;
  /** Callback to delete a document */
  onDocumentDelete?: (documentId: string, path: string) => Promise<void>;
  /** Whether documents are loading */
  documentsLoading?: boolean;
  /** List of versions for the current document */
  versions?: DocumentVersion[];
  /** Whether versions are loading */
  versionsLoading?: boolean;
  /** Currently selected version ID for comparison */
  selectedVersionId?: string;
  /** Callback when a version is selected */
  onVersionSelect?: (version: DocumentVersion) => void;
}

/**
 * Plugin panel content component
 */
/**
 * Formats a date string for display.
 */
function formatVersionDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CSSPluginPanel({
  branches,
  currentBranch,
  onBranchSwitch,
  hasUnsavedChanges = false,
  documents = [],
  selectedDocumentPath,
  onDocumentSelect,
  onDocumentCreate,
  onDocumentDelete,
  documentsLoading = false,
  versions = [],
  versionsLoading = false,
  selectedVersionId,
  onVersionSelect,
}: CSSPluginPanelProps): React.ReactElement {
  const [isCreating, setIsCreating] = useState(false);
  const [newDocPath, setNewDocPath] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const handleBranchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBranchId = e.target.value;
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Switch branch anyway?'
      );
      if (!confirmed) return;
    }
    onBranchSwitch(newBranchId);
  };

  const handleCreateDocument = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocPath.trim() || !onDocumentCreate) return;

    const path = newDocPath.startsWith('/') ? newDocPath.slice(1) : newDocPath;
    setCreateError(null);

    try {
      await onDocumentCreate(path);
      setNewDocPath('');
      setIsCreating(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create document');
    }
  }, [newDocPath, onDocumentCreate]);

  const handleDeleteDocument = useCallback(async (e: React.MouseEvent, docId: string, path: string) => {
    e.stopPropagation();
    if (!onDocumentDelete) return;
    if (!window.confirm(`Delete "${path}"?`)) return;

    try {
      await onDocumentDelete(docId, path);
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  }, [onDocumentDelete]);

  return (
    <div className="css-plugin-panel">
      {/* Branch Selection */}
      <div className="css-plugin-section">
        <label className="css-plugin-label" htmlFor="css-branch-select">
          Branch
        </label>
        <select
          id="css-branch-select"
          className="css-plugin-select"
          value={currentBranch?.id ?? ''}
          onChange={handleBranchChange}
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
              {branch.isMain ? ' (main)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Document Management */}
      {onDocumentSelect && (
        <div className="css-plugin-section">
          <div className="css-plugin-section-header">
            <label className="css-plugin-label">Documents</label>
            {onDocumentCreate && (
              <button
                type="button"
                className="css-plugin-btn-small"
                onClick={() => setIsCreating(!isCreating)}
              >
                {isCreating ? '×' : '+'}
              </button>
            )}
          </div>

          {isCreating && onDocumentCreate && (
            <form className="css-plugin-create-form" onSubmit={handleCreateDocument}>
              <input
                type="text"
                className="css-plugin-input"
                placeholder="/page-path"
                value={newDocPath}
                onChange={(e) => setNewDocPath(e.target.value)}
                autoFocus
              />
              <button type="submit" className="css-plugin-btn-small css-plugin-btn-primary">
                Create
              </button>
              {createError && (
                <div className="css-plugin-error">{createError}</div>
              )}
            </form>
          )}

          {documentsLoading ? (
            <div className="css-plugin-loading">Loading...</div>
          ) : documents.length === 0 ? (
            <div className="css-plugin-empty">No documents yet</div>
          ) : (
            <ul className="css-plugin-doc-list">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className={`css-plugin-doc-item ${selectedDocumentPath === doc.path ? 'css-plugin-doc-item--active' : ''}`}
                  onClick={() => onDocumentSelect(doc.path)}
                >
                  <span className="css-plugin-doc-path">{doc.path}</span>
                  {onDocumentDelete && (
                    <button
                      type="button"
                      className="css-plugin-doc-delete"
                      onClick={(e) => handleDeleteDocument(e, doc.id, doc.path)}
                      aria-label={`Delete ${doc.path}`}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Version History */}
      {(versions.length > 0 || versionsLoading || onVersionSelect) && (
        <div className="css-plugin-section">
          <div className="css-plugin-section-header">
            <label className="css-plugin-label">Version History</label>
          </div>

          {versionsLoading ? (
            <div className="css-plugin-loading">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="css-plugin-empty">No versions yet</div>
          ) : (
            <>
              <ul className="css-plugin-version-list">
                {versions.map((version, index) => {
                  const isLatest = index === 0;
                  const isSelected = version.id === selectedVersionId;

                  return (
                    <li
                      key={version.id}
                      className={`css-plugin-version-item ${isSelected ? 'css-plugin-version-item--selected' : ''}`}
                      onClick={() => onVersionSelect?.(version)}
                    >
                      <span className="css-plugin-version-number">
                        v{version.versionNumber}
                      </span>
                      <span className="css-plugin-version-date">
                        {formatVersionDate(version.createdAt)}
                      </span>
                      {isLatest && (
                        <span className="css-plugin-version-badge">current</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * CSS Plugin icon component
 */
function CSSPluginIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 4h12M2 8h12M2 12h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Options for creating the CSS Plugin
 */
export interface CSSPluginOptions {
  /** List of available branches */
  branches: Branch[];
  /** Currently selected branch */
  currentBranch: Branch | null;
  /** Callback when branch is switched */
  onBranchSwitch: (branchId: string) => void;
  /** Whether there are unsaved changes */
  hasUnsavedChanges?: boolean;
  /** List of documents on the current branch */
  documents?: Document[];
  /** Currently selected document path */
  selectedDocumentPath?: string | null;
  /** Callback when a document is selected */
  onDocumentSelect?: (path: string) => void;
  /** Callback to create a new document */
  onDocumentCreate?: (path: string) => Promise<void>;
  /** Callback to delete a document */
  onDocumentDelete?: (documentId: string, path: string) => Promise<void>;
  /** Whether documents are loading */
  documentsLoading?: boolean;
  /** List of versions for the current document */
  versions?: DocumentVersion[];
  /** Whether versions are loading */
  versionsLoading?: boolean;
  /** Currently selected version ID for comparison */
  selectedVersionId?: string;
  /** Callback when a version is selected */
  onVersionSelect?: (version: DocumentVersion) => void;
}

/**
 * Puck Plugin type (matches Puck's expected structure)
 */
export interface PuckPlugin {
  name: string;
  label: string;
  icon: React.ReactNode;
  render: () => React.ReactElement;
  overrides?: object;
}

/**
 * Creates a CSS Plugin for the Puck editor.
 *
 * @example
 * ```tsx
 * import { createCSSPlugin, useCSSPuck } from '@pantheon/puck-css';
 *
 * function Editor() {
 *   const { branches, currentBranch, switchBranch, saveStatus } = useCSSPuck();
 *
 *   const cssPlugin = createCSSPlugin({
 *     branches,
 *     currentBranch,
 *     onBranchSwitch: switchBranch,
 *     hasUnsavedChanges: saveStatus === 'saving',
 *   });
 *
 *   return <Puck plugins={[cssPlugin]} {...otherProps} />;
 * }
 * ```
 */
export function createCSSPlugin(options: CSSPluginOptions): PuckPlugin {
  return {
    name: 'css',
    label: 'CSS',
    icon: <CSSPluginIcon />,
    render: () => (
      <CSSPluginPanel
        branches={options.branches}
        currentBranch={options.currentBranch}
        onBranchSwitch={options.onBranchSwitch}
        hasUnsavedChanges={options.hasUnsavedChanges}
        documents={options.documents}
        selectedDocumentPath={options.selectedDocumentPath}
        onDocumentSelect={options.onDocumentSelect}
        onDocumentCreate={options.onDocumentCreate}
        onDocumentDelete={options.onDocumentDelete}
        documentsLoading={options.documentsLoading}
        versions={options.versions}
        versionsLoading={options.versionsLoading}
        selectedVersionId={options.selectedVersionId}
        onVersionSelect={options.onVersionSelect}
      />
    ),
    overrides: {},
  };
}
