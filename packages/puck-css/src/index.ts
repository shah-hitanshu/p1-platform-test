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
export { diffPuckData, getChangedComponents, countChanges, hasRootChanged } from './utils/diff.js';

// Types
export type {
  SaveStatus,
  CSSPuckConfig,
  CSSPuckContextValue,
  CSSPuckEditorProps,
  UseAutoSaveOptions,
  UseAutoSaveReturn,
  ComponentDiff,
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
