/**
 * @pantheon/puck-css
 *
 * Puck editor integration with the Collaborative State System.
 */

// Provider and Context
export { CSSPuckProvider } from './CSSPuckProvider.js';
export { CSSPuckContext, useCSSPuck } from './CSSPuckContext.js';
export { NotificationProvider, NotificationContext, useNotifications } from './NotificationContext.js';
export { PresenceContext, usePresenceContext } from './PresenceContext.js';
export type { PresenceContextValue } from './PresenceContext.js';

// Hooks
export { useAutoSave } from './hooks/useAutoSave.js';
export { useDocuments } from './hooks/useDocuments.js';
export { useBranches } from './hooks/useBranches.js';
export { useCheckpoints } from './hooks/useCheckpoints.js';
export { useVersions } from './hooks/useVersions.js';

// Presence Hooks (Phase 2)
export { usePresence } from './hooks/usePresence.js';
export type { UsePresenceOptions, UsePresenceReturn } from './hooks/usePresence.js';
export { useBranchPresence } from './hooks/useBranchPresence.js';
export type { UseBranchPresenceOptions, UseBranchPresenceReturn } from './hooks/useBranchPresence.js';
export { useSitePresence } from './hooks/useSitePresence.js';
export type { UseSitePresenceOptions, UseSitePresenceReturn } from './hooks/useSitePresence.js';

// Focus Region Reporting (Proactive Collision Detection)
export { useFocusRegionReporting } from './hooks/useFocusRegionReporting.js';
export type {
  UseFocusRegionReportingOptions,
  UseFocusRegionReportingReturn,
} from './hooks/useFocusRegionReporting.js';

// Agent Edit Hooks (Phase 4)
export { useAgentEdit } from './hooks/useAgentEdit.js';
export type {
  UseAgentEditOptions,
  UseAgentEditReturn,
  AgentEditParams,
} from './hooks/useAgentEdit.js';
export { useAgentTrigger } from './hooks/useAgentTrigger.js';
export type {
  UseAgentTriggerOptions,
  UseAgentTriggerReturn,
  AgentAction,
  AgentTriggerResult,
  AgentTriggerStatus,
} from './hooks/useAgentTrigger.js';

// Components
export { SaveIndicator } from './components/SaveIndicator.js';
export { PublishButton } from './components/PublishButton.js';
export { BranchSelector } from './components/BranchSelector.js';
export { HistoricalVersionBanner } from './components/HistoricalVersionBanner.js';
export type { HistoricalVersionBannerProps } from './components/HistoricalVersionBanner.js';
export { PuckDataSynchronizer } from './components/PuckDataSynchronizer.js';
export type { PuckDataSynchronizerProps } from './components/PuckDataSynchronizer.js';
export { Toast } from './components/Toast.js';
export { NotificationContainer } from './components/NotificationContainer.js';

// Presence Components (Phase 3)
export {
  CollaboratorAvatars,
  PresenceIndicator,
  AgentActivityBanner,
  FocusRegionHighlight,
} from './components/presence/index.js';
export type {
  CollaboratorAvatarsProps,
  PresenceIndicatorProps,
  AgentActivityBannerProps,
  FocusRegionHighlightProps,
} from './components/presence/index.js';

// Agent Action Components (Phase 5)
export {
  AgentActionButton,
  AgentActionModal,
  AgentStatusPanel,
} from './components/agent-actions/index.js';
export type {
  AgentActionButtonProps,
  AgentActionModalProps,
  AgentStatusPanelProps,
} from './components/agent-actions/index.js';

// Version Comparison Components
export {
  PropValueDisplay,
  PropDiffRow,
  PropDiffPanel,
  ComponentNode,
  ComponentTree,
  DiffHeader,
  VersionComparePage,
  VisualVersionCompare,
  BranchDiffHeader,
  BranchMergeCompare,
  DocumentDiffList,
} from './components/version-compare/index.js';
export type {
  PropValueDisplayProps,
  PropDiffRowProps,
  PropDiffPanelProps,
  ComponentNodeProps,
  ComponentTreeProps,
  DiffHeaderProps,
  VersionComparePageProps,
  VisualVersionCompareProps,
  BranchDiffHeaderProps,
  BranchMergeCompareProps,
  DocumentDiffListProps,
} from './components/version-compare/index.js';

// Conflict Resolution Components (Puck-aware)
export {
  PuckFieldResolutionPanel,
  ComponentConflictGroup,
  RenderedResolutionPreview,
} from './components/conflict-resolution/index.js';
export type {
  PuckFieldResolutionPanelProps,
  ComponentConflictGroupProps,
  RenderedResolutionPreviewProps,
} from './components/conflict-resolution/index.js';

// Version History Components (Phase 6)
export {
  VersionItem,
  AgentCheckpointBadge,
} from './components/version-history/index.js';
export type {
  VersionItemProps,
  AgentCheckpointBadgeProps,
} from './components/version-history/index.js';

// Conflict Notifications (Phase 7)
export {
  useConflictNotifications,
  ConflictNotificationToast,
} from './components/conflict-notifications/index.js';
export type {
  ConflictNotification,
  ConflictNotificationType,
  UseConflictNotificationsOptions,
  UseConflictNotificationsReturn,
  ConflictNotificationToastProps,
} from './components/conflict-notifications/index.js';

// Puck Plugin Integration
export { createCSSPlugin, createCSSOverrides } from './plugin/index.js';
export type {
  CSSPluginOptions,
  PuckPlugin,
  CSSOverridesOptions,
  PuckOverrides,
} from './plugin/index.js';

// Utilities
export { debounce } from './utils/debounce.js';
export { withRetry } from './utils/retry.js';
export {
  diffPuckData,
  getChangedComponents,
  countChanges,
  hasRootChanged,
  diffPuckDataWithPositions,
  diffProps,
  getReorderedComponents,
} from './utils/diff.js';
export {
  createDiffMap,
  createHighlightedConfig,
  createHistoricalVersionConfig,
} from './utils/highlightConfig.js';
export type { PuckConfig } from './utils/highlightConfig.js';

// Puck Field Classification (Conflict Resolution)
export {
  isPuckData as isPuckDataClassifier,
  classifyPuckFields,
  getReadablePropPath,
  groupFieldsByComponent,
} from './utils/puckFieldClassifier.js';
export type {
  PuckFieldClassification,
  PuckComponentConflict,
} from './utils/puckFieldClassifier.js';

// Branch Diff Utilities
export {
  isPuckData,
  createBranchDocumentComparison,
  createBranchMergeComparison,
} from './utils/branchDiff.js';
export type {
  BranchDocumentComparison,
  BranchMergeComparison,
  DocumentDiffSummary,
} from './utils/branchDiff.js';

// Focus Region Highlighting (Collaborative Editing)
export {
  pathToComponentId,
  createFocusRegionMap,
  generateActorColor,
} from './utils/focusRegionMap.js';
export type { FocusHighlight } from './utils/focusRegionMap.js';
export { createFocusHighlightConfig } from './utils/focusHighlightConfig.js';
export {
  FocusHighlightContext,
  FocusHighlightProvider,
  useFocusHighlight,
  useFocusHighlightForComponent,
} from './FocusHighlightContext.js';
export type {
  FocusHighlightContextValue,
  FocusHighlightProviderProps,
} from './FocusHighlightContext.js';

// Types
export type {
  SaveStatus,
  CSSPuckConfig,
  CSSPuckContextValue,
  CSSPuckEditorProps,
  UseAutoSaveOptions,
  UseAutoSaveReturn,
  ComponentDiff,
  ComponentDiffWithPosition,
  PropDiff,
  VersionCompareOptions,
  // Notification types
  NotificationSeverity,
  NotificationAction,
  Notification,
  AddNotificationOptions,
  NotificationContextValue,
  // Presence types (Phase 9)
  PresenceState,
} from './types.js';

// Re-export commonly used types from css-client
export type {
  PuckData,
  PuckComponentData,
  PuckRootData,
  Document,
  DocumentVersion,
  Branch,
  Checkpoint,
} from '@pantheon/css-client';
