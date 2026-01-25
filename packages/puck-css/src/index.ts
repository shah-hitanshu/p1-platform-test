/**
 * @pantheon/puck-css
 *
 * Puck editor integration with the Collaborative State System.
 */

// Provider and Context
export { CSSPuckProvider } from './CSSPuckProvider.js';
export { CSSPuckContext, useCSSPuck } from './CSSPuckContext.js';

// Hooks
export { useAutoSave } from './hooks/useAutoSave.js';
export { useDocuments } from './hooks/useDocuments.js';
export { useBranches } from './hooks/useBranches.js';
export { useCheckpoints } from './hooks/useCheckpoints.js';
export { useVersions } from './hooks/useVersions.js';

// Components
export { SaveIndicator } from './components/SaveIndicator.js';
export { PublishButton } from './components/PublishButton.js';
export { BranchSelector } from './components/BranchSelector.js';
export { HistoricalVersionBanner } from './components/HistoricalVersionBanner.js';
export type { HistoricalVersionBannerProps } from './components/HistoricalVersionBanner.js';

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
} from './components/version-compare/index.js';

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
