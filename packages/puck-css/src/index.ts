/**
 * @pantheon/puck-css
 *
 * Puck editor integration with the Collaborative State System.
 */

// High-level API
export { CSSApp } from './CSSApp.js';
export type { CSSAppProps } from './CSSApp.js';
export { createCSSConfig, createNextConfig, createNextContentClient } from './config.js';
export type { CSSConfig } from './config.js';
export { toCSSPath } from './utils/path.js';

// Auth
export {
  CSSAuthProvider,
  useCSSAuth,
  DEMO_USERS,
  CSSLoginPage,
} from './auth/index.js';
export type {
  AuthMode,
  AuthUser,
  CSSAuthContextValue,
  CSSAuthProviderProps,
  CSSLoginPageProps,
} from './auth/index.js';

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

// Stable Consumer API Hooks
export { useCSSPlugin } from './hooks/useCSSPlugin.js';
export type { UseCSSPluginOptions } from './hooks/useCSSPlugin.js';
export { useCSSOverrides } from './hooks/useCSSOverrides.js';
export type { UseCSSOverridesOptions } from './hooks/useCSSOverrides.js';
export { useCSSEditor } from './hooks/useCSSEditor.js';
export type { UseCSSEditorOptions, UseCSSEditorReturn, PuckProps } from './hooks/useCSSEditor.js';

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
export { PublishedStatusBadge } from './components/PublishedStatusBadge.js';
export type { PublishedStatusBadgeProps } from './components/PublishedStatusBadge.js';
export { VersionPublishedBadge } from './components/VersionPublishedBadge.js';
export type { VersionPublishedBadgeProps } from './components/VersionPublishedBadge.js';

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
  VisualBranchCompare,
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
  VisualBranchCompareProps,
} from './components/version-compare/index.js';

// Merge Preview Components (Phase 5)
export {
  ViewModeSelector,
  MergePreviewRenderer,
  MergePreviewPanel,
} from './components/merge-preview/index.js';
export type {
  ViewModeSelectorProps,
  ViewMode,
  MergePreviewRendererProps,
  MergePreviewPanelProps,
} from './components/merge-preview/index.js';

// Merge Resolution Components
export {
  MergeResolutionPage,
  DocumentResolutionList,
  DocumentResolutionDetail,
  ResolutionStrategyPicker,
  CrdtPreviewPanel,
  MergeResolutionToolbar,
  ComponentClickOverlay,
  CherryPickVisualPanel,
} from './components/merge-resolution/index.js';
export type {
  MergeResolutionPageProps,
  DocumentResolutionListProps,
  DiffCounts,
  DocumentResolutionDetailProps,
  ResolutionStrategyPickerProps,
  CrdtPreviewPanelProps,
  MergeResolutionToolbarProps,
  ComponentClickOverlayProps,
  CherryPickVisualPanelProps,
} from './components/merge-resolution/index.js';

// Merge Resolution Hook
export { useMergeResolution } from './hooks/useMergeResolution.js';
export type {
  DocumentResolutionStrategy,
  DocumentResolution,
  UseMergeResolutionOptions,
  UseMergeResolutionReturn,
} from './hooks/useMergeResolution.js';

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
export { createCSSPlugin, createCSSOverrides, createMergePreviewPlugin } from './plugin/index.js';
export type {
  CSSPluginOptions,
  PuckPlugin,
  CSSOverridesOptions,
  PuckOverrides,
  MergePreviewPluginOptions,
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
  buildMergedSnapshot,
} from './utils/puckFieldClassifier.js';
export type {
  PuckFieldClassification,
  PuckComponentConflict,
  ResolutionMap,
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

// Stable Plugin Array Utility
export { createStablePluginArray } from './utils/createStablePluginArray.js';

// Feature Configuration
export { CSS_PRESETS, resolveFeatureConfig } from './featureConfig.js';
export type { CSSFeatureConfig } from './featureConfig.js';

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
  CSSContentClientConfig,
  PageContent,
  PageListEntry,
  PageListResult,
} from '@pantheon/css-client';
