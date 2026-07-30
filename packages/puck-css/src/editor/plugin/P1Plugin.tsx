/**
 * P1 Puck Plugin
 *
 * Adds P1 functionality to the Puck editor's plugin rail.
 * Provides branch selection, document management, and other P1-specific controls.
 */

import React, { useState, useEffect, useRef } from 'react';
import { dayLabel } from '../../versioning/utils/formatVersionDate.js';
import { isMilestone } from '../../versioning/utils/versionKind.js';
import { Toaster, IconButton, SegmentedButton } from '@pantheon-systems/pds-toolkit-react';
import { VersionBannerOverride } from '../components/VersionBannerOverride.js';
import { VersionTimeline } from '../components/VersionTimeline.js';
import { createPortal } from 'react-dom';
import { createUsePuck } from '@puckeditor/core';
import type {
  Branch,
  Document,
  DocumentVersion,
  PuckData,
  RegisteredAgent,
  ActorPresence,
  ActorState,
} from '@pantheon-systems/css-client';
import { PuckDataSynchronizer } from '../components/PuckDataSynchronizer.js';
import { resolveContextSyncKey } from './context-sync-key.js';
import type { DocumentSyncStore } from './document-sync-plugin.js';
import { AgentActivityBanner } from '../../collaboration/components/AgentActivityBanner.js';
import { PuckSelectionTracker } from '../components/PuckSelectionTracker.js';
import { PuckDataCapture } from '../components/PuckDataCapture.js';
import { useP1Puck, useP1PuckOptional } from '../../core/P1PuckContext.js';
import { useOptionalP1Auth } from '../../auth/index.js';
import { MergeResolutionPage } from '../../merge/components/merge-resolution/MergeResolutionPage.js';
import { P1EditorHeader } from '../../pds/components/P1EditorHeader.js';
import { NavIcon } from '../../pds/components/NavIcon.js';
import type { SiteMenuItem, CurrentUser } from '../../pds/components/P1EditorHeader.js';
import { P1EditorSubheader } from '../../pds/components/P1EditorSubheader.js';

import type { SubheaderActor } from '../../pds/components/P1EditorSubheader.js';
import { deriveDocState } from '../../pds/utils/deriveDocState.js';
import { deriveLiveDocState } from '../../pds/utils/deriveLiveDocState.js';
import type { Template } from '../../features/content-type-templates/types.js';
import { useEditorContext } from '../../p1/editor/index.js';

// Module-level usePuck hook for reading history state inside the plugin render tree
const usePluginPuckHistory = createUsePuck();

// Module-level usePuck hook for accessing refreshPermissions
const usePluginPuckPermissions = createUsePuck();

/**
 * Watches for changes to permission-affecting state (user role, template,
 * historical version) and forces Puck to re-resolve all component permissions.
 *
 * Puck caches resolvePermissions results per component instance and only
 * re-resolves when the component's own data changes. Changes to the
 * resolver function (from role/template switches) don't invalidate the cache.
 * This component bridges that gap by calling refreshPermissions(force=true)
 * whenever the P1 permission resolver reference changes.
 */
export function PermissionRefresher(): React.ReactElement | null {
  const css = useP1PuckOptional();
  const refreshPerms = usePluginPuckPermissions(
    (s) => (s as unknown as { refreshPermissions: () => Promise<void> }).refreshPermissions
  );

  const resolvePermsRef = useRef(css?.resolvePermissions);

  useEffect(() => {
    if (!css?.resolvePermissions || !refreshPerms) return;

    if (css.resolvePermissions !== resolvePermsRef.current) {
      resolvePermsRef.current = css.resolvePermissions;
      void refreshPerms();
    }
  }, [css?.resolvePermissions, refreshPerms]);

  return null;
}

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
interface P1PluginPanelProps {
  /** List of versions for the current document */
  versions?: DocumentVersion[];
  /** Whether versions are loading */
  versionsLoading?: boolean;
  /** Currently selected version ID for comparison */
  selectedVersionId?: string;
  /** Callback when a version is selected */
  onVersionSelect?: (version: DocumentVersion) => void;
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
  /** Collapses the plugin rail. */
  onCollapse?: () => void;
  /** Called whenever the displayed (filtered) version list changes. Used to sync filter state to the banner steppers. */
  onFilteredVersionsChange?: (versions: DocumentVersion[]) => void;
}

const ACTOR_STATES: ActorState[] = ['active', 'idle', 'editing'];
const ALLOWED_ACTOR_STATES = new Set<ActorState>(ACTOR_STATES);

function groupVersionsByDay(
  versions: DocumentVersion[],
): Array<{ label: string; versions: DocumentVersion[] }> {
  const map = new Map<string, DocumentVersion[]>();
  const order: string[] = [];
  for (const v of versions) {
    const label = dayLabel(v.createdAt) || 'Unknown';
    if (!map.has(label)) {
      map.set(label, [v]);
      order.push(label);
    } else {
      map.get(label)?.push(v);
    }
  }
  return order.map((label) => ({ label, versions: map.get(label) ?? [] }));
}


function P1PluginPanel({
  versions = [],
  versionsLoading = false,
  selectedVersionId,
  onVersionSelect,
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
  onCollapse,
  onFilteredVersionsChange,
}: P1PluginPanelProps): React.ReactElement {
  // Suppress unused variable warnings - these are passed through for future use
  void _showFocusRegions;
  void _agentEditingRegions;

  const [filter, setFilter] = useState<'all' | 'milestones'>('all');

  // versions are newest-first; index 0 is always the current version.
  const currentVersionId = versions[0]?.id;

  // unpublishedCount = number of versions newer than the last published one.
  // When no version has ever been published (findIndex returns -1), suppressed.
  const lastPublishedIdx = versions.findIndex(v => v.isPublished);
  const unpublishedCount = lastPublishedIdx > 0 ? lastPublishedIdx : 0;

  // True while previewing a historical version (a non-current version is selected).
  const isPreviewing = !!selectedVersionId && selectedVersionId !== currentVersionId;

  // Apply filter then group by calendar day.
  const displayedVersions = React.useMemo(
    () => filter === 'milestones' ? versions.filter(isMilestone) : versions,
    [filter, versions],
  );
  const dayGroups = groupVersionsByDay(displayedVersions);

  // Notify parent of filtered list so banner steppers can navigate within it.
  useEffect(() => {
    onFilteredVersionsChange?.(displayedVersions);
  }, [displayedVersions, onFilteredVersionsChange]);

  return (
    <div className="css-plugin-panel">
      {/* Panel-level header: bold title + collapse button */}
      <div className="css-plugin-panel-header">
        <span className="css-plugin-panel-title">Version history</span>
        <IconButton
          ariaLabel="Collapse panel"
          iconName="anglesLeft"
          size="s"
          hasTooltip={true}
          hasBorder={false}
          onClick={onCollapse}
        />
      </div>

      {/* Version History */}
      {(versions.length > 0 || versionsLoading || onVersionSelect) && (
        <div className="css-plugin-section">
          <div className="css-plugin-section-header">
            <label className="css-plugin-label">Version History</label>
          </div>

          {/* All versions / Milestones filter */}
          {versions.length > 0 && (
            <div className="css-plugin-version-filter">
              <SegmentedButton
                id="version-history-filter"
                label="Version filter"
                value={filter}
                onChange={(val) => setFilter(val as 'all' | 'milestones')}
                options={[
                  { label: 'All versions', value: 'all' },
                  { label: 'Milestones', value: 'milestones' },
                ]}
              />
            </div>
          )}

          {versionsLoading ? (
            <div className="css-plugin-loading">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="css-plugin-empty">No versions yet</div>
          ) : (
            <VersionTimeline
              dayGroups={dayGroups}
              allVersions={versions}
              selectedVersionId={selectedVersionId}
              currentVersionId={currentVersionId}
              isPreviewing={isPreviewing}
              unpublishedCount={unpublishedCount}
              currentUser={currentUser}
              resolveAuthorName={resolveAuthorName}
              onVersionSelect={onVersionSelect}
            />
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
              {presence.map((actor) => {
                const safeState = ALLOWED_ACTOR_STATES.has(actor.state) ? actor.state : 'idle';
                return (
                  <li key={actor.id} className="css-plugin-presence-item">
                    <span className="css-plugin-presence-name">{actor.name}</span>
                    <span
                      className={`css-plugin-presence-state css-plugin-presence-state--${safeState}`}
                    >
                      {safeState}
                    </span>
                  </li>
                );
              })}
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
 * Component that reads sync data directly from P1PuckContext.
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
function ContextSyncBridge({
  documentSyncStore,
}: {
  documentSyncStore?: Pick<DocumentSyncStore, 'getAppliedKey'>;
}): React.ReactElement | null {
  const context = useP1PuckOptional();
  if (!context) return null;

  const { currentData, remoteSyncKey, currentDocument, viewingVersion, branchId } = context;

  // See resolveContextSyncKey: remote updates win, then historical versions,
  // then doc-latest — which stands down for document switches the
  // document-sync plugin owns.
  const syncKey = resolveContextSyncKey({
    remoteSyncKey,
    viewingVersion,
    currentDocument,
    branchId,
    documentSyncStore,
  });

  if (!currentData || !syncKey) {
    return null;
  }

  // Puck's setData action merges: { ...state.data, ...newData }.
  // If the snapshot has no `zones` key, Puck preserves stale zones from the
  // prior version, which can produce duplicate-key errors in the rendered tree.
  // Explicitly setting zones: {} ensures the dispatch replaces any stale zones.
  const safeData = currentData.zones != null
    ? currentData
    : { ...currentData, zones: {} };

  return <PuckDataSynchronizer data={safeData} syncKey={syncKey} />;
}

/**
 * Renders PuckDataCapture inside the Puck tree to capture the true current
 * Puck data after each React render. This corrects for Puck's onChange
 * delivering data that lags behind the actual editor state due to React
 * batching — without this, the last keystroke in a typing burst is lost.
 */
function RealtimeDataCaptureBridge(): React.ReactElement | null {
  const context = useP1PuckOptional();
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
export interface P1PluginOptions {
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
  onDocumentCreate?: (path: string, template?: import('../../features/content-type-templates/types.js').TemplateSummary | null, title?: string) => Promise<void>;
  /** Callback to delete a document */
  onDocumentDelete?: (documentId: string, path: string) => Promise<void>;
  /** Whether documents are loading */
  documentsLoading?: boolean;
  /** List of versions for the current document */
  versions?: DocumentVersion[];
  /** Whether versions are loading */
  versionsLoading?: boolean;
  /** Published status for the doc-state badge. Drives the Live-only publish badge. */
  publishedStatus?: 'published' | 'unpublished-changes' | 'draft';
  /** Currently selected version ID for comparison */
  selectedVersionId?: string;
  /** Callback when a version is selected */
  onVersionSelect?: (version: DocumentVersion) => void;
  /** Callback when user restores a previous version to current. Calls POST .../versions/:id/restore server-side. */
  onRestoreVersion?: (version: DocumentVersion) => Promise<void>;
  /** Whether the current user is allowed to revert versions. */
  canRevert?: boolean;
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
   * When true, the plugin reads sync data directly from P1PuckContext.
   * This is the recommended approach as it keeps sync logic in the integration layer.
   * When false, you must provide syncData/dataSyncKey or getSyncData/getDataSyncKey.
   * @default true
   */
  useContextSync?: boolean;
  /**
   * Document-sync store shared with the document-sync plugin. When present,
   * context-based sync leaves document switches to that plugin — see
   * resolveContextSyncKey.
   */
  documentSyncStore?: Pick<DocumentSyncStore, 'getAppliedKey'>;
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
  /** Site ID for linking to the P1 dashboard */
  siteId?: string;
  /** Base URL for the P1 dashboard (defaults to https://content.pantheon.io) */
  dashboardUrl?: string;
  /** Custom logo image URL for the editor header */
  logoUrl?: string;
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
  /** Callback for the Review Workstream action (shown when on a branch) */
  onReviewWorkstream?: () => void;
  /** Callback for the Create Workstream action */
  onCreateWorkstream?: () => void;
  /** Called when the user creates a new workstream. Receives the branch name. */
  onCreateBranch?: (name: string) => Promise<void>;
  /** Available templates for document creation */
  templates?: import('../../features/content-type-templates/types.js').TemplateSummary[];
  /** Whether templates are loading */
  templatesLoading?: boolean;
  /** Create a new template (Create Page modal's "New template" flow). */
  onCreateTemplate?: (params: {
    name: string;
    label: string;
    description?: string;
    defaultUrlPattern?: string;
  }) => Promise<Template>;
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
 * Inner component for P1SubheaderBridge — only rendered when P1Puck context is available.
 * Separating into inner/outer avoids violating Rules of Hooks with a try/catch before hook calls.
 */
function P1SubheaderBridgeInner({
  options,
  p1Context,
  showMergeReviewRef,
  collapsePluginRailRef,
}: {
  options: P1PluginOptions;
  p1Context: ReturnType<typeof useP1Puck>;
  showMergeReviewRef: { current: () => void };
  collapsePluginRailRef: { current: () => void };
}): React.ReactElement | null {
  const { currentDocument, currentBranch, presence, publishDocument, hasActiveHumans, humanPresenceCount, siteId } = p1Context;

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

  // Plugin rail visibility (local state, not Puck UI state).
  // MUST be before early return to satisfy Rules of Hooks.
  // Persisted to localStorage, mirroring leftSideBarVisible/rightSideBarVisible
  // below — otherwise it silently resets to hidden on every remount/reload.
  const pluginRailStorageKey = `p1-plugin-rail-${siteId}`;
  const [pluginRailVisible, setPluginRailVisible] = React.useState(() => {
    try {
      const stored = localStorage.getItem(pluginRailStorageKey);
      return stored === null ? false : stored === 'true'; // default hidden when nothing persisted yet
    } catch {
      return false;
    }
  });

  // Toggle body class to hide/show plugin rail via CSS
  React.useEffect(() => {
    if (pluginRailVisible) {
      document.body.classList.remove('p1-hide-plugin-rail');
    } else {
      document.body.classList.add('p1-hide-plugin-rail');
    }
    return () => {
      document.body.classList.remove('p1-hide-plugin-rail');
    };
  }, [pluginRailVisible]);

  // Persist on every user toggle.
  React.useEffect(() => {
    try {
      localStorage.setItem(pluginRailStorageKey, String(pluginRailVisible));
    } catch { /* ignore quota/private-browsing errors */ }
  }, [pluginRailVisible, pluginRailStorageKey]);

  // Expose collapse fn to the panel header button via ref.
  // Dispatches leftSideBarVisible:false — same action as the subheader "Toggle left panel" button.
  React.useEffect(() => {
    collapsePluginRailRef.current = () => {
      puckDispatch?.({ type: 'setUi', ui: { leftSideBarVisible: false } });
    };
  }, [collapsePluginRailRef, puckDispatch]);

  // Persist sidebar visibility to localStorage on every user toggle.
  // Initial state is set via the `ui` prop passed to <Puck> (see useP1Editor.ts),
  // so no restore dispatch is needed here — we only need to write.
  const sidebarStorageKey = `p1-sidebar-${siteId}`;
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

  // Derive document state. `docState` drives the publish button/actions and
  // keeps its existing behavior (incl. branch Review/Publish actions).
  const isOnMain = currentBranch?.isMain ?? true;
  const docState = deriveDocState(currentDocument, isOnMain);
  // The publish *badge* is shown ONLY on the Live (main) branch and reflects the
  // real published state; off-main (or while the status is unknown) it's
  // undefined → hidden. We never show a guessed state.
  const badgeDocState = deriveLiveDocState(options.publishedStatus, isOnMain);

  // Map presence to subheader actor lists.
  // humanPresenceCount and hasActiveHumans are read here so this component
  // subscribes to them as reactive context values. humanPresenceCount changes on
  // every join/leave (catches mid-session departures when hasActiveHumans stays true).
  const agentActors: SubheaderActor[] = (presence?.agents ?? []).map((a) => ({
    id: a.actorId,
    name: a.name,
    isAgent: true,
    intent: a.intent,
    requestedById: (a as any).requestedById,
    requestedByName: (a as any).requestedByName,
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
  const handlePublish = (p1Context.featureConfig?.enablePublishButton ?? true)
    ? (options.onPublish ?? (async () => { await publishDocument(); }))
    : undefined;


  // Panel toggle state and handlers
  // Note: leftSideBarVisible controls the left panel (_BlocksPlugin)
  const leftPanelVisible = puckUi?.leftSideBarVisible ?? true;
  const rightPanelVisible = puckUi?.rightSideBarVisible ?? true;

  const handleToggleLeftPanel = () => {
    puckDispatch?.({ type: 'setUi', ui: { leftSideBarVisible: !leftPanelVisible } });
  };
  const handleTogglePluginRail = () => {
    setPluginRailVisible(prev => !prev);
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

  // Compare with Live handler - uses custom callback if provided, otherwise triggers built-in merge review
  const handleCompareWithLive = options.onCompareWithLive ?? (() => {
    showMergeReviewRef.current();
  });

  return (
    <>
      {createPortal(
        <P1EditorSubheader
          puckActions={<></>}
          docState={docState}
          badgeDocState={badgeDocState}
          hasDrift={false}
          context={isOnMain ? 'main' : 'branch'}
          agents={agentActors}
          humanActors={humanActors}
          onStopAgent={handleStopAgent}
          onPublish={handlePublish}
          onReviewAndPublish={options.onReviewAndPublish}
          onReviewWorkstream={options.onReviewWorkstream ?? options.onReviewAndPublish ?? (() => {
            showMergeReviewRef.current();
          })}
          onCreateWorkstream={options.onCreateWorkstream}
          onDeleteDocument={handleDeleteDocument}
          hasPast={hasPast}
          hasFuture={hasFuture}
          onUndo={back}
          onRedo={forward}
          leftPanelVisible={leftPanelVisible}
          rightPanelVisible={rightPanelVisible}
          pluginRailVisible={pluginRailVisible}
          onToggleLeftPanel={handleToggleLeftPanel}
          onToggleRightPanel={handleToggleRightPanel}
          onTogglePluginRail={handleTogglePluginRail}
          branches={options.branches ?? []}
          currentBranch={options.currentBranch ?? null}
          onSwitchBranch={options.onBranchSwitch ?? (() => {})}
          onCompareWithLive={handleCompareWithLive ?? (() => {})}
          onCreateBranch={options.onCreateBranch}
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
 * cases where P1PuckContext isn't available.
 */
function P1SubheaderBridge({
  options,
  showMergeReviewRef,
  collapsePluginRailRef,
}: {
  options: P1PluginOptions;
  showMergeReviewRef: { current: () => void };
  collapsePluginRailRef: { current: () => void };
}): React.ReactElement | null {
  const p1Context = useP1PuckOptional();
  if (!p1Context) return null;

  return <P1SubheaderBridgeInner options={options} p1Context={p1Context} showMergeReviewRef={showMergeReviewRef} collapsePluginRailRef={collapsePluginRailRef} />;
}

// Minimal pub-sub store so the preview override re-renders when the user
// toggles the All/Milestones filter (a plain ref write is invisible to React).
function createFilteredVersionsStore() {
  // undefined = "not yet set" (falls back to full list via ?? in VersionBannerOverride).
  // [] = "filter applied, nothing matched" (steppers disabled).
  let current: DocumentVersion[] | undefined;
  const listeners = new Set<() => void>();
  return {
    set(versions: DocumentVersion[]) {
      if (current === versions) return;
      current = versions;
      listeners.forEach((notify) => notify());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot(): DocumentVersion[] | undefined { return current; },
  };
}

/**
 * Creates a CSS Plugin for the Puck editor.
 *
 * @example
 * ```tsx
 * import { createP1Plugin, useP1Puck } from '@pantheon-systems/puck-css';
 *
 * function Editor() {
 *   const { branches, currentBranch, switchBranch, saveStatus } = useP1Puck();
 *
 *   const p1Plugin = createP1Plugin({
 *     branches,
 *     currentBranch,
 *     onBranchSwitch: switchBranch,
 *     hasUnsavedChanges: saveStatus === 'saving',
 *   });
 *
 *   return <Puck plugins={[p1Plugin]} {...otherProps} />;
 * }
 * ```
 */

export function createP1Plugin(options: P1PluginOptions): PuckPlugin {
  // Determine which sync mechanism to use (in order of preference):
  // 1. Context-based (default): Reads from P1PuckContext directly - most reliable
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
  const stableOptions = new Proxy({} as P1PluginOptions, {
    get(_target, prop: string) {
      return optionsRef.current[prop as keyof P1PluginOptions];
    },
  });

  // Shared ref for merge review toggle - allows P1SubheaderBridgeInner to trigger
  // the merge review overlay that's owned by HeaderOverride
  const showMergeReviewRef = { current: () => {} };

  // Shared ref for collapsing the plugin rail from the panel header button
  const collapsePluginRailRef = { current: () => {} };

  // Tracks the currently-filtered version list from P1PluginPanel so the
  // banner steppers navigate within the active filter rather than all versions.
  const filteredVersionsStore = createFilteredVersionsStore();
  const handleFilteredVersionsChange = (v: DocumentVersion[]) => { filteredVersionsStore.set(v); };

  function PreviewOverride({ children }: { children: React.ReactNode }): React.ReactElement {
    const filteredVersions = React.useSyncExternalStore(
      filteredVersionsStore.subscribe,
      filteredVersionsStore.getSnapshot,
    );
    return (
      <VersionBannerOverride
        versions={stableOptions.versions ?? []}
        selectedVersionId={stableOptions.selectedVersionId}
        onVersionSelect={stableOptions.onVersionSelect}
        onRestoreVersion={stableOptions.onRestoreVersion}
        canRevert={stableOptions.canRevert}
        filteredVersions={filteredVersions}
      >
        {children}
      </VersionBannerOverride>
    );
  }

  /**
   * Header override component — renders P1EditorHeader plus the subheader slot anchor.
   * Owns `showMergeReview` state for the built-in Compare with Live overlay.
   */
  function HeaderOverride(): React.ReactElement {
    const [showMergeReview, setShowMergeReview] = useState(false);

    // Expose setShowMergeReview to the shared ref
    useEffect(() => {
      showMergeReviewRef.current = () => setShowMergeReview(true);
    }, []);
    const css = useP1Puck();
    const auth = useOptionalP1Auth();

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

    // Data sources (built-in + user) for the create-page collection builder.
    // Reuses the cached editor-context query, so no extra fetch.
    const { data: editorCtx } = useEditorContext(
      stableOptions.selectedDocumentPath ?? '/',
    );
    // MOCK: datasources don't yet declare their required inputs (prototype — the
    // real version derives/declares them, see PROGRESS data-source notes). Attach
    // a small id→inputs map and ensure the demo sources are present.
    const MOCK_DATASOURCE_INPUTS: Record<string, string[]> = {
      swapi: ['id'],
      swapi_list: [],
      pokemon: ['monster'],
    };
    const datasources: { id: string; label: string; inputs?: string[] }[] = (
      editorCtx?.remoteDatasourceRegistry ?? []
    ).map((d) => ({ id: d.id, label: d.label, inputs: MOCK_DATASOURCE_INPUTS[d.id] }));
    for (const demo of [
      { id: 'swapi', label: 'Star Wars API', inputs: ['id'] },
      { id: 'pokemon', label: 'Pokémon API', inputs: ['monster'] },
    ]) {
      if (!datasources.some((d) => d.id === demo.id)) datasources.push(demo);
    }

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

    return (
      <>
        <P1EditorHeader
          documents={(fc.enableDocumentBrowser ?? true) ? mappedDocs : []}
          currentDocument={(fc.enableDocumentBrowser ?? true) ? currentDocMapped : null}
          selectedDocumentPath={(fc.enableDocumentBrowser ?? true) ? stableOptions.selectedDocumentPath : null}
          siteName={stableOptions.siteName ?? css.siteName ?? ''}
          siteId={stableOptions.siteId}
          dashboardUrl={stableOptions.dashboardUrl}
          logoUrl={stableOptions.logoUrl}
          onBeforeLogoNavigate={css.saveNow}
          currentUser={currentUser}
          onSelectDocument={(fc.enableDocumentBrowser ?? true)
            ? (doc) => stableOptions.onDocumentSelect?.(doc.path) : () => {}}
          onCreateDocument={(fc.enableDocumentBrowser ?? true) ? stableOptions.onDocumentCreate : undefined}
          templates={stableOptions.templates}
          templatesLoading={stableOptions.templatesLoading}
          onCreateTemplate={stableOptions.onCreateTemplate}
          datasources={datasources}
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
        {useContextSync && (
          <ContextSyncBridge documentSyncStore={stableOptions.documentSyncStore} />
        )}
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
        {/* Force-refresh Puck permission cache on role/template changes */}
        <PermissionRefresher />
        {/* Track selection changes for focus region reporting */}
        {options.onSelectionChange && (
          <PuckSelectionTracker onSelectionChange={options.onSelectionChange} />
        )}
        {/* Nav tooltips are handled by PuckEditorTheme.css — labels are repositioned as hover tooltips */}
        {/* Subheader bridge — portals P1EditorSubheader into the slot placed by header override */}
        <P1SubheaderBridge options={stableOptions} showMergeReviewRef={showMergeReviewRef} collapsePluginRailRef={collapsePluginRailRef} />
        <P1PluginPanel
          versions={options.versions}
          versionsLoading={options.versionsLoading}
          selectedVersionId={options.selectedVersionId}
          onVersionSelect={options.onVersionSelect}
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
          onCollapse={() => collapsePluginRailRef.current()}
          onFilteredVersionsChange={handleFilteredVersionsChange}
        />
      </>
    ),
    overrides: {
      header: () => <HeaderOverride />,
      preview: ({ children }: { children: React.ReactNode }) => <PreviewOverride>{children}</PreviewOverride>,
    },
  };
}
