/**
 * CSS Puck Plugin
 *
 * Adds CSS functionality to the Puck editor's plugin rail.
 * Provides branch selection, document management, and other CSS-specific controls.
 */

import React, { useState, useEffect } from 'react';
import { Toaster } from '@pantheon-systems/pds-toolkit-react';
import { VersionBannerOverride } from '../components/VersionBannerOverride.js';
import { createPortal } from 'react-dom';
import { createUsePuck } from '@puckeditor/core';
import type {
  Branch,
  Document,
  DocumentVersion,
  PuckData,
  RegisteredAgent,
  ActorPresence,
} from '@pantheon-systems/css-client';
import { PuckDataSynchronizer } from '../components/PuckDataSynchronizer.js';
import { AgentActivityBanner } from '../../collaboration/components/AgentActivityBanner.js';
import { PuckSelectionTracker } from '../components/PuckSelectionTracker.js';
import { PuckDataCapture } from '../components/PuckDataCapture.js';
import { useCSSPuck, useCSSPuckOptional } from '../../core/CSSPuckContext.js';
import { useOptionalCSSAuth } from '../../auth/index.js';
import { MergeResolutionPage } from '../../merge/components/merge-resolution/MergeResolutionPage.js';
import { P1EditorHeader } from '../../pds/components/P1EditorHeader.js';
import { NavIcon } from '../../pds/components/NavIcon.js';
import type { SiteMenuItem, CurrentUser } from '../../pds/components/P1EditorHeader.js';
import { P1EditorSubheader } from '../../pds/components/P1EditorSubheader.js';

const DEFAULT_SITE_MENU_ITEMS: SiteMenuItem[] = [
  { label: 'Code view', iconName: 'squareCode', callback: () => {} },
  { label: 'Site settings', iconName: 'gear', callback: () => {} },
  { label: 'Environments', iconName: 'server', callback: () => {} },
];
import type { SubheaderActor } from '../../pds/components/P1EditorSubheader.js';
import { deriveDocState } from '../../pds/utils/deriveDocState.js';

// Module-level usePuck hook for reading history state inside the plugin render tree
const usePluginPuckHistory = createUsePuck();

interface PuckHistoryState {
  hasPast: boolean;
  hasFuture: boolean;
  back: () => void;
  forward: () => void;
}

interface PuckStateWithHistory {
  history: PuckHistoryState;
}

interface PuckUiState {
  leftSideBarVisible: boolean;
  rightSideBarVisible: boolean;
}

interface PuckStateWithDispatch {
  dispatch: (action: { type: 'setUi'; ui: Partial<PuckUiState> }) => void;
  appState: { ui: PuckUiState };
}

/**
 * Props for the CSS Plugin panel content
 */
interface CSSPluginPanelProps {
  /** List of versions for the current document */
  versions?: DocumentVersion[];
  /** Whether versions are loading */
  versionsLoading?: boolean;
  /** Currently selected version ID for comparison */
  selectedVersionId?: string;
  /** Callback when a version is selected */
  onVersionSelect?: (version: DocumentVersion) => void;
  /** Callback when user restores a previous version to current. */
  onRestoreVersion?: (version: DocumentVersion) => Promise<void>;
  /** Resolves a display name for a version author. Falls back to createdById or type label. */
  resolveAuthorName?: (id: string, type: 'user' | 'agent') => string | undefined;
  /** Currently authenticated user — used to show your own name on your edits. */
  currentUser?: CurrentUser;
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
  /** Callback when stop agent button is clicked */
  onStopAgent?: (agent: ActorPresence) => void;
  /** Whether to show focus regions */
  showFocusRegions?: boolean;
  /** Regions being edited by agents */
  agentEditingRegions?: string[];
}

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
  versions = [],
  versionsLoading = false,
  selectedVersionId,
  onVersionSelect,
  onRestoreVersion,
  resolveAuthorName,
  currentUser,
  // Presence/Agent Features
  showPresenceIndicator = false,
  presence = [],
  showAgentActivity = false,
  activeAgents = [],
  showAgentActions = false,
  availableAgents = [],
  onAgentAction,
  onStopAgent,
  // Focus regions are shown within AgentActivityBanner
  showFocusRegions: _showFocusRegions = false,
  agentEditingRegions: _agentEditingRegions = [],
}: CSSPluginPanelProps): React.ReactElement {
  // Suppress unused variable warnings - these are passed through for future use
  void _showFocusRegions;
  void _agentEditingRegions;

  return (
    <div className="css-plugin-panel">
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
            <ul className="css-plugin-version-list">
              {versions.map((version, index) => {
                const isLatest = index === 0;
                const isSelected = version.id === selectedVersionId;
                const authorName = resolveAuthorName?.(version.createdById, version.createdByType)
                  ?? (version.createdById === currentUser?.id
                    ? (currentUser?.name ?? currentUser?.email ?? 'You')
                    : version.createdByType === 'agent'
                      ? version.createdById
                      : 'User');

                return (
                  <li
                    key={version.id}
                    className={`css-plugin-version-item ${isSelected ? 'css-plugin-version-item--selected' : ''}`}
                    onClick={() => onVersionSelect?.(version)}
                  >
                    <div className="css-plugin-version-main">
                      <span className="css-plugin-version-number">v{version.versionNumber}</span>
                      <span className="css-plugin-version-date">
                        {formatVersionDate(version.createdAt)}
                      </span>
                      {isLatest && (
                        <span className="pds-badge pds-badge--success pds-badge--s">Current</span>
                      )}
                      {version.isPublished && (
                        <span className="pds-badge pds-badge--info pds-badge--s">Published</span>
                      )}
                    </div>
                    <div className="css-plugin-version-author">{authorName}</div>
                    {isSelected && !isLatest && onRestoreVersion && (
                      <button
                        type="button"
                        className="pds-button pds-button--secondary pds-button--sm css-plugin-version-restore"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onRestoreVersion(version);
                        }}
                      >
                        Restore this version
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
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
                  <span
                    className={`css-plugin-presence-state css-plugin-presence-state--${actor.state}`}
                  >
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
            <AgentActivityBanner
              key={agent.id}
              agent={agent}
              showIdle
              onStopAgent={onStopAgent}
            />
          ))}
        </div>
      )}

      {/* Agent Actions Section */}
      {showAgentActions && availableAgents.length > 0 && availableAgents[0] && (
        <div className="css-plugin-section">
          <button
            type="button"
            className="pds-button pds-button--primary pds-button--sm"
            onClick={() => {
              const firstAgent = availableAgents[0];
              if (firstAgent) onAgentAction?.(firstAgent.id, '', []);
            }}
          >
            Ask Agent
          </button>
        </div>
      )}
    </div>
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
  const context = useCSSPuckOptional();
  if (!context) return null;

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
 * Renders PuckDataCapture inside the Puck tree to capture the true current
 * Puck data after each React render. This corrects for Puck's onChange
 * delivering data that lags behind the actual editor state due to React
 * batching — without this, the last keystroke in a typing burst is lost.
 */
function RealtimeDataCaptureBridge(): React.ReactElement | null {
  const context = useCSSPuckOptional();
  if (!context) return null;

  const { _realtimeDataCaptureRef, _onRealtimeDataCapture } = context;

  if (!_realtimeDataCaptureRef || !_onRealtimeDataCapture) {
    return null;
  }

  return (
    <PuckDataCapture dataRef={_realtimeDataCaptureRef} onDataChange={_onRealtimeDataCapture} />
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
  /** Callback when user restores a previous version to current. Calls POST .../versions/:id/restore server-side. */
  onRestoreVersion?: (version: DocumentVersion) => Promise<void>;
  /** Resolves a display name for a version author. Falls back to createdById or type label. */
  resolveAuthorName?: (id: string, type: 'user' | 'agent') => string | undefined;
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
  /** Callback when stop agent button is clicked */
  onStopAgent?: (agent: ActorPresence) => void;
  /** Whether to show focus regions being edited */
  showFocusRegions?: boolean;
  /** Regions currently being edited by agents */
  agentEditingRegions?: string[];
  /** Puck config for rendering merge previews. When provided, enables the built-in merge review overlay. */
  puckConfig?: unknown;
  // Focus Region Reporting
  /**
   * Callback when user selection changes in the Puck editor.
   * Used to report focus regions for proactive collision detection.
   * @param path - JSON path of selected item (e.g., "/content/0"), or null if deselected
   * @param itemId - Component ID, or null if deselected
   */
  onSelectionChange?: (path: string | null, itemId: string | null) => void;
  // P1 Editor Header / Subheader options
  /** Site name displayed in the editor header */
  siteName?: string;
  /** Menu items shown in the site dropdown */
  siteMenuItems?: SiteMenuItem[];
  /** Currently authenticated user */
  currentUser?: CurrentUser;
  /** Callback when user logs out */
  onLogout?: () => void;
  /** Callback for Compare with Live action. When omitted, a built-in overlay is shown. */
  onCompareWithLive?: () => void;
  /** Callback for the publish action. When omitted, context's publishDocument is used. */
  onPublish?: () => Promise<void> | void;
  /** Callback for the Review & Publish action */
  onReviewAndPublish?: () => void;
  /** Callback for the Create Workstream action */
  onCreateWorkstream?: () => void;
  /** Called when the user creates a new workstream. Receives the branch name. */
  onCreateBranch?: (name: string) => Promise<void>;
}

/**
 * Puck Plugin type (matches Puck's expected structure)
 */
export interface PuckPlugin {
  name: string;
  label: string;
  icon: React.ReactNode;
  render: () => React.ReactElement;
  overrides?: {
    header?: () => React.ReactElement;
    [key: string]: unknown;
  };
}

/**
 * Inner component for P1SubheaderBridge — only rendered when CSSPuck context is available.
 * Separating into inner/outer avoids violating Rules of Hooks with a try/catch before hook calls.
 */
function P1SubheaderBridgeInner({
  options,
  cssContext,
}: {
  options: CSSPluginOptions;
  cssContext: ReturnType<typeof useCSSPuck>;
}): React.ReactElement | null {
  const { currentDocument, currentBranch, presence, publishDocument, hasActiveHumans, humanPresenceCount, siteId } = cssContext;

  // Read Puck history state — must be called unconditionally (Rules of Hooks)
  const history = usePluginPuckHistory((s) => (s as unknown as PuckStateWithHistory).history);
  const puckDispatch = usePluginPuckHistory((s) => (s as unknown as PuckStateWithDispatch).dispatch);
  const puckUi = usePluginPuckHistory((s) => (s as unknown as PuckStateWithDispatch).appState?.ui);

  // Find the portal slot after mount
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.getElementById('p1-subheader-slot');
    setSlotEl(el);
  }, []);

  // Persist sidebar visibility to localStorage on every user toggle.
  // Initial state is set via the `ui` prop passed to <Puck> (see useCSSEditor.ts),
  // so no restore dispatch is needed here — we only need to write.
  const sidebarStorageKey = `css-sidebar-${siteId}`;
  useEffect(() => {
    if (!puckUi) return;
    try {
      localStorage.setItem(sidebarStorageKey, JSON.stringify({
        left: puckUi.leftSideBarVisible,
        right: puckUi.rightSideBarVisible,
      }));
    } catch { /* ignore quota/private-browsing errors */ }
  }, [puckUi?.leftSideBarVisible, puckUi?.rightSideBarVisible, sidebarStorageKey]);

  if (!slotEl) return null;

  // Derive document state
  const isOnMain = currentBranch?.isMain ?? true;
  const docState = deriveDocState(currentDocument, isOnMain);

  // Map presence to subheader actor lists.
  // humanPresenceCount and hasActiveHumans are read here so this component
  // subscribes to them as reactive context values. humanPresenceCount changes on
  // every join/leave (catches mid-session departures when hasActiveHumans stays true).
  const agentActors: SubheaderActor[] = (presence?.agents ?? []).map((a) => ({
    id: a.actorId,
    name: a.name,
    isAgent: true,
    intent: a.intent,
  }));
  const humanActors: SubheaderActor[] = humanPresenceCount > 0 && hasActiveHumans
    ? (presence?.humans ?? []).map((a) => ({ id: a.actorId, name: a.name, avatar: a.avatar }))
    : [];

  // History
  const hasPast = history?.hasPast ?? false;
  const hasFuture = history?.hasFuture ?? false;
  const back = history?.back ?? (() => {});
  const forward = history?.forward ?? (() => {});

  // onPublish: consumer override or fall back to context publishDocument
  // Gated by enablePublishButton feature flag
  const handlePublish = (cssContext.featureConfig?.enablePublishButton ?? true)
    ? (options.onPublish ?? (async () => { await publishDocument(); }))
    : undefined;


  // Panel toggle state and handlers
  const leftPanelVisible = puckUi?.leftSideBarVisible ?? true;
  const rightPanelVisible = puckUi?.rightSideBarVisible ?? true;
  const handleToggleLeftPanel = () => {
    puckDispatch?.({ type: 'setUi', ui: { leftSideBarVisible: !leftPanelVisible } });
  };
  const handleToggleRightPanel = () => {
    puckDispatch?.({ type: 'setUi', ui: { rightSideBarVisible: !rightPanelVisible } });
  };

  // onStopAgent: stop by actorId
  const handleStopAgent = (id: string) => {
    if (options.onStopAgent) {
      const agent = presence?.agents.find((a) => a.actorId === id);
      if (agent) {
        options.onStopAgent(agent);
      }
    }
  };

  // Curry delete so PublishControl gets a zero-arg callback
  const handleDeleteDocument = currentDocument && options.onDocumentDelete
    ? async () => { await options.onDocumentDelete?.(currentDocument.id, currentDocument.path); }
    : undefined;

  return (
    <>
      {createPortal(
        <P1EditorSubheader
          puckActions={<></>}
          docState={docState}
          hasDrift={false}
          context={isOnMain ? 'main' : 'branch'}
          agents={agentActors}
          humanActors={humanActors}
          onStopAgent={handleStopAgent}
          onPublish={handlePublish}
          onReviewAndPublish={options.onReviewAndPublish}
          onCreateWorkstream={options.onCreateWorkstream}
          onDeleteDocument={handleDeleteDocument}
          hasPast={hasPast}
          hasFuture={hasFuture}
          onUndo={back}
          onRedo={forward}
          leftPanelVisible={leftPanelVisible}
          rightPanelVisible={rightPanelVisible}
          onToggleLeftPanel={handleToggleLeftPanel}
          onToggleRightPanel={handleToggleRightPanel}
        />,
        slotEl,
      )}
      {createPortal(<Toaster position="top-right" />, document.body)}
    </>
  );
}

/**
 * P1SubheaderBridge
 *
 * Renders inside the plugin's render() so it has access to Puck's context.
 * Portals <P1EditorSubheader> into the #p1-subheader-slot anchor placed by
 * the header override. This keeps the subheader visually anchored below the
 * editor header without being in the same React tree.
 *
 * Uses an error-boundary-like try/catch at the outer level to safely handle
 * cases where CSSPuckContext isn't available.
 */
function P1SubheaderBridge({ options }: { options: CSSPluginOptions }): React.ReactElement | null {
  const cssContext = useCSSPuckOptional();
  if (!cssContext) return null;

  return <P1SubheaderBridgeInner options={options} cssContext={cssContext} />;
}

/**
 * Creates a CSS Plugin for the Puck editor.
 *
 * @example
 * ```tsx
 * import { createCSSPlugin, useCSSPuck } from '@pantheon-systems/puck-css';
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
  const useGetterSync =
    !useContextSync && options.getSyncData !== undefined && options.getDataSyncKey !== undefined;
  const useLegacySync =
    !useContextSync &&
    !useGetterSync &&
    options.syncData !== undefined &&
    options.dataSyncKey !== undefined;

  // Stable ref-backed proxy for options — prevents stale closure issues when
  // options change between renders (callbacks, branch list, etc.)
  const optionsRef = { current: options };
  optionsRef.current = options;
  const stableOptions = new Proxy({} as CSSPluginOptions, {
    get(_target, prop: string) {
      return optionsRef.current[prop as keyof CSSPluginOptions];
    },
  });


  /**
   * Header override component — renders P1EditorHeader plus the subheader slot anchor.
   * Owns `showMergeReview` state for the built-in Compare with Live overlay.
   */
  function HeaderOverride(): React.ReactElement {
    const [showMergeReview, setShowMergeReview] = useState(false);
    const css = useCSSPuck();
    const auth = useOptionalCSSAuth();

    // Merge avatar from live auth state so the header re-renders when the
    // async token validation resolves (stableOptions alone won't trigger it).
    const baseCurrentUser = stableOptions.currentUser;
    const currentUser: CurrentUser | undefined = auth?.user
      ? {
          id: auth.user.id,
          name: auth.user.name,
          email: auth.user.email,
          avatar: auth.user.picture ?? baseCurrentUser?.avatar,
        }
      : baseCurrentUser;

    // Map documents to PageNavigatorDocument shape (filter archived first)
    const rawDocs = stableOptions.documents ?? [];
    const mappedDocs = rawDocs
      .filter((doc) => !doc.archived)
      .map((doc) => ({ id: doc.id, path: doc.path, archived: false as const, inherited: doc.inherited }));

    // Find current document
    const currentDoc =
      rawDocs.find((doc) => doc.path === stableOptions.selectedDocumentPath) ?? null;
    const currentDocMapped = currentDoc ? { id: currentDoc.id, path: currentDoc.path, archived: currentDoc.archived ?? false } : null;

    const fc = css.featureConfig ?? {} as Record<string, boolean>;
    const handleCompareWithLive = (fc.enableMergeControl ?? true)
      ? (stableOptions.onCompareWithLive ?? (() => setShowMergeReview(true)))
      : undefined;
    const handleCreateBranch = (fc.enableBranchSelector ?? true)
      ? (stableOptions.onCreateBranch ?? (async (name: string) => { await css.createBranch(name); }))
      : undefined;

    return (
      <>
        <P1EditorHeader
          branches={(fc.enableBranchSelector ?? true) ? (stableOptions.branches ?? []) : []}
          currentBranch={(fc.enableBranchSelector ?? true) ? (stableOptions.currentBranch ?? null) : null}
          documents={(fc.enableDocumentBrowser ?? true) ? mappedDocs : []}
          currentDocument={(fc.enableDocumentBrowser ?? true) ? currentDocMapped : null}
          siteName={stableOptions.siteName ?? css.siteName ?? ''}
          siteMenuItems={stableOptions.siteMenuItems ?? DEFAULT_SITE_MENU_ITEMS}
          currentUser={currentUser}
          onCreateBranch={handleCreateBranch}
          onSwitchBranch={(fc.enableBranchSelector ?? true)
            ? (stableOptions.onBranchSwitch ?? (() => {})) : () => {}}
          onSelectDocument={(fc.enableDocumentBrowser ?? true)
            ? (doc) => stableOptions.onDocumentSelect?.(doc.path) : () => {}}
          onCreateDocument={(fc.enableDocumentBrowser ?? true) ? stableOptions.onDocumentCreate : undefined}
          onCompareWithLive={handleCompareWithLive ?? (() => {})}
          onLogout={stableOptions.onLogout ?? (() => {})}
        />
        <div id="p1-subheader-slot" />
        {(fc.enableMergeControl ?? true) && showMergeReview && (() => {
          const mainBranch = (stableOptions.branches ?? []).find((b) => b.isMain);
          const activeBranch = stableOptions.currentBranch;
          if (!mainBranch || !activeBranch || activeBranch.isMain) return null;
          return createPortal(
            <div
              style={{
                position: 'fixed',
                top: 'var(--p1-header-height, 56px)',
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 10000,
              }}
            >
              <MergeResolutionPage
                client={css.client}
                siteId={css.siteId}
                sourceBranchId={css.branchId}
                targetBranchId={mainBranch.id}
                sourceBranchName={activeBranch.name}
                targetBranchName="Live"
                config={stableOptions.puckConfig}
                onClose={() => setShowMergeReview(false)}
                onMergeComplete={() => setShowMergeReview(false)}
              />
            </div>,
            document.body,
          );
        })()}
      </>
    );
  }

  return {
    name: 'css',
    label: 'History',
    icon: <NavIcon iconName="rotateClock" />,
    render: () => (
      <>
        {/* Sync data to Puck - context-based is preferred (most reliable),
            falls back to getter-based or direct props for backwards compatibility */}
        {useContextSync && <ContextSyncBridge />}
        {useGetterSync && options.getSyncData && options.getDataSyncKey && (
          <SyncDataPoller
            getSyncData={options.getSyncData}
            getDataSyncKey={options.getDataSyncKey}
          />
        )}
        {useLegacySync && options.syncData && options.dataSyncKey && (
          <PuckDataSynchronizer data={options.syncData} syncKey={options.dataSyncKey} />
        )}
        {/* Capture true Puck data for realtime correction pass */}
        {useContextSync && <RealtimeDataCaptureBridge />}
        {/* Track selection changes for focus region reporting */}
        {options.onSelectionChange && (
          <PuckSelectionTracker onSelectionChange={options.onSelectionChange} />
        )}
        {/* Nav tooltips are handled by PuckEditorTheme.css — labels are repositioned as hover tooltips */}
        {/* Subheader bridge — portals P1EditorSubheader into the slot placed by header override */}
        <P1SubheaderBridge options={stableOptions} />
        <CSSPluginPanel
          versions={options.versions}
          versionsLoading={options.versionsLoading}
          selectedVersionId={options.selectedVersionId}
          onVersionSelect={options.onVersionSelect}
          onRestoreVersion={options.onRestoreVersion}
          resolveAuthorName={options.resolveAuthorName}
          currentUser={options.currentUser}
          // Presence/Agent Features
          showPresenceIndicator={options.showPresenceIndicator}
          presence={options.presence}
          showAgentActivity={options.showAgentActivity}
          activeAgents={options.activeAgents}
          showAgentActions={options.showAgentActions}
          availableAgents={options.availableAgents}
          onAgentAction={options.onAgentAction}
          onStopAgent={options.onStopAgent}
          showFocusRegions={options.showFocusRegions}
          agentEditingRegions={options.agentEditingRegions}
        />
      </>
    ),
    overrides: {
      header: () => <HeaderOverride />,
      preview: ({ children }: { children: React.ReactNode }) => (
        <VersionBannerOverride
          versions={stableOptions.versions ?? []}
          selectedVersionId={stableOptions.selectedVersionId}
          onVersionSelect={stableOptions.onVersionSelect}
        >
          {children}
        </VersionBannerOverride>
      ),
    },
  };
}
