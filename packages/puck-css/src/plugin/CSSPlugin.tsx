/**
 * CSS Puck Plugin
 *
 * Adds CSS functionality to the Puck editor's plugin rail.
 * Provides branch selection, document management, and other CSS-specific controls.
 */

import React, { useState, useCallback } from 'react';
import type { Branch, Document, DocumentVersion, PuckData, RegisteredAgent, ActorPresence } from '@pantheon/css-client';
import { PuckDataSynchronizer } from '../components/PuckDataSynchronizer.js';
import { AgentActivityBanner } from '../components/presence/AgentActivityBanner.js';
import { PuckSelectionTracker } from '../components/PuckSelectionTracker.js';
import { useCSSPuck } from '../CSSPuckContext.js';

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
  /** Getter function to check if there are unsaved changes (function to avoid stale closures) */
  getHasUnsavedChanges?: () => boolean;
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
  // Presence/Agent Features
  /** Whether to show presence indicator */
  showPresenceIndicator?: boolean;
  /** Current presence list */
  presence?: ActorPresence[];
  /** Whether to show agent activity section */
  showAgentActivity?: boolean;
  /** Currently active agents */
  activeAgents?: ActorPresence[];
  /** Whether to show agent action trigger */
  showAgentActions?: boolean;
  /** Available agents for actions */
  availableAgents?: RegisteredAgent[];
  /** Callback when agent action is triggered */
  onAgentAction?: (agentId: string, intent: string, targetRegions?: string[]) => void;
  /** Whether to show focus regions */
  showFocusRegions?: boolean;
  /** Regions being edited by agents */
  agentEditingRegions?: string[];
  /** Callback when "Compare with main" is clicked. Receives the main branch ID. */
  onMergeCompare?: (targetBranchId: string) => void;
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
  getHasUnsavedChanges,
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
  // Presence/Agent Features
  showPresenceIndicator = false,
  presence = [],
  showAgentActivity = false,
  activeAgents = [],
  showAgentActions = false,
  availableAgents = [],
  onAgentAction,
  // Focus regions are shown within AgentActivityBanner
  showFocusRegions: _showFocusRegions = false,
  agentEditingRegions: _agentEditingRegions = [],
  onMergeCompare,
}: CSSPluginPanelProps): React.ReactElement {
  // Suppress unused variable warnings - these are passed through for future use
  void _showFocusRegions;
  void _agentEditingRegions;
  const [isCreating, setIsCreating] = useState(false);
  const [newDocPath, setNewDocPath] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const handleBranchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBranchId = e.target.value;
    // Call the getter function to check current unsaved state (avoids stale closures)
    if (getHasUnsavedChanges?.()) {
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
        {onMergeCompare && currentBranch && !currentBranch.isMain && (() => {
          const mainBranch = branches.find((b) => b.isMain);
          if (!mainBranch) return null;
          return (
            <button
              type="button"
              className="css-plugin-btn css-plugin-btn-compare"
              onClick={() => onMergeCompare(mainBranch.id)}
              style={{ marginTop: 8 }}
            >
              Compare with main
            </button>
          );
        })()}
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

      {/* Presence Section */}
      {showPresenceIndicator && (
        <div className="css-plugin-section">
          <div className="css-plugin-section-header">
            <label className="css-plugin-label">Collaborators</label>
          </div>
          {presence.length === 0 ? (
            <div className="css-plugin-empty">No collaborators</div>
          ) : (
            <ul className="css-plugin-presence-list">
              {presence.map((actor) => (
                <li key={actor.id} className="css-plugin-presence-item">
                  <span className="css-plugin-presence-name">{actor.name}</span>
                  <span className={`css-plugin-presence-state css-plugin-presence-state--${actor.state}`}>
                    {actor.state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Agent Activity Section */}
      {showAgentActivity && activeAgents.length > 0 && (
        <div className="css-plugin-section">
          <div className="css-plugin-section-header">
            <label className="css-plugin-label">Agent Activity</label>
          </div>
          {activeAgents.map((agent) => (
            <AgentActivityBanner key={agent.id} agent={agent} showIdle />
          ))}
        </div>
      )}

      {/* Agent Actions Section */}
      {showAgentActions && availableAgents.length > 0 && availableAgents[0] && (
        <div className="css-plugin-section">
          <button
            type="button"
            className="css-plugin-btn css-plugin-btn-primary"
            onClick={() => onAgentAction?.(availableAgents[0]!.id, '', [])}
          >
            Ask Agent
          </button>
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
 * Wrapper component that polls getter functions for sync data.
 * This allows the plugin to remain stable while still syncing data when needed.
 * Uses polling to detect when the sync key changes, then triggers a sync.
 */
function SyncDataPoller({
  getSyncData,
  getDataSyncKey,
}: {
  getSyncData: () => PuckData | undefined;
  getDataSyncKey: () => string | undefined;
}): React.ReactElement | null {
  const [syncState, setSyncState] = useState<{
    data: PuckData | null;
    key: string | null;
  }>({ data: null, key: null });

  // Poll for changes at a reasonable interval
  React.useEffect(() => {
    // Check immediately on mount
    const checkForUpdates = () => {
      const newKey = getDataSyncKey();
      const newData = getSyncData();

      if (newKey !== undefined && newKey !== syncState.key) {
        setSyncState({
          data: newData ?? null,
          key: newKey,
        });
      }
    };

    // Initial check
    checkForUpdates();

    // Poll every 50ms for changes - fast enough for real-time, cheap enough to not impact performance
    const interval = setInterval(checkForUpdates, 50);

    return () => clearInterval(interval);
  }, [getSyncData, getDataSyncKey, syncState.key]);

  if (!syncState.data || !syncState.key) {
    return null;
  }

  return <PuckDataSynchronizer data={syncState.data} syncKey={syncState.key} />;
}

/**
 * Component that reads sync data directly from CSSPuckContext.
 * This is the preferred sync mechanism as it keeps all sync logic in the integration layer,
 * rather than requiring consumers to manage sync state.
 *
 * The component computes the sync key from context values:
 * - remoteSyncKey takes priority (for real-time updates)
 * - Falls back to viewingVersion or currentDocument for initial load/version switching
 *
 * Note: The actual deduplication of syncs is handled by PuckDataSynchronizer using
 * module-level tracking. This component simply passes through the current sync key
 * without any side effects during render.
 */
function ContextSyncBridge(): React.ReactElement | null {
  // Try to get context - may fail if not inside CSSPuckProvider
  let context: ReturnType<typeof useCSSPuck> | null = null;
  try {
    context = useCSSPuck();
  } catch {
    // Not inside CSSPuckProvider, skip context-based sync
    return null;
  }

  const { currentData, remoteSyncKey, currentDocument, viewingVersion } = context;

  // Compute the sync key from context values
  // - remoteSyncKey takes priority for real-time updates (changes with each remote update)
  // - viewingVersion for viewing historical versions
  // - currentDocument for initial document load
  const syncKey = remoteSyncKey
    ? remoteSyncKey // Remote updates take priority - unique per update via Date.now()
    : viewingVersion
      ? `version-${viewingVersion.id}`
      : currentDocument
        ? `doc-${currentDocument.id}-latest`
        : null;

  if (!currentData || !syncKey) {
    return null;
  }

  // PuckDataSynchronizer handles deduplication via module-level tracking
  // in its useEffect, so we can safely pass the current sync key every time
  return <PuckDataSynchronizer data={currentData} syncKey={syncKey} />;
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
  /** Getter function to check if there are unsaved changes (function to avoid stale closures) */
  getHasUnsavedChanges?: () => boolean;
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
  /** Callback to compare two versions */
  onCompare?: (beforeVersionId: string, afterVersionId: string) => void;
  /**
   * Data to sync to Puck's internal state. Used with dataSyncKey
   * to update Puck's data without remounting (preserving sidebar state).
   * This is rendered inside the plugin which is guaranteed to be inside Puck's context.
   * @deprecated Use getSyncData getter for better performance (avoids plugin recreation)
   */
  syncData?: PuckData | null;
  /**
   * Key that changes when we want to force a data sync to Puck.
   * Use version ID or document ID to trigger sync on version/document changes.
   * @deprecated Use getDataSyncKey getter for better performance (avoids plugin recreation)
   */
  dataSyncKey?: string | null;
  /**
   * Getter function for sync data. Preferred over syncData to avoid plugin recreation
   * on every sync, which reduces flickering during real-time collaboration.
   */
  getSyncData?: () => PuckData | undefined;
  /**
   * Getter function for data sync key. Preferred over dataSyncKey to avoid plugin recreation
   * on every sync, which reduces flickering during real-time collaboration.
   */
  getDataSyncKey?: () => string | undefined;
  /**
   * When true, the plugin reads sync data directly from CSSPuckContext.
   * This is the recommended approach as it keeps sync logic in the integration layer.
   * When false, you must provide syncData/dataSyncKey or getSyncData/getDataSyncKey.
   * @default true
   */
  useContextSync?: boolean;
  // Presence/Agent Features
  /** Whether to show presence indicator in the plugin panel */
  showPresenceIndicator?: boolean;
  /** Current presence list */
  presence?: ActorPresence[];
  /** Whether to show agent activity section */
  showAgentActivity?: boolean;
  /** Currently active agents */
  activeAgents?: ActorPresence[];
  /** Whether to show agent action trigger button */
  showAgentActions?: boolean;
  /** Available agents for triggering actions */
  availableAgents?: RegisteredAgent[];
  /** Callback when agent action is triggered */
  onAgentAction?: (agentId: string, intent: string, targetRegions?: string[]) => void;
  /** Whether to show focus regions being edited */
  showFocusRegions?: boolean;
  /** Regions currently being edited by agents */
  agentEditingRegions?: string[];
  /** Callback when "Compare with main" is clicked. Receives the main branch ID. */
  onMergeCompare?: (targetBranchId: string) => void;
  // Focus Region Reporting
  /**
   * Callback when user selection changes in the Puck editor.
   * Used to report focus regions for proactive collision detection.
   * @param path - JSON path of selected item (e.g., "/content/0"), or null if deselected
   * @param itemId - Component ID, or null if deselected
   */
  onSelectionChange?: (path: string | null, itemId: string | null) => void;
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
  // Determine which sync mechanism to use (in order of preference):
  // 1. Context-based (default): Reads from CSSPuckContext directly - most reliable
  // 2. Getter functions: Uses SyncDataPoller which polls for changes
  // 3. Direct values (legacy): Uses PuckDataSynchronizer directly (causes plugin recreation)
  const useContextSync = options.useContextSync !== false; // Default to true
  const useGetterSync = !useContextSync && options.getSyncData !== undefined && options.getDataSyncKey !== undefined;
  const useLegacySync = !useContextSync && !useGetterSync && options.syncData !== undefined && options.dataSyncKey !== undefined;

  return {
    name: 'css',
    label: 'CSS',
    icon: <CSSPluginIcon />,
    render: () => (
      <>
        {/* Sync data to Puck - context-based is preferred (most reliable),
            falls back to getter-based or direct props for backwards compatibility */}
        {useContextSync && <ContextSyncBridge />}
        {useGetterSync && (
          <SyncDataPoller
            getSyncData={options.getSyncData!}
            getDataSyncKey={options.getDataSyncKey!}
          />
        )}
        {useLegacySync && (
          <PuckDataSynchronizer data={options.syncData!} syncKey={options.dataSyncKey!} />
        )}
        {/* Track selection changes for focus region reporting */}
        {options.onSelectionChange && (
          <PuckSelectionTracker onSelectionChange={options.onSelectionChange} />
        )}
        <CSSPluginPanel
          branches={options.branches}
          currentBranch={options.currentBranch}
          onBranchSwitch={options.onBranchSwitch}
          getHasUnsavedChanges={options.getHasUnsavedChanges}
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
          // Presence/Agent Features
          showPresenceIndicator={options.showPresenceIndicator}
          presence={options.presence}
          showAgentActivity={options.showAgentActivity}
          activeAgents={options.activeAgents}
          showAgentActions={options.showAgentActions}
          availableAgents={options.availableAgents}
          onAgentAction={options.onAgentAction}
          showFocusRegions={options.showFocusRegions}
          agentEditingRegions={options.agentEditingRegions}
          onMergeCompare={options.onMergeCompare}
        />
      </>
    ),
    overrides: {},
  };
}
