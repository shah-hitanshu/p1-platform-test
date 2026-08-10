/**
 * P1 Puck Overrides
 *
 * Creates Puck overrides for P1 integration, including
 * header actions for save status and publish functionality.
 */

import React from 'react';
import { ActionBar, FieldLabel } from '@puckeditor/core';
import type { Checkpoint, DocumentVersion, PuckData, ActorPresence } from '@pantheon-systems/css-client';
import type { SaveStatus } from '../../core/types.js';
import { SaveIndicator } from '../components/SaveIndicator.js';
import { CollaboratorAvatars } from '../../collaboration/components/CollaboratorAvatars.js';
import { AgentActivityBanner } from '../../collaboration/components/AgentActivityBanner.js';
import { PublishedStatusBadge } from '../components/PublishedStatusBadge.js';
import { ActionBarPinButton } from '../../features/content-type-templates/ui/ActionBarPinButton.js';
import { P1InspectorFields } from '../components/P1InspectorFields.js';
import { CollapsibleFieldSection } from '../components/CollapsibleFieldSection.js';
import { CollapsibleFieldContext } from '../components/collapsibleSectionContext.js';
import { OutlinePanel } from '../components/OutlinePanel.js';
import { fieldGuidanceFieldTypes } from './fieldGuidance.js';
// NOTE: PuckDataSynchronizer is NOT imported here - it's used in P1Plugin instead
// because headerActions renders outside Puck's context where usePuck() doesn't work.

// Re-exported for backwards compatibility — implementation lives in utils/templatePath.ts.
export { templateFromRegistryPath } from '../utils/templatePath.js';
// Re-exported for backwards compatibility — implementation lives in components/P1TemplateFields.tsx.
export { P1TemplateFields } from '../components/P1TemplateFields.js';


/**
 * Options for creating P1 overrides
 */
export interface P1OverridesOptions {
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
  /**
   * @deprecated Publish is now handled by P1EditorSubheader's PublishControl.
   * This prop is ignored and will be removed in a future release.
   */
  onPublish?: () => Promise<Checkpoint>;
  /**
   * @deprecated Publish is now handled by P1EditorSubheader's PublishControl.
   * This prop is ignored and will be removed in a future release.
   */
  onPublishSuccess?: (checkpoint: Checkpoint) => void;
  /**
   * @deprecated Publish is now handled by P1EditorSubheader's PublishControl.
   * This prop is ignored and will be removed in a future release.
   */
  onPublishError?: (error: Error) => void;
  /** Whether to show the default Puck publish button */
  showDefaultPublish?: boolean;
  /** Whether currently viewing a historical version of a document */
  isViewingHistoricalVersion?: boolean;
  /** The historical version being previewed. */
  viewingVersion?: DocumentVersion | null;
  /**
   * Callback to exit version preview and return to the latest version.
   * Wired to the "Back to current version" button in the components/outline overlays.
   */
  onReturnToLatest?: () => void;
  /**
   * @deprecated Pass to VersionBannerOverride instead. The banner is no longer
   * rendered by createP1Overrides; this prop is silently ignored.
   */
  onRestoreVersion?: (version: DocumentVersion) => Promise<void>;
  /**
   * @deprecated Pass to VersionBannerOverride instead. The banner is no longer
   * rendered by createP1Overrides; this prop is silently ignored.
   */
  canRevert?: boolean;

  /**
   * @deprecated Pass syncData to createP1Plugin instead. The plugin renders
   * inside Puck's context where usePuck() works correctly. Passing these props
   * here will be ignored.
   */
  syncData?: PuckData | null;

  /**
   * @deprecated Pass dataSyncKey to createP1Plugin instead. The plugin renders
   * inside Puck's context where usePuck() works correctly. Passing these props
   * here will be ignored.
   */
  dataSyncKey?: string | null;
  /** Whether to show the save indicator (default: true) */
  showSaveIndicator?: boolean;
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
  /** Published status of the current document version */
  publishedStatus?: 'published' | 'unpublished-changes' | 'draft';
}

/**
 * Puck Overrides type (matches Puck's expected structure)
 */
export interface PuckOverrides {
  headerActions?: (props: { children: React.ReactNode }) => React.ReactElement;
  drawerItem?: (props: { name: string; children: React.ReactNode }) => React.ReactElement;
  [key: string]: unknown;
}

/**
 * Creates Puck overrides for P1 integration.
 *
 * Adds SaveIndicator and PublishButton to the header actions area.
 *
 * @example
 * ```tsx
 * import { createP1Overrides, useP1Puck } from '@pantheon-systems/puck-css';
 *
 * function Editor() {
 *   const {
 *     saveStatus,
 *     lastSaved,
 *     saveError,
 *     saveNow,
 *     publishDocument,
 *   } = useP1Puck();
 *
 *   // Preferred: use refs and getters for better performance
 *   const saveStatusRef = useRef(saveStatus);
 *   useEffect(() => { saveStatusRef.current = saveStatus; }, [saveStatus]);
 *
 *   const overrides = createP1Overrides({
 *     getSaveStatus: () => saveStatusRef.current,
 *     getLastSaved: () => lastSavedRef.current,
 *     getSaveError: () => saveErrorRef.current,
 *     onRetrySave: saveNow,
 *   });
 *
 *   // Legacy: direct values (causes overrides to be recreated on changes)
 *   const overrides = createP1Overrides({
 *     saveStatus,
 *     lastSaved,
 *     saveError,
 *     onRetrySave: saveNow,
 *   });
 *
 *   return <Puck overrides={overrides} {...otherProps} />;
 * }
 * ```
 */


/**
 * An object field opting into a collapsible section. `metadata` is Puck's
 * per-field extension point (`BaseField.metadata`), so this needs no Puck change.
 */
interface CollapsibleObjectField {
  label?: string;
  objectFields?: Record<string, unknown>;
  metadata?: { collapsible?: boolean; defaultCollapsed?: boolean };
}

interface FieldLabelOverrideProps {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  label: string;
  el?: 'label' | 'div';
  readOnly?: boolean;
}

/**
 * Renders an opted-in field group's label row as a disclosure. Puck hands a
 * label override the field's content as `children`, so the group's own label
 * becomes the toggle — there is no second header and nothing to suppress.
 *
 * The context is cleared for descendants so a nested group inside a collapsible
 * one keeps its ordinary label.
 *
 * Ordinary field labels drop Puck's field-type icon. Its select variant is a
 * chevron, the same glyph the disclosure above uses, so it reads as a group that
 * expands and then does nothing. The label already says what the field is, and
 * the narrow inspector would rather have the space. The read-only lock is a
 * separate slot and survives.
 */
export function P1FieldLabel(props: FieldLabelOverrideProps): React.ReactElement {
  const collapsible = React.useContext(CollapsibleFieldContext);

  if (collapsible && props.el === 'div') {
    return (
      <CollapsibleFieldContext.Provider value={null}>
        <CollapsibleFieldSection
          label={props.label}
          defaultCollapsed={collapsible.defaultCollapsed}
          count={collapsible.count}
        >
          {props.children}
        </CollapsibleFieldSection>
      </CollapsibleFieldContext.Provider>
    );
  }

  return <FieldLabel {...props} icon={undefined} />;
}

export function createP1Overrides(options: P1OverridesOptions): PuckOverrides {
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
    showDefaultPublish = false,
    // Deprecated props - kept for type signature compatibility but ignored
    syncData: _syncData,
    dataSyncKey: _dataSyncKey,
    onRestoreVersion: _onRestoreVersion,
    canRevert: _canRevert,
    // Presence/Agent Features — NOT destructured here.
    // These are read lazily from `options` in the headerActions render function
    // so that the Proxy pattern from useP1Overrides provides live values.
    // Destructuring would capture stale values from the initial call.
  } = options;

  // Suppress unused variable warnings for deprecated props
  void _syncData;
  void _dataSyncKey;
  void _onRestoreVersion;
  void _canRevert;

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
    actionBar: ({ label, children }: { label?: string; children: React.ReactNode }) => (
      <ActionBar label={label}>
        {children}
        <ActionBarPinButton />
      </ActionBar>
    ),
    fields: ({ children }: { children: React.ReactNode }) => (
      <P1InspectorFields>{children}</P1InspectorFields>
    ),
    fieldLabel: P1FieldLabel,
    fieldTypes: {
      ...fieldGuidanceFieldTypes,
      // Marks an opted-in object field for P1FieldLabel, which owns the rendering
      // because it is the only override that receives the label. Object fields
      // without `metadata.collapsible` pass through untouched.
      object: ({
        field,
        children,
      }: {
        field: CollapsibleObjectField;
        children: React.ReactNode;
      }) =>
        field.metadata?.collapsible ? (
          <CollapsibleFieldContext.Provider
            value={{
              defaultCollapsed: field.metadata.defaultCollapsed,
              // Derived from the resolved field set, so omitting a field — how
              // role gating will hide one — moves the count with it.
              count: Object.keys(field.objectFields ?? {}).length,
            }}
          >
            {children}
          </CollapsibleFieldContext.Provider>
        ) : (
          <>{children}</>
        ),
    },
    outline: () => <OutlinePanel />,
    headerActions: ({ children }) => {
      // Read presence/agent values lazily from options (Proxy) each render
      // so they reflect the latest state from useP1Overrides' optionsRef.
      const _showCollaboratorAvatars = options.showCollaboratorAvatars ?? false;
      const _presence = options.presence ?? [];
      const _showAgentActivityBanner = options.showAgentActivityBanner ?? false;
      const _activeAgents = options.activeAgents ?? [];
      const _isAgentEditing = options.isAgentEditing ?? false;
      const _onStopAgent = options.onStopAgent;
      const _showSaveIndicator = options.showSaveIndicator ?? true;
      const _isViewingHistoricalVersion = options.isViewingHistoricalVersion ?? false;
      const _publishedStatus = options.publishedStatus;

      // Find the first active agent for banner display
      const firstActiveAgent = _activeAgents.find(a => a.state === 'editing') || _activeAgents[0];

      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* NOTE: PuckDataSynchronizer was removed from here because headerActions
              renders outside Puck's context. Use syncData/dataSyncKey in createP1Plugin
              instead, which renders inside Puck's context. */}
          {/* Agent Activity Banner - shown when agent is editing */}
          {_showAgentActivityBanner && _isAgentEditing && firstActiveAgent && (
            <AgentActivityBanner agent={firstActiveAgent} showIdle onStopAgent={_onStopAgent} />
          )}
          {/* Collaborator Avatars */}
          {_showCollaboratorAvatars && _presence.length > 0 && (
            <CollaboratorAvatars actors={_presence} maxVisible={5} />
          )}
          {!_isViewingHistoricalVersion && (
            <>
              {_showSaveIndicator && <SaveIndicator {...saveIndicatorProps} />}
              {_publishedStatus && (
                <PublishedStatusBadge status={_publishedStatus} />
              )}
            </>
          )}
          {showDefaultPublish && children}
        </div>
      );
    },
  };
}
