/**
 * useCSSEditor Hook
 *
 * All-in-one hook for setting up a CSS-enabled Puck editor.
 * Composes useCSSPlugin and useCSSOverrides internally, handles
 * document loading, version management, historical version protection,
 * and provides everything needed to render <Puck>.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useCSSPuck } from '../CSSPuckContext.js';
import { useCSSPlugin } from './useCSSPlugin.js';
import { useCSSOverrides } from './useCSSOverrides.js';
import { useVersions } from './useVersions.js';
import type { UseCSSPluginOptions } from './useCSSPlugin.js';
import type { UseCSSOverridesOptions } from './useCSSOverrides.js';
import type { PuckPlugin, PuckOverrides } from '../plugin/index.js';
import type { CSSPuckContextValue } from '../types.js';
import type { PuckData, DocumentVersion } from '@pantheon/css-client';

/**
 * Options for useCSSEditor.
 */
export interface UseCSSEditorOptions {
  /** Document path to load */
  documentPath: string;
  /** Puck component configuration */
  puckConfig: unknown;
  /** Additional plugins to include after the CSS plugin */
  additionalPlugins?: PuckPlugin[];
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
  plugins: PuckPlugin[];
  /** Overrides with header actions */
  overrides: PuckOverrides;
  /** Permissions (locked down for historical versions) */
  permissions?: Record<string, boolean>;
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
    overrideOptions,
    pluginOptions,
    onSelectionChange,
    onDocumentNotFound,
  } = options;

  const css = useCSSPuck();

  // =========================================================================
  // Document Loading
  // =========================================================================

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
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
                setLoading(false);
              }
              return;
            }
          } catch {
            // callback itself failed — fall through to set error
          }
        }

        if (!cancelled) {
          setError(loadErr);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentPath, css.branchId, css.loadDocument]);

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
  // Plugin & Overrides (composed hooks)
  // =========================================================================

  const cssPlugin = useCSSPlugin({
    onSelectionChange: handleSelectionChange,
    ...pluginOptions,
    versions,
    versionsLoading,
    selectedVersionId: css.viewingVersion?.id ?? undefined,
    onVersionSelect: handleVersionSelect,
  });

  const cssOverrides = useCSSOverrides(overrideOptions ?? {});

  // =========================================================================
  // Stable plugin array
  // =========================================================================

  const additionalPluginsRef = useRef(additionalPlugins);
  additionalPluginsRef.current = additionalPlugins;

  const plugins = useMemo(() => {
    const result = [cssPlugin];
    if (additionalPluginsRef.current) {
      result.push(...additionalPluginsRef.current);
    }
    return result;
  }, [cssPlugin]);

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
  // Assemble puckProps
  // =========================================================================

  // Key that forces Puck to remount on document switch, ensuring clean
  // undo history, sidebar state, and no false onChange echo from setData.
  const puckKey = `css-${css.currentDocument?.id ?? documentPath}`;

  // Focus highlighting is handled via direct DOM manipulation in
  // PresenceFocusBridge (CSSApp.tsx) — no config wrapping needed.

  const puckProps: PuckProps = useMemo(
    () => ({
      config: puckConfig,
      data: css.safeData,
      onChange,
      plugins,
      overrides: cssOverrides,
      ...(permissions ? { permissions } : {}),
    }),
    [puckConfig, css.safeData, onChange, plugins, cssOverrides, permissions]
  );

  return {
    loading,
    error,
    puckKey,
    puckProps,
    css,
  };
}
