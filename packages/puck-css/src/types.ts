/**
 * Puck CSS Integration Types
 */

import type { CSSClient, PuckData, Document, Branch, Checkpoint, DocumentVersion } from '@pantheon/css-client';

/**
 * Save status for auto-save functionality.
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Configuration for the CSS Puck Provider.
 */
export interface CSSPuckConfig {
  /**
   * CSS API client instance.
   */
  client: CSSClient;

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
   * @default false
   */
  enableRealtime?: boolean;

  /**
   * WebSocket base URL for real-time collaboration.
   * Required when enableRealtime is true.
   * @example 'wss://api.example.com'
   */
  wsBaseUrl?: string;

  /**
   * API key for real-time WebSocket authentication.
   * Required when enableRealtime is true.
   * WebSockets can't send custom headers, so the API key is passed as a query param.
   */
  realtimeApiKey?: string;
}

/**
 * Context value provided by CSSPuckProvider.
 */
export interface CSSPuckContextValue {
  /**
   * CSS client instance.
   */
  client: CSSClient;

  /**
   * Notification methods for displaying toast notifications.
   */
  notifications: NotificationContextValue;

  /**
   * Current site ID.
   */
  siteId: string;

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
   * Create a checkpoint (publish).
   */
  createCheckpoint: (name?: string) => Promise<Checkpoint>;

  /**
   * Switch to a different branch.
   */
  switchBranch: (branchId: string) => Promise<void>;

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
}

/**
 * Props for CSSPuckEditor component.
 */
export interface CSSPuckEditorProps {
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
