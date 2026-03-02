/**
 * CSS Puck Overrides
 *
 * Creates Puck overrides for CSS integration, including
 * header actions for save status and publish functionality.
 */

import React from 'react';
import type { Checkpoint, DocumentVersion, PuckData, ActorPresence } from '@pantheon/css-client';
import type { SaveStatus } from '../types.js';
import { SaveIndicator } from '../components/SaveIndicator.js';
import { PublishButton } from '../components/PublishButton.js';
import { HistoricalVersionBanner } from '../components/HistoricalVersionBanner.js';
import { CollaboratorAvatars } from '../components/presence/CollaboratorAvatars.js';
import { AgentActivityBanner } from '../components/presence/AgentActivityBanner.js';
// NOTE: PuckDataSynchronizer is NOT imported here - it's used in CSSPlugin instead
// because headerActions renders outside Puck's context where usePuck() doesn't work.

/**
 * Options for creating CSS overrides
 */
export interface CSSOverridesOptions {
  /**
   * Getter function for current save status.
   * Using a getter instead of direct value allows the overrides object to remain stable
   * while still accessing the latest status when rendering.
   * Preferred over `saveStatus` for performance.
   */
  getSaveStatus?: () => SaveStatus;
  /**
   * Getter function for last saved timestamp.
   * Preferred over `lastSaved` for performance.
   */
  getLastSaved?: () => Date | null;
  /**
   * Getter function for save error.
   * Preferred over `saveError` for performance.
   */
  getSaveError?: () => Error | null;

  /**
   * Direct save status value (legacy API).
   * @deprecated Use getSaveStatus getter for better performance.
   */
  saveStatus?: SaveStatus;
  /**
   * Direct last saved timestamp (legacy API).
   * @deprecated Use getLastSaved getter for better performance.
   */
  lastSaved?: Date | null;
  /**
   * Direct save error value (legacy API).
   * @deprecated Use getSaveError getter for better performance.
   */
  saveError?: Error | null;

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
   * @deprecated Pass syncData to createCSSPlugin instead. The plugin renders
   * inside Puck's context where usePuck() works correctly. Passing these props
   * here will be ignored.
   */
  syncData?: PuckData | null;

  /**
   * @deprecated Pass dataSyncKey to createCSSPlugin instead. The plugin renders
   * inside Puck's context where usePuck() works correctly. Passing these props
   * here will be ignored.
   */
  dataSyncKey?: string | null;
  // Presence/Agent Features for Header
  /** Whether to show collaborator avatars in header */
  showCollaboratorAvatars?: boolean;
  /** Current presence list for avatars */
  presence?: ActorPresence[];
  /** Whether to show agent activity banner in header */
  showAgentActivityBanner?: boolean;
  /** Currently active agents */
  activeAgents?: ActorPresence[];
  /** Whether any agent is currently editing */
  isAgentEditing?: boolean;
  /** Callback when stop agent button is clicked */
  onStopAgent?: (agent: ActorPresence) => void;
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
 *   // Preferred: use refs and getters for better performance
 *   const saveStatusRef = useRef(saveStatus);
 *   useEffect(() => { saveStatusRef.current = saveStatus; }, [saveStatus]);
 *
 *   const overrides = createCSSOverrides({
 *     getSaveStatus: () => saveStatusRef.current,
 *     getLastSaved: () => lastSavedRef.current,
 *     getSaveError: () => saveErrorRef.current,
 *     onRetrySave: saveNow,
 *     onPublish: createCheckpoint,
 *     onPublishSuccess: (cp) => console.log('Published:', cp.name),
 *   });
 *
 *   // Legacy: direct values (causes overrides to be recreated on changes)
 *   const overrides = createCSSOverrides({
 *     saveStatus,
 *     lastSaved,
 *     saveError,
 *     onRetrySave: saveNow,
 *     onPublish: createCheckpoint,
 *   });
 *
 *   return <Puck overrides={overrides} {...otherProps} />;
 * }
 * ```
 */
export function createCSSOverrides(options: CSSOverridesOptions): PuckOverrides {
  const {
    // New getter-based API (preferred)
    getSaveStatus,
    getLastSaved,
    getSaveError,
    // Legacy direct value API
    saveStatus: directSaveStatus,
    lastSaved: directLastSaved,
    saveError: directSaveError,
    // Common options
    onRetrySave,
    onPublish,
    onPublishSuccess,
    onPublishError,
    showNamePrompt = true,
    showDefaultPublish = false,
    onPauseAutoSave,
    // Deprecated props - kept for type signature compatibility but ignored
    syncData: _syncData,
    dataSyncKey: _dataSyncKey,
    // Presence/Agent Features — NOT destructured here.
    // These are read lazily from `options` in the headerActions render function
    // so that the Proxy pattern from useCSSOverrides provides live values.
    // Destructuring would capture stale values from the initial call.
  } = options;

  // Suppress unused variable warnings for deprecated props
  void _syncData;
  void _dataSyncKey;

  // Determine if using getter API or direct props API
  const usingGetters = typeof getSaveStatus === 'function';

  // Build props for SaveIndicator based on which API is being used
  const saveIndicatorProps = usingGetters
    ? {
        getStatus: getSaveStatus,
        getLastSaved: getLastSaved,
        getError: getSaveError,
        onRetry: onRetrySave,
      }
    : {
        status: directSaveStatus,
        lastSaved: directLastSaved,
        error: directSaveError,
        onRetry: onRetrySave,
      };

  return {
    headerActions: ({ children }) => {
      // Read presence/agent values lazily from options (Proxy) each render
      // so they reflect the latest state from useCSSOverrides' optionsRef.
      const _showCollaboratorAvatars = options.showCollaboratorAvatars ?? false;
      const _presence = options.presence ?? [];
      const _showAgentActivityBanner = options.showAgentActivityBanner ?? false;
      const _activeAgents = options.activeAgents ?? [];
      const _isAgentEditing = options.isAgentEditing ?? false;
      const _onStopAgent = options.onStopAgent;
      const _isViewingHistoricalVersion = options.isViewingHistoricalVersion ?? false;
      const _viewingVersion = options.viewingVersion;
      const _onReturnToLatest = options.onReturnToLatest;

      // Find the first active agent for banner display
      const firstActiveAgent = _activeAgents.find(a => a.state === 'editing') || _activeAgents[0];

      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* NOTE: PuckDataSynchronizer was removed from here because headerActions
              renders outside Puck's context. Use syncData/dataSyncKey in createCSSPlugin
              instead, which renders inside Puck's context. */}
          {/* Agent Activity Banner - shown when agent is editing */}
          {_showAgentActivityBanner && _isAgentEditing && firstActiveAgent && (
            <AgentActivityBanner agent={firstActiveAgent} showIdle onStopAgent={_onStopAgent} />
          )}
          {/* Collaborator Avatars */}
          {_showCollaboratorAvatars && _presence.length > 0 && (
            <CollaboratorAvatars actors={_presence} maxVisible={5} />
          )}
          {_isViewingHistoricalVersion && _viewingVersion && _onReturnToLatest ? (
            <HistoricalVersionBanner
              version={_viewingVersion}
              onReturnToLatest={_onReturnToLatest}
            />
          ) : (
            <>
              <SaveIndicator {...saveIndicatorProps} />
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
      );
    },
  };
}
