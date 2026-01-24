/**
 * CSS Puck Overrides
 *
 * Creates Puck overrides for CSS integration, including
 * header actions for save status and publish functionality.
 */

import React from 'react';
import type { Checkpoint } from '@pantheon/css-client';
import type { SaveStatus } from '../types.js';
import { SaveIndicator } from '../components/SaveIndicator.js';
import { PublishButton } from '../components/PublishButton.js';

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
}

/**
 * Puck Overrides type (matches Puck's expected structure)
 */
export interface PuckOverrides {
  headerActions?: (props: { children: React.ReactNode }) => React.ReactNode;
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
  } = options;

  return {
    headerActions: ({ children }) => (
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
          className="css-puck-header-publish"
        >
          Publish
        </PublishButton>
        {showDefaultPublish && children}
      </>
    ),
  };
}
