/**
 * useCSSEditor Hook
 *
 * All-in-one hook for setting up a CSS-enabled Puck editor.
 * Composes useCSSPlugin and useCSSOverrides internally, handles
 * document loading, version management, historical version protection,
 * and provides everything needed to render <Puck>.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useCSSPuck } from '../core/CSSPuckContext.js';
import { useCSSPlugin } from './useCSSPlugin.js';
import { useCSSOverrides } from './useCSSOverrides.js';
import { useVersions } from '../versioning/useVersions.js';
import { useComponentRegistry } from './useComponentRegistry.js';
import { useCSSAuth } from '../auth/index.js';
import { buildThumbnailOverride } from './utils/buildThumbnailOverride.js';
import type { ThumbnailMap } from './utils/buildThumbnailOverride.js';
import type { UseCSSPluginOptions } from './useCSSPlugin.js';
import type { UseCSSOverridesOptions } from './useCSSOverrides.js';
import type { PuckOverrides } from './plugin/index.js';
import type { Plugin } from '@puckeditor/core';
import type { CSSPuckContextValue } from '../core/types.js';
import type { PuckData, DocumentVersion } from '@pantheon-systems/css-client';
import type { UiState } from '@puckeditor/core';

/**
 * Options for useCSSEditor.
 */
export interface UseCSSEditorOptions {
  /** Document path to load */
  documentPath: string;
  /** Puck component configuration */
  puckConfig: unknown;
  /** Additional plugins to include after the CSS plugin */
  additionalPlugins?: Plugin[];
  /**
   * Additional overrides to merge with CSS overrides.
   * Merged with stable memoization to prevent Puck's appStore.setState
   * from firing on every render (which causes preview iframe re-renders).
   * Nested objects (e.g. fieldTypes) are shallow-merged.
   */
  additionalOverrides?: PuckOverrides;
  /**
   * Map from Puck component name to a zero-argument React FC that renders a
   * schematic SVG wireframe thumbnail. When provided, each drawer item shows
   * a 48×32 thumbnail alongside the name and a drag-handle affordance.
   * Unknown names fall back to a generic placeholder automatically.
   *
   * @example
   * ```tsx
   * import { THUMBNAIL_MAP } from '@/data/thumbnails';
   *
   * useCSSEditor({ thumbnails: THUMBNAIL_MAP, ... });
   * ```
   */
  thumbnails?: ThumbnailMap;
  /** Customization options for overrides */
  overrideOptions?: UseCSSOverridesOptions;
  /** Customization options for the CSS plugin (versions are managed internally) */
  pluginOptions?: Omit<UseCSSPluginOptions, 'versions' | 'versionsLoading' | 'selectedVersionId' | 'onVersionSelect'>;
  /** Callback when user selection changes */
  onSelectionChange?: (path: string | null, itemId: string | null) => void;
  /** Called when document loading fails. Return true to retry loading. */
  onDocumentNotFound?: (documentPath: string, error: Error) => Promise<boolean>;
}

/**
 * Props to spread onto <Puck> component.
 */
export interface PuckProps {
  /** Puck component configuration */
  config: unknown;
  /** Safe data (never null) */
  data: PuckData;
  /** onChange handler wired to context saveData (disabled for historical versions) */
  onChange: (data: unknown) => void;
  /** Plugin array with CSS plugin first */
  plugins: Plugin[];
  /** Overrides with header actions */
  overrides: PuckOverrides;
  /** Permissions (locked down for historical versions) */
  permissions?: Record<string, boolean>;
  /** Initial UI state (sidebar visibility etc.) — read from localStorage on each key-based remount */
  ui?: Partial<UiState>;
}

/**
 * Return value from useCSSEditor.
 */
export interface UseCSSEditorReturn {
  /** Whether the initial document is still loading */
  loading: boolean;
  /** Error from document loading, if any */
  error: Error | null;
  /** React key — pass directly as `<Puck key={puckKey} {...puckProps} />` to force clean remount on document switch */
  puckKey: string;
  /** Props to spread onto <Puck> */
  puckProps: PuckProps;
  /** Full CSS context for advanced/escape-hatch use */
  css: CSSPuckContextValue;
  /**
   * @deprecated Always null. Branch-switch redirects have been removed; the
   * editor now unloads the page context and shows an empty state in the
   * preview area when the current document does not exist on the selected branch.
   */
  redirectPath: string | null;
}

/**
 * All-in-one hook for setting up a CSS-enabled Puck editor.
 *
 * Handles document loading, version management, plugin/overrides creation,
 * safe data, historical version protection, and plugin array assembly.
 * Returns everything needed to render <Puck> with minimal boilerplate.
 *
 * Must be used inside a CSSPuckProvider.
 *
 * @param options - Editor configuration
 * @returns Loading state, puck props, and CSS context
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const { loading, error, puckProps } = useCSSEditor({
 *     documentPath: '/home',
 *     puckConfig: config,
 *   });
 *
 *   if (loading) return <Loading />;
 *   if (error) return <Error error={error} />;
 *
 *   return <Puck {...puckProps} />;
 * }
 * ```
 */
export function useCSSEditor(options: UseCSSEditorOptions): UseCSSEditorReturn {
  const {
    documentPath,
    puckConfig,
    additionalPlugins,
    additionalOverrides,
    thumbnails,
    overrideOptions,
    pluginOptions,
    onSelectionChange,
    onDocumentNotFound,
  } = options;

  const css = useCSSPuck();
  const { user, logout } = useCSSAuth();

  // =========================================================================
  // Document Loading
  // =========================================================================

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [needsRedirect, setNeedsRedirect] = useState(false);
  const loadedPathRef = useRef<string | null>(null);

  // Reset loaded path when branch changes so document reloads on the new branch
  const prevBranchRef = useRef(css.branchId);
  if (prevBranchRef.current !== css.branchId) {
    prevBranchRef.current = css.branchId;
    loadedPathRef.current = null;
  }

  // Keep callback in a ref so the effect doesn't re-run when it changes
  const onDocumentNotFoundRef = useRef(onDocumentNotFound);
  onDocumentNotFoundRef.current = onDocumentNotFound;

  useEffect(() => {
    // Wait for branch resolution before loading documents
    if (!css.branchId) return;
    // Skip if already loaded this path on this branch
    if (loadedPathRef.current === documentPath) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    css.loadDocument(documentPath)
      .then(() => {
        if (!cancelled) {
          loadedPathRef.current = documentPath;
          setNeedsRedirect(false);
          setLoading(false);
        }
      })
      .catch(async (err: unknown) => {
        if (cancelled) return;

        const loadErr = err instanceof Error ? err : new Error(String(err));

        // Give the consumer a chance to handle the error (e.g. auto-create)
        if (onDocumentNotFoundRef.current) {
          try {
            const shouldRetry = await onDocumentNotFoundRef.current(documentPath, loadErr);
            if (!cancelled && shouldRetry) {
              await css.loadDocument(documentPath);
              if (!cancelled) {
                loadedPathRef.current = documentPath;
                setNeedsRedirect(false);
                setLoading(false);
              }
              return;
            }
          } catch {
            // callback itself failed — fall through to unload
          }
        }

        // Unload the editor; recovery effect will set an error if no docs exist
        if (!cancelled) {
          setNeedsRedirect(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentPath, css.branchId, css.loadDocument]);

  // Recovery: document not found on this branch — unload the editor and let
  // the preview empty state guide the user to pick a page.
  useEffect(() => {
    if (!needsRedirect) return;
    if (css.documentsLoading) return;
    setNeedsRedirect(false);
    if (css.documents.length === 0) {
      setError(new Error('No documents found on this branch'));
    }
    setLoading(false);
  }, [needsRedirect, css.documentsLoading, css.documents.length]);

  // =========================================================================
  // Version Management
  // =========================================================================

  const {
    versions,
    loading: versionsLoading,
    refresh: refreshVersions,
  } = useVersions({
    client: css.client,
    siteId: css.siteId,
    branchId: css.branchId,
    documentId: css.currentDocument?.id ?? null,
  });

  // Refresh versions when document changes
  useEffect(() => {
    if (css.currentDocument?.id) void refreshVersions();
  }, [css.currentDocument?.id, refreshVersions]);

  // Select a version — latest returns to live editing, others load historical
  const handleVersionSelect = useCallback((version: DocumentVersion) => {
    const latestVersion = versions[0];
    if (latestVersion && version.id === latestVersion.id) {
      void css.returnToLatest();
    } else {
      void css.loadVersion(version);
    }
  }, [versions, css.loadVersion, css.returnToLatest]);

  // =========================================================================
  // Published Status (derived from version data)
  // =========================================================================

  // The backend includes isPublished on each DocumentVersion via an EXISTS
  // subquery against checkpoint_documents. No additional API calls needed.
  const currentVersionId = css.viewingVersion?.id ?? versions[0]?.id;
  const currentVersionIsPublished = versions.find(v => v.id === currentVersionId)?.isPublished ?? false;
  const hasPublishedVersion = versions.some(v => v.isPublished);

  // Look up the current document from the branch document list, which includes
  // inherited and isPublished fields from the branch-level listing endpoint.
  // css.currentDocument comes from the site-level getByPath endpoint and lacks these.
  const branchDocument = css.documents.find(d => d.id === css.currentDocument?.id);
  const inheritedAndPublished = branchDocument?.inherited && branchDocument?.isPublished;

  const publishedStatus: 'published' | 'unpublished-changes' | 'draft' | undefined =
    versionsLoading
      ? undefined
      : inheritedAndPublished
        ? 'published'
        : currentVersionIsPublished
          ? 'published'
          : hasPublishedVersion
            ? 'unpublished-changes'
            : 'draft';

  // =========================================================================
  // Focus Region Reporting (outgoing — report local selection to server)
  // =========================================================================

  // Report selection changes to the presence system via WebSocket.
  // Wraps the consumer's onSelectionChange so both reporting and
  // the consumer callback are called.
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const handleSelectionChange = useCallback(
    (path: string | null, itemId: string | null) => {
      // Report to presence system via WebSocket (instant broadcast to other clients)
      const regions = path ? [path] : [];
      css.sendFocusRegions(regions);
      // Forward to consumer callback
      onSelectionChangeRef.current?.(path, itemId);
    },
    [css.sendFocusRegions],
  );

  // =========================================================================
  // Component Registry (runs at editor startup, writes descriptors to CSS backend)
  // =========================================================================

  useComponentRegistry({ puckConfig });

  // =========================================================================
  // Plugin & Overrides (composed hooks)
  // =========================================================================

  // Wrap publish to refresh version list and call consumer callback after success.
  const consumerOnPublishSuccessRef = useRef(overrideOptions?.onPublishSuccess);
  consumerOnPublishSuccessRef.current = overrideOptions?.onPublishSuccess;

  const handlePublish = useCallback(
    async () => {
      const checkpoint = await css.publishDocument();
      void refreshVersions();
      consumerOnPublishSuccessRef.current?.(checkpoint);
    },
    [css, refreshVersions],
  );

  const cssPlugin = useCSSPlugin({
    onSelectionChange: handleSelectionChange,
    currentUser: user ? { id: user.id, name: user.name, email: user.email, avatar: user.picture } : undefined,
    onLogout: logout,
    ...pluginOptions,
    onPublish: handlePublish,
    versions,
    versionsLoading,
    selectedVersionId: css.viewingVersion?.id ?? undefined,
    onVersionSelect: handleVersionSelect,
  });

  const wrappedOnPublishSuccess = useCallback(
    (checkpoint: Parameters<NonNullable<UseCSSOverridesOptions['onPublishSuccess']>>[0]) => {
      void refreshVersions();
      consumerOnPublishSuccessRef.current?.(checkpoint);
    },
    [refreshVersions],
  );

  const cssOverrides = useCSSOverrides({
    ...overrideOptions,
    publishedStatus,
    ...(overrideOptions?.onPublishSuccess ? { onPublishSuccess: wrappedOnPublishSuccess } : {}),
  });

  // =========================================================================
  // Stable plugin array
  // =========================================================================

  const additionalPluginsRef = useRef(additionalPlugins);
  additionalPluginsRef.current = additionalPlugins;

  const pluginCount = additionalPlugins?.length ?? 0;
  const plugins = useMemo(() => {
    const result: Plugin[] = [cssPlugin];
    if (additionalPluginsRef.current) {
      result.push(...additionalPluginsRef.current);
    }
    return result;
  }, [cssPlugin, pluginCount]);

  // =========================================================================
  // Stable onChange (disabled for historical versions)
  // =========================================================================

  const isViewingHistoricalRef = useRef(css.isViewingHistoricalVersion);
  isViewingHistoricalRef.current = css.isViewingHistoricalVersion;

  const onChange = useCallback(
    (data: unknown) => {
      if (!isViewingHistoricalRef.current) {
        css.saveData(data as PuckData);
      }
    },
    [css.saveData]
  );

  // =========================================================================
  // Permissions (read-only for historical versions)
  // =========================================================================

  const permissions = useMemo(() => {
    if (css.isViewingHistoricalVersion) {
      return { delete: false, drag: false, duplicate: false, edit: false, insert: false };
    }
    return undefined;
  }, [css.isViewingHistoricalVersion]);

  // =========================================================================
  // Stable merged overrides
  // =========================================================================

  // Merge additional overrides (e.g. from media plugins) with CSS overrides.
  // Uses ref pattern to keep the merge stable — only recomputes when
  // cssOverrides changes, not when additionalOverrides reference changes
  // (which would happen every render if the consumer doesn't memoize).
  const additionalOverridesRef = useRef(additionalOverrides);
  additionalOverridesRef.current = additionalOverrides;

  // Thumbnail override — built from the thumbnails map and merged between
  // cssOverrides and additionalOverrides so the site can still fully override
  // componentItem if needed.
  const thumbnailsRef = useRef(thumbnails);
  thumbnailsRef.current = thumbnails;

  const mergedOverrides = useMemo(() => {
    // Layer order (last wins): cssOverrides → thumbnailOverride → additionalOverrides
    const layers: (Partial<PuckOverrides> | null)[] = [
      cssOverrides,
      thumbnailsRef.current ? buildThumbnailOverride(thumbnailsRef.current) : null,
      additionalOverridesRef.current ?? null,
    ];

    const merged = {} as Record<string, unknown>;
    for (const layer of layers) {
      if (!layer) continue;
      for (const [key, value] of Object.entries(layer)) {
        const existing = merged[key];
        if (existing && typeof existing === 'object' && !Array.isArray(existing) &&
            value && typeof value === 'object' && !Array.isArray(value)) {
          merged[key] = { ...existing as Record<string, unknown>, ...value as Record<string, unknown> };
        } else {
          merged[key] = value;
        }
      }
    }
    return merged as PuckOverrides;
  }, [cssOverrides]);

  // =========================================================================
  // Assemble puckProps
  // =========================================================================

  // Key that forces Puck to remount on document switch, ensuring clean
  // undo history, sidebar state, and no false onChange echo from setData.
  const puckKey = `css-${css.currentDocument?.id ?? documentPath}`;

  // Read persisted sidebar visibility from localStorage each time the Puck instance
  // changes (puckKey changes on document/branch switch). The value is passed as the
  // initial `ui` prop so Puck never initializes with wrong defaults.
  const initialSidebarUi = useMemo<Partial<UiState>>(() => {
    try {
      const stored = localStorage.getItem(`css-sidebar-${css.siteId}`);
      if (!stored) return {};
      const parsed = JSON.parse(stored) as { left?: boolean; right?: boolean };
      const ui: Partial<UiState> = {};
      if (parsed.left !== undefined) ui.leftSideBarVisible = parsed.left;
      if (parsed.right !== undefined) ui.rightSideBarVisible = parsed.right;
      return ui;
    } catch {
      return {};
    }
  }, [puckKey, css.siteId]);

  // Focus highlighting is handled via direct DOM manipulation in
  // PresenceFocusBridge (CSSApp.tsx) — no config wrapping needed.

  const puckProps: PuckProps = useMemo(
    () => ({
      config: puckConfig,
      data: css.safeData,
      onChange,
      plugins,
      overrides: mergedOverrides,
      ...(Object.keys(initialSidebarUi).length > 0 ? { ui: initialSidebarUi } : {}),
      ...(permissions ? { permissions } : {}),
    }),
    [puckConfig, css.safeData, onChange, plugins, mergedOverrides, initialSidebarUi, permissions]
  );

  return {
    loading,
    error,
    puckKey,
    puckProps,
    css,
    /** @deprecated No longer emitted — editor now shows an empty state when a document is not found on the current branch. */
    redirectPath: null as string | null,
  };
}
