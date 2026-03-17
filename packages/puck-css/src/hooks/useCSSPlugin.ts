/**
 * useCSSPlugin Hook
 *
 * Creates a referentially stable CSS plugin instance for Puck.
 * Internally reads context values and wires them through a Proxy pattern
 * so the plugin object never changes identity, avoiding Puck re-renders.
 */

import { useRef, useMemo } from 'react';
import { useCSSPuck } from '../CSSPuckContext.js';
import { createCSSPlugin } from '../plugin/CSSPlugin.js';
import type { CSSPluginOptions, PuckPlugin } from '../plugin/CSSPlugin.js';
import type { DocumentVersion, ActorPresence, RegisteredAgent } from '@pantheon/css-client';

/**
 * Options that consumers can pass to customize the plugin behavior.
 * Context-derived values (branches, documents, versions, etc.) are
 * automatically wired from CSSPuckProvider context.
 */
export interface UseCSSPluginOptions {
  /** Callback when user selection changes in the Puck editor */
  onSelectionChange?: (path: string | null, itemId: string | null) => void;
  /** Puck config for rendering merge previews. Enables the built-in merge review overlay. */
  puckConfig?: unknown;
  /** List of versions for the current document */
  versions?: DocumentVersion[];
  /** Whether versions are loading */
  versionsLoading?: boolean;
  /** Currently selected version ID */
  selectedVersionId?: string;
  /** Callback when a version is selected */
  onVersionSelect?: (version: DocumentVersion) => void;
  /** Override document select handler (e.g., for URL-based routing). Defaults to context loadDocument. */
  onDocumentSelect?: (path: string) => void;
  /** Override selected document path (e.g., from URL params). Defaults to context currentDocument path. */
  selectedDocumentPath?: string | null;
  /** Callback to create a new document */
  onDocumentCreate?: (path: string) => Promise<void>;
  /** Callback to delete a document */
  onDocumentDelete?: (documentId: string, path: string) => Promise<void>;
  /** Whether to show presence indicator */
  showPresenceIndicator?: boolean;
  /** Current presence list (overrides context-derived presence) */
  presence?: ActorPresence[];
  /** Whether to show agent activity section */
  showAgentActivity?: boolean;
  /** Currently active agents */
  activeAgents?: ActorPresence[];
  /** Whether to show agent action trigger */
  showAgentActions?: boolean;
  /** Available agents for actions */
  availableAgents?: RegisteredAgent[];
  /** Callback when agent action is triggered */
  onAgentAction?: (agentId: string, intent: string, targetRegions?: string[]) => void;
  /** Whether to show focus regions */
  showFocusRegions?: boolean;
  /** Regions being edited by agents */
  agentEditingRegions?: string[];
}

/**
 * Creates a referentially stable CSS plugin for Puck.
 *
 * Reads branches, documents, and other state from CSSPuckProvider context.
 * The returned plugin object is stable across re-renders — it uses a Proxy
 * pattern to always delegate to the latest options without changing identity.
 *
 * Must be used inside a CSSPuckProvider.
 *
 * @param options - Optional customization (selection tracking, version display, etc.)
 * @returns A stable PuckPlugin instance
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const plugin = useCSSPlugin();
 *   return <Puck plugins={[plugin]} config={config} data={data} />;
 * }
 * ```
 */
export function useCSSPlugin(options: UseCSSPluginOptions = {}): PuckPlugin {
  const css = useCSSPuck();

  // Build the full plugin options from context + consumer options
  const pluginOptions: CSSPluginOptions = {
    branches: css.branches,
    currentBranch: css.currentBranch,
    onBranchSwitch: css.switchBranch,
    getHasUnsavedChanges: css.getHasUnsavedChanges,
    documents: css.documents,
    selectedDocumentPath: options.selectedDocumentPath ?? css.currentDocument?.path ?? null,
    onDocumentSelect: options.onDocumentSelect ?? css.loadDocument,
    onDocumentCreate: options.onDocumentCreate ?? css.createDocument,
    onDocumentDelete: options.onDocumentDelete ?? css.deleteDocument,
    documentsLoading: css.documentsLoading,
    versions: options.versions,
    versionsLoading: options.versionsLoading,
    selectedVersionId: options.selectedVersionId,
    onVersionSelect: options.onVersionSelect,
    // Context-based sync is the default — no need for getter or legacy sync
    useContextSync: true,
    // Selection tracking
    onSelectionChange: options.onSelectionChange,
    // Merge comparison
    puckConfig: options.puckConfig,
    // Presence/Agent features
    showPresenceIndicator: options.showPresenceIndicator,
    presence: options.presence ?? css.presence?.actors,
    showAgentActivity: options.showAgentActivity,
    activeAgents: options.activeAgents ?? css.presence?.agents?.filter(a => a.state === 'editing'),
    showAgentActions: options.showAgentActions,
    availableAgents: options.availableAgents,
    onAgentAction: options.onAgentAction,
    showFocusRegions: options.showFocusRegions,
    agentEditingRegions: options.agentEditingRegions,
  };

  // Store options in a ref updated each render
  const optionsRef = useRef(pluginOptions);
  optionsRef.current = pluginOptions;

  // Create a stable Proxy-backed options object that always reads from the ref
  const stableOptions = useMemo(
    () =>
      new Proxy({} as CSSPluginOptions, {
        get(_target, prop: string) {
          return (optionsRef.current as unknown as Record<string, unknown>)[prop];
        },
      }),
    []
  );

  // Create plugin once with stable proxy options
  const plugin = useMemo(() => createCSSPlugin(stableOptions), [stableOptions]);

  return plugin;
}
