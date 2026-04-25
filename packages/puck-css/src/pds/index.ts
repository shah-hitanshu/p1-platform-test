/**
 * PDS v2 theme integration for the Puck editor.
 *
 * Provides the CSS class name that remaps Puck's internal design tokens
 * (`--puck-*`) to PDSv2 CSS custom properties (`--pds-*`), plus stub
 * exports for backward-compatible imports from consuming apps.
 */

// ---------------------------------------------------------------------------
// Theme class
// ---------------------------------------------------------------------------

export const puckEditorThemeClass = 'puck-editor-theme' as const;

// ---------------------------------------------------------------------------
// Backward-compatible stubs
// ---------------------------------------------------------------------------

/**
 * No-op hook — returns an empty object so destructured overrides
 * (fieldTypes, components, outline, header, headerActions) are all
 * `undefined` and Puck's native UI renders unmodified.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usePDSEditorOverrides(_options?: any): Record<string, undefined> {
  return {};
}

/**
 * Returns a minimal no-op Puck plugin.  Consuming apps that still
 * reference `createHistoryPlugin()` won't break at runtime.
 */
export function createHistoryPlugin() {
  return { name: 'pds-history' };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { DocState, PDSEditorOverridesOptions } from './types.js';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export { P1EditorHeader } from './components/P1EditorHeader.js';
export type { PageNavigatorDocument } from './components/P1EditorHeader.js';
export { P1EditorSubheader } from './components/P1EditorSubheader.js';
export { WorkstreamSwitcher } from './components/WorkstreamSwitcher.js';
export { PageNavigator } from './components/PageNavigator.js';
export { AgentChip } from './components/AgentChip.js';
export { PresenceStack } from './components/PresenceStack.js';
export { DocStateBadge } from './components/DocStateBadge.js';
export { PublishControl } from './components/PublishControl.js';

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

export { deriveDocState } from './utils/deriveDocState.js';
