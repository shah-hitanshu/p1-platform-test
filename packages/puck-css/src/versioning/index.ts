export { useVersions } from './useVersions.js';
export type { UseVersionsParams, UseVersionsReturn } from './useVersions.js';
export { useCheckpoints } from './useCheckpoints.js';
export type { UseCheckpointsParams, UseCheckpointsReturn } from './useCheckpoints.js';

export * from './components/version-compare/index.js';
export * from './components/version-history/index.js';
export { HistoricalVersionBanner } from './components/HistoricalVersionBanner.js';
export type { HistoricalVersionBannerProps } from './components/HistoricalVersionBanner.js';
export { VersionPublishedBadge } from './components/VersionPublishedBadge.js';
export type { VersionPublishedBadgeProps } from './components/VersionPublishedBadge.js';

export { diffPuckData, diffProps } from './utils/diff.js';
export type { ComponentDiff, ComponentDiffWithPosition, PropDiff } from '../core/types.js';
export { createDiffMap, createHighlightedConfig } from './utils/highlightConfig.js';
export type { PuckConfig } from './utils/highlightConfig.js';
export { createBranchDocumentComparison } from './utils/branchDiff.js';
export type { BranchDocumentComparison, DocumentDiffSummary } from './utils/branchDiff.js';
