/**
 * useP1Plugin Hook
 *
 * Creates a referentially stable CSS plugin instance for Puck.
 * Internally reads context values and wires them through a Proxy pattern
 * so the plugin object never changes identity, avoiding Puck re-renders.
 */

import { useRef, useMemo } from 'react';
import { useP1Puck } from '../core/P1PuckContext.js';
import { createP1Plugin } from './plugin/P1Plugin.js';
import type { P1PluginOptions, PuckPlugin } from './plugin/P1Plugin.js';
import type { DocumentVersion, ActorPresence, RegisteredAgent } from '@pantheon-systems/css-client';
import type { SiteMenuItem, CurrentUser } from '../pds/components/P1EditorHeader.js';

/**
 * Options that consumers can pass to customize the plugin behavior.
 * Context-derived values (branches, documents, versions, etc.) are
 * automatically wired from P1PuckProvider context.
 */
export interface UseP1PluginOptions {
  /** Callback when user selection changes in the Puck editor */
  onSelectionChange?: (path: string | null, itemId: string | null) => void;
  /** Puck config for rendering merge previews. Enables the built-in merge review overlay. */
  puckConfig?: unknown;
  /** List of versions for the current document */
  versions?: DocumentVersion[];
  /** Whether versions are loading */
  versionsLoading?: boolean;
  /** Published status for the Live-only publish badge */
  publishedStatus?: 'published' | 'unpublished-changes' | 'draft';
  /** Currently selected version ID */
  selectedVersionId?: string;
  /** Callback when a version is selected */
  onVersionSelect?: (version: DocumentVersion) => void;
  /** Override document select handler (e.g., for URL-based routing). Defaults to context loadDocument. */
  onDocumentSelect?: (path: string) => void;
  /** Override selected document path (e.g., from URL params). Defaults to context currentDocument path. */
  selectedDocumentPath?: string | null;
  /** Callback to create a new document */
  onDocumentCreate?: (path: string, template?: import('../features/content-type-templates/types.js').TemplateSummary | null, title?: string) => Promise<void>;
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
  // P1 Editor Header / Subheader
  /** Site name displayed in the editor header */
  siteName?: string;
  /** Menu items shown in the site dropdown */
  siteMenuItems?: SiteMenuItem[];
  /** Site ID for linking to the P1 dashboard */
  siteId?: string;
  /** Base URL for the P1 dashboard (defaults to https://content.pantheon.io) */
  dashboardUrl?: string;
  /** Currently authenticated user */
  currentUser?: CurrentUser;
  /** Callback when user logs out */
  onLogout?: () => void;
  /** Callback for Compare with Live action */
  onCompareWithLive?: () => void;
  /** Callback for the publish action. When omitted, context's publishDocument is used. */
  onPublish?: () => Promise<void> | void;
  /** Callback for the Review & Publish action */
  onReviewAndPublish?: () => void;
  /** Callback for the Create Workstream action */
  onCreateWorkstream?: () => void;
  /** Called when the user creates a new workstream. Receives the branch name. */
  onCreateBranch?: (name: string) => Promise<void>;
}

/**
 * Creates a referentially stable CSS plugin for Puck.
 *
 * Reads branches, documents, and other state from P1PuckProvider context.
 * The returned plugin object is stable across re-renders — it uses a Proxy
 * pattern to always delegate to the latest options without changing identity.
 *
 * Must be used inside a P1PuckProvider.
 *
 * @param options - Optional customization (selection tracking, version display, etc.)
 * @returns A stable PuckPlugin instance
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const plugin = useP1Plugin();
 *   return <Puck plugins={[plugin]} config={config} data={data} />;
 * }
 * ```
 */
export function useP1Plugin(options: UseP1PluginOptions = {}): PuckPlugin {
  const css = useP1Puck();

  const fc = css.featureConfig ?? {
    enableBranchSelector: true,
    enableDocumentBrowser: true,
    enableVersionHistory: true,
    enableMergeControl: true,
    enableAutoSave: true,
    enablePublishButton: true,
    enableCollaboratorAvatars: true,
    enableAgentBanner: true,
    enableFocusHighlighting: true,
    enableRealtime: true,
    presenceEnabled: true,
    agentModeEnabled: false,
  };

  // Build the full plugin options from context + consumer options,
  // gating features by the resolved featureConfig flags.
  const pluginOptions: P1PluginOptions = {
    branches: fc.enableBranchSelector ? css.branches : [],
    currentBranch: fc.enableBranchSelector ? css.currentBranch : null,
    onBranchSwitch: fc.enableBranchSelector ? css.switchBranch : () => {},
    getHasUnsavedChanges: css.getHasUnsavedChanges,
    documents: fc.enableDocumentBrowser ? css.documents : [],
    selectedDocumentPath: options.selectedDocumentPath ?? css.currentDocument?.path ?? null,
    onDocumentSelect: fc.enableDocumentBrowser
      ? (options.onDocumentSelect ?? css.loadDocument) : undefined,
    onDocumentCreate: fc.enableDocumentBrowser
      ? (options.onDocumentCreate ?? css.createDocument) : undefined,
    templates: css.templates,
    templatesLoading: css.templatesLoading,
    onCreateTemplate: css.createTemplate,
    onDocumentDelete: fc.enableDocumentBrowser
      ? (options.onDocumentDelete ?? css.deleteDocument) : undefined,
    documentsLoading: css.documentsLoading,
    versions: fc.enableVersionHistory ? options.versions : undefined,
    versionsLoading: fc.enableVersionHistory ? options.versionsLoading : false,
    publishedStatus: options.publishedStatus,
    selectedVersionId: fc.enableVersionHistory ? options.selectedVersionId : undefined,
    onVersionSelect: fc.enableVersionHistory ? options.onVersionSelect : undefined,
    // Context-based sync is the default — no need for getter or legacy sync
    useContextSync: true,
    // Selection tracking
    onSelectionChange: options.onSelectionChange,
    // Merge comparison — gated by enableMergeControl
    puckConfig: options.puckConfig,
    onCompareWithLive: fc.enableMergeControl ? options.onCompareWithLive : undefined,
    // Presence/Agent features — gated by featureConfig flags
    showPresenceIndicator: fc.enableCollaboratorAvatars
      ? options.showPresenceIndicator : false,
    presence: fc.enableCollaboratorAvatars
      ? (options.presence ?? css.presence?.actors) : undefined,
    showAgentActivity: fc.enableAgentBanner ? options.showAgentActivity : false,
    activeAgents: fc.enableAgentBanner
      ? (options.activeAgents ?? css.presence?.agents?.filter(a => a.state === 'editing'))
      : undefined,
    showAgentActions: options.showAgentActions,
    availableAgents: options.availableAgents,
    onAgentAction: options.onAgentAction,
    onStopAgent: css.stopAgent,
    showFocusRegions: fc.enableFocusHighlighting ? options.showFocusRegions : false,
    agentEditingRegions: options.agentEditingRegions,
    // P1 Editor Header / Subheader
    siteName: options.siteName,
    siteMenuItems: options.siteMenuItems,
    siteId: options.siteId,
    dashboardUrl: options.dashboardUrl,
    currentUser: options.currentUser,
    onLogout: options.onLogout,
    onPublish: fc.enablePublishButton ? options.onPublish : undefined,
    onReviewAndPublish: options.onReviewAndPublish,
    onCreateWorkstream: options.onCreateWorkstream,
    onCreateBranch: options.onCreateBranch,
  };

  // Store options in a ref updated each render
  const optionsRef = useRef(pluginOptions);
  optionsRef.current = pluginOptions;

  // Create a stable Proxy-backed options object that always reads from the ref
  const stableOptions = useMemo(
    () =>
      new Proxy({} as P1PluginOptions, {
        get(_target, prop: string) {
          return (optionsRef.current as unknown as Record<string, unknown>)[prop];
        },
      }),
    []
  );

  // Create plugin once with stable proxy options
  const plugin = useMemo(() => createP1Plugin(stableOptions), [stableOptions]);

  return plugin;
}
