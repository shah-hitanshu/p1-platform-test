/**
 * CSS Puck Overrides
 *
 * Creates Puck overrides for CSS integration, including
 * header actions for save status and publish functionality.
 */

import React from 'react';
import type { Checkpoint, DocumentVersion, PuckData } from '@pantheon/css-client';
import type { SaveStatus } from '../types.js';
import { SaveIndicator } from '../components/SaveIndicator.js';
import { PublishButton } from '../components/PublishButton.js';
import { HistoricalVersionBanner } from '../components/HistoricalVersionBanner.js';
import { PuckDataSynchronizer } from '../components/PuckDataSynchronizer.js';

/**
 * Options for creating CSS overrides
 */
export interface CSSOverridesOptions {
  /** Current save status */
  saveStatus: SaveStatus;
  /** Last saved timestamp */
  lastSaved: Date | null;
  /** Save error if any */
  saveError: Error | null;
  /** Callback to retry save */
  onRetrySave: () => void;
  /** Callback to create checkpoint/publish */
  onPublish: (name?: string) => Promise<Checkpoint>;
  /** Callback when publish succeeds */
  onPublishSuccess?: (checkpoint: Checkpoint) => void;
  /** Callback when publish fails */
  onPublishError?: (error: Error) => void;
  /** Whether to show checkpoint name prompt */
  showNamePrompt?: boolean;
  /** Whether to show the default Puck publish button */
  showDefaultPublish?: boolean;
  /**
   * Callback to pause auto-save when checkpoint prompt is shown.
   * Pass pauseAutoSave from useCSSPuck to prevent refresh interference
   * while typing the checkpoint name.
   */
  onPauseAutoSave?: () => void;
  /**
   * Whether currently viewing a historical version (not the latest).
   */
  isViewingHistoricalVersion?: boolean;
  /**
   * The historical version being viewed.
   */
  viewingVersion?: DocumentVersion | null;
  /**
   * Callback to return to the latest version.
   */
  onReturnToLatest?: () => void;

  /**
   * Data to sync to Puck's internal state. Used with dataSyncKey
   * to update Puck's data without remounting (preserving sidebar state).
   */
  syncData?: PuckData | null;

  /**
   * Key that changes when we want to force a data sync to Puck.
   * Use version ID or document ID to trigger sync on version/document changes.
   */
  dataSyncKey?: string | null;
}

/**
 * Puck Overrides type (matches Puck's expected structure)
 */
export interface PuckOverrides {
  headerActions?: (props: { children: React.ReactNode }) => React.ReactElement;
}

/**
 * Creates Puck overrides for CSS integration.
 *
 * Adds SaveIndicator and PublishButton to the header actions area.
 *
 * @example
 * ```tsx
 * import { createCSSOverrides, useCSSPuck } from '@pantheon/puck-css';
 *
 * function Editor() {
 *   const {
 *     saveStatus,
 *     lastSaved,
 *     saveError,
 *     saveNow,
 *     createCheckpoint,
 *   } = useCSSPuck();
 *
 *   const overrides = createCSSOverrides({
 *     saveStatus,
 *     lastSaved,
 *     saveError,
 *     onRetrySave: saveNow,
 *     onPublish: createCheckpoint,
 *     onPublishSuccess: (cp) => console.log('Published:', cp.name),
 *   });
 *
 *   return <Puck overrides={overrides} {...otherProps} />;
 * }
 * ```
 */
export function createCSSOverrides(options: CSSOverridesOptions): PuckOverrides {
  const {
    saveStatus,
    lastSaved,
    saveError,
    onRetrySave,
    onPublish,
    onPublishSuccess,
    onPublishError,
    showNamePrompt = true,
    showDefaultPublish = false,
    onPauseAutoSave,
    isViewingHistoricalVersion = false,
    viewingVersion,
    onReturnToLatest,
    syncData,
    dataSyncKey,
  } = options;

  return {
    headerActions: ({ children }) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Data synchronizer updates Puck's internal data without remounting */}
        {syncData !== undefined && dataSyncKey !== undefined && (
          <PuckDataSynchronizer data={syncData} syncKey={dataSyncKey} />
        )}
        {isViewingHistoricalVersion && viewingVersion && onReturnToLatest ? (
          <HistoricalVersionBanner
            version={viewingVersion}
            onReturnToLatest={onReturnToLatest}
          />
        ) : (
          <>
            <SaveIndicator
              status={saveStatus}
              lastSaved={lastSaved}
              error={saveError}
              onRetry={onRetrySave}
            />
            <PublishButton
              onPublish={onPublish}
              showNamePrompt={showNamePrompt}
              onSuccess={onPublishSuccess}
              onError={onPublishError}
              onPromptShow={onPauseAutoSave}
              className="css-puck-header-publish"
            >
              Publish
            </PublishButton>
          </>
        )}
        {showDefaultPublish && children}
      </div>
    ),
  };
}
