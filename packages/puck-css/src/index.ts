/**
 * @pantheon-systems/puck-css
 *
 * Puck editor integration with the Collaborative State System.
 */

// High-level API
export { P1App } from './editor/P1App.js';
export type { P1AppProps } from './editor/P1App.js';
export { createP1Config, createNextConfig, createNextContentClient, PRODUCTION_BASE_URL } from './core/config.js';
export type { P1Config } from './core/config.js';
export { toP1Path } from './editor/utils/path.js';

// Auth
export {
  P1AuthProvider,
  useP1Auth,
  DEMO_USERS,
  P1LoginPage,
} from './auth/index.js';
export type {
  AuthMode,
  AuthUser,
  P1AuthContextValue,
  P1AuthProviderProps,
  P1LoginPageProps,
} from './auth/index.js';

// Provider and Context
export { P1PuckProvider } from './editor/P1PuckProvider.js';
export { P1PuckContext, useP1Puck } from './core/P1PuckContext.js';
export { NotificationProvider, NotificationContext, useNotifications } from './core/NotificationContext.js';
export { PresenceContext, usePresenceContext } from './core/PresenceContext.js';
export type { PresenceContextValue } from './core/PresenceContext.js';

// Hooks
export { useAutoSave } from './editor/useAutoSave.js';
export { useDocuments } from './editor/useDocuments.js';
export { useBranches } from './editor/useBranches.js';
export { useCheckpoints } from './versioning/useCheckpoints.js';
export { useVersions } from './versioning/useVersions.js';

// Presence Hooks (Phase 2)
export { usePresence } from './collaboration/usePresence.js';
export type { UsePresenceOptions, UsePresenceReturn } from './collaboration/usePresence.js';
export { useBranchPresence } from './collaboration/useBranchPresence.js';
export type { UseBranchPresenceOptions, UseBranchPresenceReturn } from './collaboration/useBranchPresence.js';
export { useSitePresence } from './collaboration/useSitePresence.js';
export type { UseSitePresenceOptions, UseSitePresenceReturn } from './collaboration/useSitePresence.js';

// Stable Consumer API Hooks
export { useP1Plugin } from './editor/useP1Plugin.js';
export type { UseP1PluginOptions } from './editor/useP1Plugin.js';
export { useP1Overrides } from './editor/useP1Overrides.js';
export type { UseP1OverridesOptions } from './editor/useP1Overrides.js';
export { useP1Editor } from './editor/useP1Editor.js';
export type { UseP1EditorOptions, UseP1EditorReturn, PuckProps } from './editor/useP1Editor.js';

// Focus Region Reporting (Proactive Collision Detection)
export { useFocusRegionReporting } from './collaboration/useFocusRegionReporting.js';
export type {
  UseFocusRegionReportingOptions,
  UseFocusRegionReportingReturn,
} from './collaboration/useFocusRegionReporting.js';

// Agent Edit Hooks (Phase 4)
export { useAgentEdit } from './agent/useAgentEdit.js';
export type {
  UseAgentEditOptions,
  UseAgentEditReturn,
  AgentEditParams,
} from './agent/useAgentEdit.js';
export { useAgentTrigger } from './agent/useAgentTrigger.js';
export type {
  UseAgentTriggerOptions,
  UseAgentTriggerReturn,
  AgentAction,
  AgentTriggerResult,
  AgentTriggerStatus,
} from './agent/useAgentTrigger.js';

// Components
export { SaveIndicator } from './editor/components/SaveIndicator.js';
export { PublishButton } from './editor/components/PublishButton.js';
export { BranchSelector } from './editor/components/BranchSelector.js';
export { HistoricalVersionBanner } from './versioning/components/HistoricalVersionBanner.js';
export type { HistoricalVersionBannerProps } from './versioning/components/HistoricalVersionBanner.js';
export { PuckDataSynchronizer } from './editor/components/PuckDataSynchronizer.js';
export type { PuckDataSynchronizerProps } from './editor/components/PuckDataSynchronizer.js';
export { Toast } from './editor/components/Toast.js';
export { NotificationContainer } from './editor/components/NotificationContainer.js';
export { PublishedStatusBadge } from './editor/components/PublishedStatusBadge.js';
export type { PublishedStatusBadgeProps } from './editor/components/PublishedStatusBadge.js';
export { VersionPublishedBadge } from './versioning/components/VersionPublishedBadge.js';
export type { VersionPublishedBadgeProps } from './versioning/components/VersionPublishedBadge.js';

// Presence Components (Phase 3)
export {
  CollaboratorAvatars,
  PresenceIndicator,
  AgentActivityBanner,
  FocusRegionHighlight,
} from './collaboration/index.js';
export type {
  CollaboratorAvatarsProps,
  PresenceIndicatorProps,
  AgentActivityBannerProps,
  FocusRegionHighlightProps,
} from './collaboration/index.js';

// Agent Action Components (Phase 5)
export {
  AgentActionButton,
  AgentActionModal,
  AgentStatusPanel,
} from './agent/components/index.js';
export type {
  AgentActionButtonProps,
  AgentActionModalProps,
  AgentStatusPanelProps,
} from './agent/components/index.js';

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
} from './versioning/components/version-compare/index.js';
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
} from './versioning/components/version-compare/index.js';

// Merge Preview Components (Phase 5)
export {
  ViewModeSelector,
  MergePreviewRenderer,
  MergePreviewPanel,
} from './editor/components/merge-preview/index.js';
export type {
  ViewModeSelectorProps,
  ViewMode,
  MergePreviewRendererProps,
  MergePreviewPanelProps,
} from './editor/components/merge-preview/index.js';

// Merge Resolution Components
export {
  MergeReviewPage,
  MergeResolutionPage,
  DocumentResolutionList,
  DocumentResolutionDetail,
  ResolutionStrategyPicker,
  MergeResolutionToolbar,
  ComponentClickOverlay,
  CherryPickVisualPanel,
} from './merge/components/merge-resolution/index.js';
export type {
  MergeReviewPageProps,
  MergeResolutionPageProps,
  DocumentResolutionListProps,
  DiffCounts,
  DocumentResolutionDetailProps,
  ResolutionStrategyPickerProps,
  MergeResolutionToolbarProps,
  ComponentClickOverlayProps,
  CherryPickVisualPanelProps,
} from './merge/components/merge-resolution/index.js';

// Merge Preview Hook
export { useMergePreview } from './editor/useMergePreview.js';
export type { UseMergePreviewReturn } from './editor/useMergePreview.js';

// Merge Resolution Hook
export { useMergeResolution } from './merge/useMergeResolution.js';
export type {
  DocumentResolutionStrategy,
  DocumentChangeType,
  DocumentResolution,
  UseMergeResolutionOptions,
  UseMergeResolutionReturn,
} from './merge/useMergeResolution.js';

// Conflict Resolution Components (Puck-aware)
export {
  PuckFieldResolutionPanel,
  ComponentConflictGroup,
  RenderedResolutionPreview,
} from './merge/components/conflict-resolution/index.js';
export type {
  PuckFieldResolutionPanelProps,
  ComponentConflictGroupProps,
  RenderedResolutionPreviewProps,
} from './merge/components/conflict-resolution/index.js';

// Version History Components (Phase 6)
export {
  VersionItem,
  AgentCheckpointBadge,
} from './versioning/components/version-history/index.js';
export type {
  VersionItemProps,
  AgentCheckpointBadgeProps,
} from './versioning/components/version-history/index.js';

// Conflict Notifications (Phase 7)
export {
  useConflictNotifications,
  ConflictNotificationToast,
} from './merge/components/conflict-notifications/index.js';
export type {
  ConflictNotification,
  ConflictNotificationType,
  UseConflictNotificationsOptions,
  UseConflictNotificationsReturn,
  ConflictNotificationToastProps,
} from './merge/components/conflict-notifications/index.js';

// Puck Plugin Integration
export { createP1Plugin, createP1Overrides, createMergePreviewPlugin } from './editor/plugin/index.js';
export type {
  P1PluginOptions,
  PuckPlugin,
  P1OverridesOptions,
  PuckOverrides,
  MergePreviewPluginOptions,
} from './editor/plugin/index.js';

// Utilities
export { debounce } from './core/utils/debounce.js';
export { throttle } from './core/utils/throttle.js';
export { withRetry } from './core/utils/retry.js';
export {
  diffPuckData,
  getChangedComponents,
  countChanges,
  hasRootChanged,
  diffPuckDataWithPositions,
  diffProps,
  getReorderedComponents,
} from './versioning/utils/diff.js';
export {
  createDiffMap,
  createHighlightedConfig,
  createHistoricalVersionConfig,
} from './versioning/utils/highlightConfig.js';
export type { PuckConfig } from './versioning/utils/highlightConfig.js';

// Puck Field Classification (Conflict Resolution)
export {
  isPuckData as isPuckDataClassifier,
  classifyPuckFields,
  getReadablePropPath,
  groupFieldsByComponent,
  buildMergedSnapshot,
} from './merge/utils/puckFieldClassifier.js';
export type {
  PuckFieldClassification,
  PuckComponentConflict,
  ResolutionMap,
} from './merge/utils/puckFieldClassifier.js';

// Branch Diff Utilities
export {
  isPuckData,
  createBranchDocumentComparison,
  createBranchMergeComparison,
} from './versioning/utils/branchDiff.js';
export type {
  BranchDocumentComparison,
  BranchMergeComparison,
  DocumentDiffSummary,
} from './versioning/utils/branchDiff.js';

// Focus Region Highlighting (Collaborative Editing)
export {
  pathToComponentId,
  createFocusRegionMap,
  generateActorColor,
} from './collaboration/utils/focusRegionMap.js';
export type { FocusHighlight } from './collaboration/utils/focusRegionMap.js';
export { createFocusHighlightConfig } from './collaboration/utils/focusHighlightConfig.js';
export {
  FocusHighlightContext,
  FocusHighlightProvider,
  useFocusHighlight,
  useFocusHighlightForComponent,
} from './core/FocusHighlightContext.js';
export type {
  FocusHighlightContextValue,
  FocusHighlightProviderProps,
} from './core/FocusHighlightContext.js';

// Stable Plugin Array Utility
export { createStablePluginArray } from './editor/utils/createStablePluginArray.js';

// Feature Configuration
export { P1_PRESETS, resolveFeatureConfig } from './core/featureConfig.js';
export type { P1FeatureConfig } from './core/featureConfig.js';

// Types
export type {
  SaveStatus,
  P1PuckConfig,
  P1PuckContextValue,
  P1PuckEditorProps,
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
} from './core/types.js';

// Component Registry
export { useComponentRegistry } from './editor/useComponentRegistry.js';
export type {
  UseComponentRegistryOptions,
  UseComponentRegistryReturn,
  RegistrationResult,
} from './editor/useComponentRegistry.js';
export type {
  ComponentDescriptor,
  ComponentProvenance,
  SerializedField,
  FieldAiMeta,
  RegistryIndex,
} from './editor/utils/componentRegistry.js';

// Re-export commonly used types from css-client
export type {
  PuckData,
  PuckComponentData,
  PuckRootData,
  Document,
  DocumentVersion,
  Branch,
  Checkpoint,
  P1ContentClientConfig,
  PageContent,
  PageListEntry,
  PageListResult,
} from '@pantheon-systems/css-client';

// Re-export error classes from css-client
export { SessionExpiredError } from '@pantheon-systems/css-client';

// Thumbnails
export type { ThumbnailMap, ThumbnailFC } from './editor/utils/buildThumbnailOverride.js';

// P1 Client SDK — Lib Utilities (client-safe)
export { normalizePath, stripTrailingSlash, isReservedPath, PATH_REGEX } from './data/paths.js';
export {
  isCanonicalTemplatePath,
  templatePathParamNames,
  defaultInstancePathFromTemplate,
  editorPathHref,
  publicPagePathHref,
  isRouteTemplatePath,
  listRouteTemplateKeys,
  matchConcretePathToTemplateParams,
  normalizeRoutePath,
  pagePathFromCatchAllSegments,
  pathSegments,
  pickTemplateSourcePath,
  resolveTemplateMatch,
} from './data/route-templates.js';
export {
  isCrossPageRefTemplateString,
  encodePagesBlocksTemplate,
  flattenComponents,
  listConnectablePropKeys,
  getBlockPropsById,
} from './data/cross-reference.js';
export { buildRemoteDatasourceRegistry } from './data/remote-datasources/remote-datasource-registry.js';
export type { RemoteDatasourceDefinition, RemoteDatasourceFieldDoc } from './data/remote-datasources/remote-datasource-registry.js';
export { fetchHttpJsonRemoteDatasource } from './data/remote-datasources/fetch-http-json.js';
export type { RemoteDatasourceScope } from './data/remote-datasources/user-remote-datasource-types.js';
export {
  remoteDatasourceTemplateSuggestions,
  getActiveRemoteDatasourceInterpolation,
} from './data/template-autocomplete.js';
export type { TemplateSuggestion } from './data/template-autocomplete.js';
export { applySemanticOps, computeSemanticOps } from './data/semantic-ops.js';
export type { SemanticOp } from './data/semantic-ops.js';
export { P1QueryProvider } from './data/query-provider.js';
export type { RouteRow, RouteKind } from './data/page-store.js';

// P1 Client SDK — Styles
export {
  primaryButton,
  secondaryButton,
  ghostButton,
  dangerButton,
  infoPanel,
  errorText,
  card,
  mono,
  muted,
  sectionLabel,
  backdrop,
  modalPanel,
} from './data/styles.js';

// P1 Client SDK — Router Context
export { P1RouterContext, useP1Router } from './p1/router-context.js';
export type { P1Router } from './p1/router-context.js';

// P1 Client SDK — Connectable
export { Connectable, renderItemTemplate } from './editor/components/connectable.js';
export type { ConnectableItem, ConnectedItem } from './editor/components/connectable.js';

// P1 Client SDK — Editor
export {
  EditorClient,
  createRemoteDatasourceExplorerPlugin,
  createFieldConnectPlugin,
  wrapConfigForEditorPreview,
  createPreviewResolvePlugin,
  buildConnectPreviewConfig,
  ConnectPreviewHitStyles,
  ConnectFieldModal,
  TemplateAutocompleteLayer,
  useRemoteDatasources,
  useResolvePreview,
  usePublish,
  useSaveRemoteDatasource,
  useRemoveRemoteDatasource,
  useSavePreviewMeta,
  useLoadPageData,
  useEditorContext,
  useRemoteDatasourceContext,
  useP1Plugins,
} from './p1/editor/index.js';

// P1 Client SDK — Pages
export {
  RenderClient,
  CreatePageForm,
  CreateTemplateForm,
  AddOverrideForTemplate,
  DeleteStructureRowButton,
  useCreateStructure,
  useDeleteStructurePage,
} from './p1/pages/index.js';

// Content Type Templates (PROPOSAL-010)
export type {
  ContentRole,
  TemplateMetadata,
  TemplateComponent,
  Template,
  TemplateBinding,
  CreateTemplateParams,
  UpdateTemplateParams,
  TemplateDocument,
  TemplateStore,
  ComponentPermissions,
  UseContentRoleReturn,
} from './features/content-type-templates/index.js';

export {
  createInMemoryTemplateStore,
  createApiTemplateStore,
  getPermissionsForRole,
  canPerformStructuralAction,
  canEditProps,
  canOverrideUrl,
  mergePermissions,
  useContentRole,
  useResolveContentRole,
  mapCssRoleToContentRole,
} from './features/content-type-templates/index.js';

export { scaffoldFromTemplate } from './features/content-type-templates/editor/useTemplateScaffold.js';
export { useTemplateEditor } from './features/content-type-templates/editor/useTemplateEditor.js';
export { useTemplatePermissions } from './features/content-type-templates/editor/useTemplatePermissions.js';
export { validateStructure } from './features/content-type-templates/validation/structural-validation.js';
export type { ValidationError, ValidationResult } from './features/content-type-templates/validation/structural-validation.js';
