/**
 * Puck CSS Integration Types
 */

import type { CSSClient, PuckData, Document, Branch, Checkpoint } from '@pantheon/css-client';

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
