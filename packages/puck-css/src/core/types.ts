/**
 * Puck P1 Integration Types
 */

import type {
  P1Client,
  PuckData,
  Document,
  Branch,
  Checkpoint,
  DocumentVersion,
  ActorPresence,
  AgentTrigger,
} from '@pantheon-systems/css-client';
import type { ConflictNotification } from '../merge/components/conflict-notifications/index.js';
import type { UseAgentEditReturn } from '../agent/useAgentEdit.js';
import type { UseAgentTriggerReturn } from '../agent/useAgentTrigger.js';
import type { P1FeatureConfig } from './featureConfig.js';
import type { Template, TemplateSummary } from '../features/content-type-templates/types.js';

/**
 * Save status for auto-save functionality.
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Configuration for the P1 Puck Provider.
 */
export interface P1PuckConfig {
  /**
   * P1 API client instance.
   */
  client: P1Client;

  /**
   * Site ID to work with.
   */
  siteId: string;

  /**
   * Initial branch ID. If not provided, defaults to the main branch.
   */
  branchId?: string;

  /**
   * User ID for attribution.
   */
  userId: string;

  /**
   * Auto-save debounce delay in milliseconds.
   * @default 3000
   */
  autoSaveDelay?: number;

  /**
   * Maximum retry attempts for failed saves.
   * @default 3
   */
  maxRetries?: number;

  /**
   * Enable real-time collaborative editing.
   * When enabled, changes are synced via WebSocket using Yjs CRDT.
   * @default true
   */
  enableRealtime?: boolean;

  /**
   * WebSocket base URL for real-time collaboration.
   * Derived from baseUrl (http->ws, https->wss) when not set.
   * @example 'wss://api.example.com'
   */
  wsBaseUrl?: string;

  /**
   * API key for real-time WebSocket authentication.
   * Required when enableRealtime is true.
   * WebSockets can't send custom headers, so the API key is passed as a query param.
   *
   * Security note: the key is visible in server access logs and browser DevTools.
   * This path is only used for direct API key auth (machine-to-machine / local dev).
   * Human user sessions authenticate via Google/Auth0 — the browser's session cookie
   * is validated at the WebSocket upgrade request, so no API key is needed or sent.
   * Keys used here should be short-lived or scoped/rotatable service credentials.
   */
  realtimeApiKey?: string;

  /**
   * Throttle interval for realtime sync in milliseconds.
   * Controls max frequency of WebSocket sends during rapid editing.
   * Leading + trailing edge: first change sends immediately, then at most
   * one send per interval, with guaranteed final send.
   * @default 250
   */
  realtimeSyncInterval?: number;

  // =========================================================================
  // Presence Props (Phase 9)
  // =========================================================================

  /**
   * Enable presence tracking.
   * When enabled, shows other users and agents editing the same content.
   * @default true
   */
  presenceEnabled?: boolean;

  /**
   * Polling interval for presence updates in milliseconds.
   * @default 5000
   */
  presencePollingInterval?: number;

  /**
   * Display name for the current user in presence.
   */
  userName?: string;

  /**
   * Avatar URL for the current user in presence.
   */
  userAvatar?: string;

  /**
   * Resolver function to get display names for actors by their ID.
   * Used to display user names in presence indicators when the backend only provides UUIDs.
   * @param actorId - The actor's UUID
   * @returns The display name, or undefined to use the default (actorId)
   */
  userNameResolver?: (actorId: string) => string | undefined;

  // =========================================================================
  // Agent Mode Props (Phase 9)
  // =========================================================================

  /**
   * Enable agent mode features.
   * When enabled, provides agent edit capabilities or agent trigger functionality.
   * @default false
   */
  agentModeEnabled?: boolean;

  /**
   * Agent ID when this client IS an agent.
   * If set, the provider enables agent edit capabilities.
   * If not set but agentModeEnabled is true, enables triggerAgent for human users.
   */
  agentId?: string;

  /**
   * Agent trigger type (only used when agentId is set).
   */
  agentTrigger?: AgentTrigger;

  // =========================================================================
  // Callbacks (Phase 9)
  // =========================================================================

  /**
   * Callback when presence data changes.
   */
  onPresenceChange?: (actors: ActorPresence[]) => void;

  /**
   * Callback when an agent conflict occurs.
   */
  onAgentConflict?: (conflict: ConflictNotification) => void;

  // =========================================================================
  // Content Type Templates (PROPOSAL-010)
  // =========================================================================

  /**
   * User's content role for template permission enforcement.
   * Consumers should resolve this via `useResolveContentRole` or their own auth layer.
   * - admin: Full access, can create/edit templates
   * - editor: Pinned components locked, can add/remove non-pinned
   * - junior-editor: Props only, no structural changes
   * @default 'editor'
   */
  userRole?: 'admin' | 'editor' | 'junior-editor';
}

/**
 * Context value provided by P1PuckProvider.
 */
export interface P1PuckContextValue {
  /**
   * P1 client instance.
   */
  client: P1Client;

  /**
   * Notification methods for displaying toast notifications.
   */
  notifications: NotificationContextValue;

  /**
   * Current site ID.
   */
  siteId: string;

  /**
   * Display name of the current site, fetched from the P1 API on mount.
   * Null until the fetch resolves, or if the fetch fails.
   */
  siteName: string | null;

  /**
   * Current branch ID.
   */
  branchId: string;

  /**
   * Current user ID.
   */
  userId: string;

  /**
   * Currently loaded document.
   */
  currentDocument: Document | null;

  /**
   * Current Puck data.
   */
  currentData: PuckData | null;

  /**
   * True while loadDocument is fetching a document. Distinguishes "no
   * document because a switch is in flight" (keep the canvas as-is) from
   * "genuinely no document" (show the empty state).
   */
  documentLoading: boolean;

  /**
   * Save status.
   */
  saveStatus: SaveStatus;

  /**
   * Last save timestamp.
   */
  lastSaved: Date | null;

  /**
   * Last save error.
   */
  saveError: Error | null;

  /**
   * Load a document by path.
   */
  loadDocument: (path: string) => Promise<void>;

  /**
   * Save current data (triggers debounced auto-save).
   */
  saveData: (data: PuckData) => void;

  /**
   * Force immediate save.
   */
  saveNow: () => Promise<void>;

  /**
   * Persist the current in-memory edits as a REST version before a destructive
   * operation (e.g. revert). In realtime mode: confirms WebSocket delivery then
   * creates a version from the latest local snapshot. In non-realtime mode:
   * flushes the pending debounce buffer via performSave.
   */
  persistCurrentEdits: () => Promise<void>;

  /**
   * Create a checkpoint (publish).
   */
  createCheckpoint: (name?: string) => Promise<Checkpoint>;

  /**
   * Publish the currently loaded document.
   * Creates a checkpoint containing only this document.
   */
  publishDocument: () => Promise<Checkpoint>;

  /**
   * Switch to a different branch.
   */
  switchBranch: (branchId: string) => Promise<void>;

  /**
   * Create a new branch branching from main. Refreshes the branch list on success.
   */
  createBranch: (name: string) => Promise<Branch>;

  /**
   * Available branches.
   */
  branches: Branch[];

  /**
   * Current branch.
   */
  currentBranch: Branch | null;

  /**
   * Refresh branches list.
   */
  refreshBranches: () => Promise<void>;

  /**
   * Whether branches are still loading (for initial main branch detection).
   */
  branchesLoading: boolean;

  /**
   * Whether auto-save is currently paused.
   */
  autoSavePaused: boolean;

  /**
   * Pause auto-save. Use when user is entering checkpoint name to prevent
   * save-triggered refreshes from disrupting typing.
   */
  pauseAutoSave: () => void;

  /**
   * Resume auto-save. Called automatically on next saveData() call.
   */
  resumeAutoSave: () => void;

  /**
   * The version currently being viewed. Null if viewing the latest version.
   */
  viewingVersion: DocumentVersion | null;

  /**
   * The latest version data (for diff comparison when viewing historical versions).
   */
  latestVersionData: PuckData | null;

  /**
   * Whether currently viewing a historical (non-latest) version.
   */
  isViewingHistoricalVersion: boolean;

  /**
   * True while returnToLatest is fetching the latest version from the server.
   * Surfaced so the historical-version banner can show progress during the
   * network round trip.
   */
  isReturningToLatest: boolean;

  /**
   * Load a specific version by ID into the editor.
   */
  loadVersion: (version: DocumentVersion) => Promise<void>;

  /**
   * Return to the latest version after viewing a historical version.
   */
  returnToLatest: () => Promise<void>;

  /**
   * Whether real-time collaboration is enabled.
   */
  realtimeEnabled: boolean;

  /**
   * Whether currently connected to the real-time server.
   */
  realtimeConnected: boolean;

  /**
   * Key that changes when remote updates are received.
   * Use this to trigger Puck data sync for real-time updates.
   */
  remoteSyncKey: string | null;

  /**
   * Send focus regions to other users via WebSocket.
   * Returns true if sent successfully, false if not connected.
   * Use this for instant focus region updates when realtime is enabled.
   */
  sendFocusRegions: (regions: string[]) => boolean;

  /**
   * Handle Puck action events. Pass as the `onAction` prop to `<Puck>`.
   * Captures the action type and metadata so they can be included in
   * the sync payload for backend version storage.
   */
  handleAction: (action: Record<string, unknown>) => void;

  /**
   * Get pending actions buffered since last save.
   * Used for forwarding action metadata to backend for version history.
   */
  getPendingActions: () => Array<{
    type: string;
    [key: string]: unknown;
  }>;

  // =========================================================================
  // Stable Getters (avoid stale closures, referentially stable)
  // =========================================================================

  /**
   * Getter for current save status. Referentially stable — always returns
   * the latest value without causing re-renders.
   */
  getSaveStatus: () => SaveStatus;

  /**
   * Getter for last saved timestamp. Referentially stable.
   */
  getLastSaved: () => Date | null;

  /**
   * Getter for last save error. Referentially stable.
   */
  getSaveError: () => Error | null;

  /**
   * Getter for whether there are unsaved changes (pending data in debounce queue).
   * Referentially stable.
   */
  getHasUnsavedChanges: () => boolean;

  /**
   * Getter for current sync data (for PuckDataSynchronizer).
   * Returns currentData when available, undefined otherwise.
   * Referentially stable.
   */
  getSyncData: () => PuckData | undefined;

  /**
   * Getter for data sync key. Changes when remote updates arrive or
   * version/document switches occur. Referentially stable.
   */
  getDataSyncKey: () => string | undefined;

  /**
   * Null-safe Puck data. Never null — holds last valid data or empty fallback.
   * Use this instead of currentData when passing to Puck to avoid crashes
   * during branch switches or document loads.
   */
  safeData: PuckData;

  /**
   * List of documents on the current branch.
   */
  documents: Document[];

  /**
   * Whether the document list is still loading.
   */
  documentsLoading: boolean;

  /**
   * Re-fetch the document list for the current branch.
   */
  refreshDocuments: () => Promise<void>;

  /**
   * Create a new document on the current branch.
   * Creates the document and an initial empty version, then refreshes the document list.
   * An optional title is seeded into the initial snapshot at root.props.title.
   */
  createDocument: (
    path: string,
    template?: TemplateSummary | null,
    title?: string,
  ) => Promise<void>;

  /**
   * Create a new template (empty layout, authored in the editor afterwards) on
   * the current branch, then refresh the template list. Returns the created
   * template so callers can open its editor. Used by the Create Page modal's
   * "New template" flow.
   */
  createTemplate: (params: {
    name: string;
    label: string;
    description?: string;
    defaultUrlPattern?: string;
  }) => Promise<Template>;

  /**
   * Update a template's metadata (label / description / default URL pattern) on
   * the current branch, then refresh the template list. Used by the editor's
   * template-mode right sidebar.
   */
  updateTemplate: (
    templateId: string,
    params: {
      label?: string;
      description?: string;
      defaultUrlPattern?: string;
    },
  ) => Promise<void>;

  /**
   * Delete a document on the current branch.
   * Deletes the document and refreshes the document list.
   */
  deleteDocument: (documentId: string, path: string) => Promise<void>;

  // =========================================================================
  // Presence Values (Phase 9)
  // =========================================================================

  /**
   * Presence information when presenceEnabled is true.
   * Null when presence is disabled.
   */
  presence: PresenceState | null;

  /**
   * Whether any human (other than self) is actively present (direct value so
   * changes trigger context re-renders and refresh the presence getter).
   */
  hasActiveHumans: boolean;

  /**
   * Count of human actors currently present. Changes on every join/leave so
   * consumers re-render even when multiple humans are present and one departs.
   */
  humanPresenceCount: number;

  /**
   * Whether any agent is actively editing (direct value so changes
   * trigger context re-renders and clear the agent banner).
   */
  hasActiveAgents: boolean;

  // =========================================================================
  // Agent Values (Phase 9)
  // =========================================================================

  /**
   * Agent edit capabilities when this client IS an agent.
   * Null when agentModeEnabled is false or when agentId is not set.
   */
  agentEdit: UseAgentEditReturn | null;

  /**
   * Function to trigger an agent action (for human users).
   * Null when agentModeEnabled is false or when agentId is set.
   */
  triggerAgent: UseAgentTriggerReturn['triggerAgent'] | null;

  // =========================================================================
  // Conflict Notifications (Phase 9)
  // =========================================================================

  /**
   * Stop an agent's edit session (human-initiated).
   * Calls the backend to roll back the agent's changes and end its session.
   */
  stopAgent: (agent: ActorPresence) => Promise<void>;

  /**
   * Active conflict notifications.
   */
  conflicts: ConflictNotification[];

  /**
   * Dismiss a conflict notification by ID.
   */
  dismissConflict: (id: string) => void;

  // =========================================================================
  // Feature Configuration (Phase B.5)
  // =========================================================================

  /**
   * Resolved feature configuration with all flags set.
   * Derived from the featureConfig prop or existing boolean props.
   */
  featureConfig: Required<P1FeatureConfig>;

  // =========================================================================
  // Internal: Realtime Data Capture (for PuckDataCapture correction pass)
  // =========================================================================

  /**
   * Ref that PuckDataCapture writes the true current Puck data to.
   * @internal
   */
  _realtimeDataCaptureRef: React.MutableRefObject<PuckData | null> | null;

  /**
   * Callback for PuckDataCapture to signal new data is available.
   * Debounced internally to act as a correction pass after onChange settles.
   * @internal
   */
  _onRealtimeDataCapture: ((data: PuckData) => void) | null;

  // =========================================================================
  // Content Type Templates (PROPOSAL-010)
  // =========================================================================

  /**
   * Current user's content role for permission enforcement.
   * Defaults to 'editor' if not specified.
   */
  userRole: 'admin' | 'editor' | 'junior-editor';

  /**
   * Available templates on the current branch (metadata summaries).
   */
  templates: TemplateSummary[];

  /**
   * Whether templates are loading.
   */
  templatesLoading: boolean;

  /**
   * Error from the most recent template list fetch, if any.
   */
  templatesError: Error | null;

  /**
   * Refresh the template list.
   */
  refreshTemplates: () => Promise<void>;

  /**
   * Template that the current document is bound to.
   * Null for blank pages or when no document is loaded.
   */
  currentTemplate: Template | null;

  /**
   * Puck permissions resolver function based on template and user role.
   * Pass this to <Puck resolvePermissions={...} /> to enforce template restrictions.
   */
  resolvePermissions?: (
    item: { type: string; props?: { id?: string; [key: string]: unknown } },
    appState: unknown,
  ) => {
    edit: boolean;
    drag: boolean;
    delete: boolean;
    insert: boolean;
    duplicate: boolean;
  };
}

/**
 * Presence state provided by the context when presence is enabled.
 */
export interface PresenceState {
  /**
   * All actors present in the document/branch.
   */
  actors: ActorPresence[];

  /**
   * Human actors only.
   */
  humans: ActorPresence[];

  /**
   * Agent actors only.
   */
  agents: ActorPresence[];

  /**
   * Whether any human is actively editing.
   */
  hasActiveHumans: boolean;

  /**
   * Whether any agent is actively editing.
   */
  hasActiveAgents: boolean;

  /**
   * Force refresh presence data.
   */
  refresh: () => Promise<void>;
}

/**
 * Props for P1PuckEditor component.
 */
export interface P1PuckEditorProps {
  /**
   * Puck component configuration.
   */
  config: unknown; // Puck Config type

  /**
   * Document path to edit.
   */
  documentPath: string;

  /**
   * Callback when user navigates to a different page.
   */
  onNavigate?: (path: string) => void;

  /**
   * Callback when save completes.
   */
  onSave?: (data: PuckData) => void;

  /**
   * Callback when publish completes.
   */
  onPublish?: (checkpoint: Checkpoint) => void;

  /**
   * Callback on save error.
   */
  onSaveError?: (error: Error) => void;
}

/**
 * Options for useAutoSave hook.
 */
export interface UseAutoSaveOptions {
  /**
   * Debounce delay in milliseconds.
   * @default 3000
   */
  debounceMs?: number;

  /**
   * Maximum retry attempts.
   * @default 3
   */
  maxRetries?: number;

  /**
   * Callback when save starts.
   */
  onSaveStart?: () => void;

  /**
   * Callback when save succeeds.
   */
  onSaveSuccess?: () => void;

  /**
   * Callback when save fails.
   */
  onSaveError?: (error: Error) => void;
}

/**
 * Return value from useAutoSave hook.
 */
export interface UseAutoSaveReturn {
  /**
   * Trigger a save (debounced).
   */
  save: (data: PuckData) => void;

  /**
   * Force immediate save.
   */
  saveNow: () => Promise<void>;

  /**
   * Current save status.
   */
  status: SaveStatus;

  /**
   * Last successful save timestamp.
   */
  lastSaved: Date | null;

  /**
   * Last error if status is 'error'.
   */
  error: Error | null;

  /**
   * Whether there are pending unsaved changes.
   */
  isDirty: boolean;
}

/**
 * Component diff result for version comparison.
 */
export interface ComponentDiff {
  /**
   * Type of change.
   */
  type: 'added' | 'removed' | 'modified' | 'unchanged';

  /**
   * Component ID.
   */
  componentId: string;

  /**
   * Component type name.
   */
  componentType: string;

  /**
   * Path to component in the tree.
   */
  path: string[];

  /**
   * Component data before change (if applicable).
   */
  before?: unknown;

  /**
   * Component data after change (if applicable).
   */
  after?: unknown;
}

/**
 * Extended component diff with position information.
 */
export interface ComponentDiffWithPosition extends Omit<ComponentDiff, 'type'> {
  /**
   * Type of change (includes 'reordered').
   */
  type: 'added' | 'removed' | 'modified' | 'unchanged' | 'reordered';

  /**
   * Index in the before version (undefined if added).
   */
  beforeIndex?: number;

  /**
   * Index in the after version (undefined if removed).
   */
  afterIndex?: number;

  /**
   * Whether the component was reordered (can be true even for modified).
   */
  reordered?: boolean;
}

/**
 * Prop-level diff result.
 */
export interface PropDiff {
  /**
   * Name of the prop that changed.
   */
  propName: string;

  /**
   * Type of change.
   */
  type: 'added' | 'removed' | 'modified';

  /**
   * Value before change (undefined if added).
   */
  before?: unknown;

  /**
   * Value after change (undefined if removed).
   */
  after?: unknown;
}

/**
 * Options for version comparison.
 */
export interface VersionCompareOptions {
  /**
   * Version ID of the "before" version.
   */
  beforeVersionId: string;

  /**
   * Version ID of the "after" version (defaults to current).
   */
  afterVersionId?: string;
}

/**
 * Severity level for notifications.
 */
export type NotificationSeverity = 'error' | 'warning' | 'info' | 'success';

/**
 * Action that can be performed on a notification.
 */
export interface NotificationAction {
  /**
   * Button label.
   */
  label: string;

  /**
   * Callback when action is clicked.
   */
  onClick: () => void;
}

/**
 * A notification to display to the user.
 */
export interface Notification {
  /**
   * Unique identifier for the notification.
   */
  id: string;

  /**
   * Notification message.
   */
  message: string;

  /**
   * Severity level.
   */
  severity: NotificationSeverity;

  /**
   * Optional title for the notification.
   */
  title?: string;

  /**
   * Optional actions (e.g., retry button).
   */
  actions?: NotificationAction[];

  /**
   * Auto-dismiss after this many milliseconds. Set to 0 to disable auto-dismiss.
   * @default 5000 for success/info, 0 for error/warning
   */
  autoDismissMs?: number;

  /**
   * Timestamp when the notification was created.
   */
  createdAt: Date;
}

/**
 * Options for adding a notification.
 */
export interface AddNotificationOptions {
  /**
   * Notification message.
   */
  message: string;

  /**
   * Severity level.
   * @default 'info'
   */
  severity?: NotificationSeverity;

  /**
   * Optional title for the notification.
   */
  title?: string;

  /**
   * Optional actions (e.g., retry button).
   */
  actions?: NotificationAction[];

  /**
   * Auto-dismiss after this many milliseconds.
   * Set to 0 to disable auto-dismiss.
   * Defaults: 5000 for success/info, 0 for error/warning.
   */
  autoDismissMs?: number;
}

/**
 * Context value for notification management.
 */
export interface NotificationContextValue {
  /**
   * Currently active notifications.
   */
  notifications: Notification[];

  /**
   * Add a notification.
   * @returns The notification ID.
   */
  addNotification: (options: AddNotificationOptions) => string;

  /**
   * Remove a notification by ID.
   */
  removeNotification: (id: string) => void;

  /**
   * Remove all notifications.
   */
  clearNotifications: () => void;

  /**
   * Add an error notification with optional retry action.
   * @returns The notification ID.
   */
  addError: (message: string, onRetry?: () => void) => string;

  /**
   * Add a success notification.
   * @returns The notification ID.
   */
  addSuccess: (message: string) => string;

  /**
   * Add a warning notification.
   * @returns The notification ID.
   */
  addWarning: (message: string) => string;

  /**
   * Add an info notification.
   * @returns The notification ID.
   */
  addInfo: (message: string) => string;
}
