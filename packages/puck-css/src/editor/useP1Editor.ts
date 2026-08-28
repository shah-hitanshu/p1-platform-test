"use client";

/**
 * useP1Editor Hook
 *
 * All-in-one hook for setting up a P1-enabled Puck editor.
 * Composes useP1Plugin and useP1Overrides internally, handles
 * document loading, version management, historical version protection,
 * and provides everything needed to render <Puck>.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { Plugin } from '@puckeditor/core';
import type { PuckData, DocumentVersion } from '@pantheon-systems/css-client';
import type { UiState } from '@puckeditor/core';
import { useP1Puck } from '../core/P1PuckContext.js';
import { useVersions } from '../versioning/useVersions.js';
import { useP1Auth } from '../auth/index.js';
import type { P1PuckContextValue } from '../core/types.js';
import { isDocumentGoneError } from '../data/utils.js';
import { useP1Plugin } from './useP1Plugin.js';
import { useP1Overrides } from './useP1Overrides.js';
import { useComponentRegistry } from './useComponentRegistry.js';
import { buildThumbnailOverride } from './utils/buildThumbnailOverride.js';
import { makeEagerVersionHandler } from './utils/makeEagerVersionHandler.js';
import { restoreDocumentVersion } from './utils/restoreDocumentVersion.js';
import { initialPanelUi } from './useResponsivePanels.js';
import {
  createDocumentSyncStore,
  createDocumentSyncPlugin,
  documentSyncKey,
  BLANK_SYNC_KEY,
} from './plugin/document-sync-plugin.js';
import type { ThumbnailMap } from './utils/buildThumbnailOverride.js';
import { resolveLiveThumbnailDrawer } from './thumbnails/resolveLiveThumbnailDrawer.js';
import type { LiveThumbnailDrawerOptions } from './thumbnails/buildLiveThumbnailDrawer.js';
import type { UseP1PluginOptions } from './useP1Plugin.js';
import type { UseP1OverridesOptions } from './useP1Overrides.js';
import type { PuckOverrides } from './plugin/index.js';

/**
 * Options for useP1Editor.
 */
export interface UseP1EditorOptions {
  /** Document path to load */
  documentPath: string;
  /** Puck component configuration */
  puckConfig: unknown;
  /** Additional plugins to include after the CCR plugin */
  additionalPlugins?: Plugin[];
  /**
   * Additional overrides to merge with P1 overrides.
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
   * useP1Editor({ thumbnails: THUMBNAIL_MAP, ... });
   * ```
   */
  thumbnails?: ThumbnailMap;
  /**
   * Live thumbnail component drawer — replaces Puck's default component list
   * with collapsible categories of live-rendered preview cards. Defaults to
   * ON for every consumer (no per-app wiring needed). Pass `false` to keep
   * Puck's default drawer, or an options object to tune scale / card height.
   *
   * NOTE: this changes the default drawer for all `puck-css` editors.
   */
  liveThumbnailDrawer?: boolean | LiveThumbnailDrawerOptions;
  /** Customization options for overrides */
  overrideOptions?: UseP1OverridesOptions;
  /** Customization options for the CCR plugin (versions are managed internally) */
  pluginOptions?: Omit<UseP1PluginOptions, 'versions' | 'versionsLoading' | 'selectedVersionId' | 'onVersionSelect'>;
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
  /** Plugin array with CCR plugin first */
  plugins: Plugin[];
  /** Overrides with header actions */
  overrides: PuckOverrides;
  /** Permissions (locked down for historical versions) */
  permissions?: Record<string, boolean>;
  /** Dynamic permission resolver for template-based restrictions */
  resolvePermissions?: (item: { type: string }, appState: any) => {
    edit: boolean;
    drag: boolean;
    delete: boolean;
    insert: boolean;
    duplicate: boolean;
  };
  /** Puck onAction callback — captures structural actions for template migration conflict detection */
  onAction?: (action: Record<string, unknown>) => void;
  /** Initial UI state (sidebar visibility etc.) — read from localStorage on each key-based remount */
  ui?: Partial<UiState>;
}

/**
 * Why a reload is in flight while the previous document is still on screen.
 * The two reads differently to the user — a workstream switch replaces the
 * whole site's content, a page switch only swaps the canvas — so the copy that
 * covers the wait has to be able to tell them apart.
 */
export type ReloadKind = 'branch' | 'document';

/**
 * Return value from useP1Editor.
 */
export interface UseP1EditorReturn {
  /** Whether there is nothing to render yet — the first document has not loaded and has not failed */
  loading: boolean;
  /**
   * A reload running behind retained content, and why. Null when nothing is in
   * flight or when there is no prior content to keep showing (that is `loading`).
   */
  reloading: ReloadKind | null;
  /** Whether a document has ever loaded successfully — i.e. `puckProps` are worth rendering */
  hasContent: boolean;
  /** Error from document loading, if any */
  error: Error | null;
  /** React key — pass directly as `<Puck key={puckKey} {...puckProps} />` to force a clean remount on role change (document switches sync in place) */
  puckKey: string;
  /** Props to spread onto <Puck> */
  puckProps: PuckProps;
  /** Full P1 context for advanced/escape-hatch use */
  css: P1PuckContextValue;
  /**
   * @deprecated Always null. Branch-switch redirects have been removed; the
   * editor now unloads the page context and shows an empty state in the
   * preview area when the current document does not exist on the selected branch.
   */
  redirectPath: string | null;
}

/**
 * All-in-one hook for setting up a P1-enabled Puck editor.
 *
 * Handles document loading, version management, plugin/overrides creation,
 * safe data, historical version protection, and plugin array assembly.
 * Returns everything needed to render <Puck> with minimal boilerplate.
 *
 * Must be used inside a P1PuckProvider.
 *
 * @param options - Editor configuration
 * @returns Loading state, puck props, and P1 context
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const { loading, reloading, hasContent, error, puckProps } = useP1Editor({
 *     documentPath: '/home',
 *     puckConfig: config,
 *   });
 *
 *   if (loading) return <Loading />;
 *   if (error && !hasContent) return <Error error={error} />;
 *
 *   // Reloads keep the previous page on screen under an overlay.
 *   return (
 *     <>
 *       <EditorReloadOverlay reloading={reloading} />
 *       <Puck {...puckProps} />
 *     </>
 *   );
 * }
 * ```
 */
export function useP1Editor(options: UseP1EditorOptions): UseP1EditorReturn {
  const {
    documentPath,
    puckConfig,
    additionalPlugins,
    additionalOverrides,
    thumbnails,
    liveThumbnailDrawer,
    overrideOptions,
    pluginOptions,
    onSelectionChange,
    onDocumentNotFound,
  } = options;

  const ccr = useP1Puck();
  const { user, logout } = useP1Auth();

  // =========================================================================
  // Document Loading
  // =========================================================================

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [needsRedirect, setNeedsRedirect] = useState(false);
  const loadedPathRef = useRef<string | null>(null);
  // The branch the loaded document came from. Compared against the current
  // branch to tell a workstream switch from a page switch — derived rather
  // than latched when the branch changes, because a switch can re-run the load
  // effect more than once (the path often changes a render later) and a
  // one-shot flag reads as a plain page switch on every run after the first.
  const loadedBranchRef = useRef<string | null>(null);

  // Reset loaded path when branch changes so document reloads on the new branch
  const prevBranchRef = useRef(ccr.branchId);
  if (prevBranchRef.current !== ccr.branchId) {
    prevBranchRef.current = ccr.branchId;
    loadedPathRef.current = null;
  }

  // Keep callback in a ref so the effect doesn't re-run when it changes
  const onDocumentNotFoundRef = useRef(onDocumentNotFound);
  onDocumentNotFoundRef.current = onDocumentNotFound;

  useEffect(() => {
    // Wait for branch resolution before loading documents
    if (!ccr.branchId) return;
    // Skip if already loaded this path on this branch
    if (loadedPathRef.current === documentPath) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    ccr.loadDocument(documentPath)
      .then(() => {
        if (!cancelled) {
          loadedPathRef.current = documentPath;
          loadedBranchRef.current = ccr.branchId;
          setNeedsRedirect(false);
          setLoading(false);
        }
      })
      .catch(async (err: unknown) => {
        if (cancelled) return;

        const loadErr = err instanceof Error ? err : new Error(String(err));

        if (isDocumentGoneError(loadErr)) {
          // The document was deliberately deleted — never treat this as
          // "not found" (which would trigger auto-create below).
          setNeedsRedirect(true);
          return;
        }

        // Give the consumer a chance to handle the error (e.g. auto-create)
        if (onDocumentNotFoundRef.current) {
          try {
            const shouldRetry = await onDocumentNotFoundRef.current(documentPath, loadErr);
            if (!cancelled && shouldRetry) {
              await ccr.loadDocument(documentPath);
              if (!cancelled) {
                loadedPathRef.current = documentPath;
                loadedBranchRef.current = ccr.branchId;
                setNeedsRedirect(false);
                setLoading(false);
                void ccr.refreshDocuments();
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
  }, [documentPath, ccr.branchId, ccr.loadDocument]);

  // No branch means nothing can be opened, so an unresolved branch is fatal.
  // Derived rather than copied into state: a retry that clears the failure has
  // to stop being reported, which a mirrored copy would keep showing.
  const branchBootError = ccr.branchId ? null : ccr.branchResolutionError ?? null;

  // Recovery: document not found on this branch — unload the editor and let
  // the preview empty state guide the user to pick a page.
  useEffect(() => {
    if (!needsRedirect) return;
    if (ccr.documentsLoading) return;
    setNeedsRedirect(false);
    if (ccr.documents.length === 0) {
      // An empty list because the request was refused is a different story from
      // a branch that genuinely holds nothing; saying "no documents" for the
      // former is how the real failure stays hidden.
      setError(ccr.documentsError ?? new Error('No documents found on this branch'));
    }
    setLoading(false);
  }, [needsRedirect, ccr.documentsLoading, ccr.documents.length, ccr.documentsError]);

  // =========================================================================
  // Version Management
  // =========================================================================

  const {
    versions,
    loading: versionsLoading,
    refresh: refreshVersions,
  } = useVersions({
    client: ccr.client,
    siteId: ccr.siteId,
    branchId: ccr.branchId,
    documentId: ccr.currentDocument?.id ?? null,
  });

  // Refresh versions when document changes; also reset eager-version flag so a
  // stale post-publish signal from the previous document never fires on the new one.
  useEffect(() => {
    needsVersionRef.current = false;
    if (ccr.currentDocument?.id) void refreshVersions();
  }, [ccr.currentDocument?.id, refreshVersions]);

  // Refresh versions after a successful save so the publish badge reflects the
  // new unpublished draft (publishedStatus flips 'published' → 'unpublished-changes').
  // Without this the badge would keep reading "Live" after an edit on the Live branch.
  useEffect(() => {
    if (ccr.saveStatus === 'saved') void refreshVersions();
  }, [ccr.saveStatus, refreshVersions]);

  // Select a version — latest returns to live editing, others load historical
  const handleVersionSelect = useCallback((version: DocumentVersion) => {
    const latestVersion = versions[0];
    if (latestVersion && version.id === latestVersion.id) {
      void ccr.returnToLatest();
    } else {
      void ccr.loadVersion(version);
    }
  }, [versions, ccr.loadVersion, ccr.returnToLatest]);

  // Revert to a prior version.
  const handleRestoreVersion = useCallback(
    (version: DocumentVersion) => restoreDocumentVersion(
      version,
      ccr,
      refreshVersions,
      () => {},
    ),
    [ccr, refreshVersions],
  );

  // =========================================================================
  // Published Status (derived from version data)
  // =========================================================================

  // The backend includes isPublished on each DocumentVersion via an EXISTS
  // subquery against checkpoint_documents. No additional API calls needed.
  const currentVersionId = ccr.viewingVersion?.id ?? versions[0]?.id;
  const currentVersionIsPublished = versions.find(v => v.id === currentVersionId)?.isPublished ?? false;
  const hasPublishedVersion = versions.some(v => v.isPublished);

  // Look up the current document from the branch document list, which includes
  // inherited and isPublished fields from the branch-level listing endpoint.
  // ccr.currentDocument comes from the site-level getByPath endpoint and lacks these.
  const branchDocument = ccr.documents.find(d => d.id === ccr.currentDocument?.id);
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
      ccr.sendFocusRegions(regions);
      // Forward to consumer callback
      onSelectionChangeRef.current?.(path, itemId);
    },
    [ccr.sendFocusRegions],
  );

  // =========================================================================
  // Component Registry (runs at editor startup, writes descriptors to P1 backend)
  // =========================================================================

  useComponentRegistry({ puckConfig });

  // =========================================================================
  // Plugin & Overrides (composed hooks)
  // =========================================================================

  // Set true after a successful publish; the next onChange fires the eager
  // version create and clears this immediately.
  const needsVersionRef = useRef(false);
  const eagerVersionParamsRef = useRef({ siteId: ccr.siteId, branchId: ccr.branchId, documentId: ccr.currentDocument?.id ?? null });
  eagerVersionParamsRef.current = { siteId: ccr.siteId, branchId: ccr.branchId, documentId: ccr.currentDocument?.id ?? null };

  // Wrap publish to refresh version list and call consumer callback after success.
  const consumerOnPublishSuccessRef = useRef(overrideOptions?.onPublishSuccess);
  consumerOnPublishSuccessRef.current = overrideOptions?.onPublishSuccess;

  const handlePublish = useCallback(
    async () => {
      const checkpoint = await ccr.publishDocument();
      needsVersionRef.current = true;
      void refreshVersions();
      consumerOnPublishSuccessRef.current?.(checkpoint);
    },
    [ccr, refreshVersions],
  );

  const canRevert =
    ccr.userRole === 'admin' || ccr.userRole === 'editor' || ccr.userRole === 'author';

  // Pushes freshly loaded documents into the live Puck instance, replacing
  // the remount-on-document-switch behavior the old document-scoped puckKey
  // provided (see document-sync-plugin.tsx). Handed to the P1 plugin as well
  // so its context sync defers document switches to this store.
  const [documentSyncStore] = useState(createDocumentSyncStore);

  // Logout gets its own state rather than the auth context's `error`, which is
  // the login slot: it is written on a failed token validation that still
  // leaves the user signed in, and cleared only by a later login. Borrowing it
  // would show a logout failure for something that was never a logout.
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      const outcome = await logout();
      if (outcome.status === 'error') {
        // Still signed in and retryable, so hand the reason back to the header.
        setLogoutError(outcome.message);
        setIsLoggingOut(false);
      }
      // signed_out navigates away and no_session drops the session, so in both
      // cases this component is on its way out — leave the pending state set.
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : 'Logout failed');
      setIsLoggingOut(false);
    }
  }, [logout]);

  const p1Plugin = useP1Plugin({
    documentSyncStore,
    onSelectionChange: handleSelectionChange,
    currentUser: user ? { id: ccr.userId, name: user.name, email: user.email, avatar: user.picture } : undefined,
    onLogout: handleLogout,
    logoutError,
    isLoggingOut,
    puckConfig,
    ...pluginOptions,
    onPublish: handlePublish,
    versions,
    versionsLoading,
    publishedStatus,
    selectedVersionId: ccr.viewingVersion?.id ?? undefined,
    onVersionSelect: handleVersionSelect,
    onRestoreVersion: handleRestoreVersion,
    canRevert,
  });

  const wrappedOnPublishSuccess = useCallback(
    (checkpoint: Parameters<NonNullable<UseP1OverridesOptions['onPublishSuccess']>>[0]) => {
      void refreshVersions();
      consumerOnPublishSuccessRef.current?.(checkpoint);
    },
    [refreshVersions],
  );

  const p1Overrides = useP1Overrides({
    ...overrideOptions,
    publishedStatus,
    ...(overrideOptions?.onPublishSuccess ? { onPublishSuccess: wrappedOnPublishSuccess } : {}),
  });

  // =========================================================================
  // Stable plugin array
  // =========================================================================

  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const prev = useRef(additionalPlugins);
    if (prev.current !== additionalPlugins) {
      const countChanged =
        (prev.current?.length ?? 0) !== (additionalPlugins?.length ?? 0);
      if (!countChanged) {
        console.warn(
          "[useP1Editor] additionalPlugins ref is changing every render " +
            "without a length change — the caller should memoise this array.",
        );
      }
      prev.current = additionalPlugins;
    }
  }

  const additionalPluginsRef = useRef(additionalPlugins);
  additionalPluginsRef.current = additionalPlugins;

  const pluginCount = additionalPlugins?.length ?? 0;


  const documentSyncPlugin = useMemo(
    () => createDocumentSyncPlugin(documentSyncStore),
    [documentSyncStore]
  );

  // Publish the loaded document into the live Puck instance.
  //
  // Both the key and the data come from the payload's own origin, so a key can
  // never be paired with a different document's data. Keying off the live
  // branchId instead published the incoming branch's key beside the outgoing
  // branch's data the instant a switch began; the plugin applied that pairing,
  // recorded the new key as applied, and then ignored the correct document when
  // it arrived under the same key — leaving the canvas a workstream behind.
  //
  // safeData is read directly rather than through a ref: it only advances when
  // the provider loads a document (saveData deliberately never touches
  // currentData), so it cannot re-fire on every keystroke.
  const currentDocumentId = ccr.currentDocument?.id;
  const origin = ccr.currentDataOrigin;
  useEffect(() => {
    if (loading || error || !origin) return;
    // Historical versions sync through ContextSyncBridge, which does not reset
    // the undo stack.
    if (origin.historical) return;
    // Mid-switch the payload still belongs to the outgoing branch or document.
    // Withholding it keeps the applied key naming what the canvas really shows.
    if (origin.branchId !== ccr.branchId) return;
    if (origin.documentId !== currentDocumentId) return;
    documentSyncStore.publish({
      syncKey: documentSyncKey(origin.branchId, origin.documentId),
      data: ccr.safeData,
    });
  }, [
    loading,
    error,
    origin,
    ccr.safeData,
    ccr.branchId,
    currentDocumentId,
    documentSyncStore,
  ]);

  const plugins = useMemo(() => {
    const result: Plugin[] = [p1Plugin, documentSyncPlugin];
    if (additionalPluginsRef.current) {
      result.push(...additionalPluginsRef.current);
    }
    return result;
  }, [p1Plugin, documentSyncPlugin, pluginCount]);

  // =========================================================================
  // Stable onChange (disabled for historical versions, guarded across
  // document switches)
  // =========================================================================

  const isViewingHistoricalRef = useRef(ccr.isViewingHistoricalVersion);
  isViewingHistoricalRef.current = ccr.isViewingHistoricalVersion;

  // With Puck surviving document switches, onChange can fire while the canvas
  // still shows the previous document but ccr already targets the new one
  // (load in flight, or loaded but not yet pushed by the sync plugin). Saving
  // then would write the old page's content into the new page — drop instead.
  const saveTargetKeyRef = useRef<string | null>(null);
  saveTargetKeyRef.current = ccr.currentDocument?.id
    ? documentSyncKey(ccr.branchId, ccr.currentDocument.id)
    : null;

  const eagerVersionHandler = useMemo(
    () => makeEagerVersionHandler(
      needsVersionRef,
      () => eagerVersionParamsRef.current,
      {
        createVersion: (siteId, params) => ccr.client.versions.create(siteId, params),
        refreshVersions,
      },
    ),
    [ccr.client, refreshVersions],
  );

  const { saveData } = ccr;
  const onChange = useCallback(
    (data: unknown) => {
      if (isViewingHistoricalRef.current) return;
      // The blank sentinel stays permissive so a consumer running without the
      // document-sync plugin is not frozen read-only.
      const appliedKey = documentSyncStore.getAppliedKey();
      if (appliedKey !== BLANK_SYNC_KEY && appliedKey !== saveTargetKeyRef.current) {
        console.warn(
          '[useP1Editor] save SKIPPED: canvas/document mismatch during switch.',
          'canvas:', appliedKey, 'target:', saveTargetKeyRef.current,
        );
        return;
      }
      eagerVersionHandler(data as Record<string, unknown>);
      saveData(data as PuckData);
    },
    [saveData, documentSyncStore, eagerVersionHandler]
  );

  // =========================================================================
  // Permissions (read-only for historical versions)
  // =========================================================================

  const permissions = useMemo((): Record<string, boolean> => {
    if (ccr.isViewingHistoricalVersion) {
      // Omit edit:false so page/root fields are never locked by Puck's own
      // readonly rendering. Interaction is blocked by ReadOnlyFieldsGuard
      // (inert attribute) instead, which also covers root fields without
      // requiring resolvePermissions on config.root.
      return { delete: false, drag: false, duplicate: false, insert: false };
    }
    return { delete: true, drag: true, duplicate: true, edit: true, insert: true };
  }, [ccr.isViewingHistoricalVersion]);

  // =========================================================================
  // Stable merged overrides
  // =========================================================================

  // Merge additional overrides (e.g. from media plugins) with P1 overrides.
  // Uses ref pattern to keep the merge stable — only recomputes when
  // p1Overrides changes, not when additionalOverrides reference changes
  // (which would happen every render if the consumer doesn't memoize).
  const additionalOverridesRef = useRef(additionalOverrides);
  additionalOverridesRef.current = additionalOverrides;

  // Thumbnail override — built from the thumbnails map and merged between
  // p1Overrides and additionalOverrides so the site can still fully override
  // componentItem if needed.
  const thumbnailsRef = useRef(thumbnails);
  thumbnailsRef.current = thumbnails;

  // Live thumbnail drawer — default ON for every consumer. Uses raw puckConfig
  // (not configWithPermissions) so previews show all components regardless of
  // role. Because useMemo deps on p1Overrides (stable after mount), changes to
  // puckConfig or liveThumbnailDrawer after mount are not picked up.
  const puckConfigRef = useRef(puckConfig);
  puckConfigRef.current = puckConfig;
  const liveThumbnailDrawerRef = useRef(liveThumbnailDrawer);
  liveThumbnailDrawerRef.current = liveThumbnailDrawer;

  const mergedOverrides = useMemo(() => {
    // Layer order (last wins):
    //   p1Overrides → liveThumbnailDrawer → thumbnailOverride → additionalOverrides
    const layers: (Partial<PuckOverrides> | null)[] = [
      p1Overrides,
      resolveLiveThumbnailDrawer(puckConfigRef.current, liveThumbnailDrawerRef.current),
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
  }, [p1Overrides]);

  // =========================================================================
  // Assemble puckProps
  // =========================================================================

  // Key that forces Puck to remount on role change (let puck internally manage the change on document change),
  // ensuring clean undo history, sidebar state, and fresh permission cache.
  // Puck caches resolvePermissions results per component instance — the
  // cache is only invalidated when component data changes, not when the
  // resolver function changes. Including userRole in the key forces a
  // clean remount with an empty cache when roles switch.
  const puckKey = `ccr-${ccr.userRole}`;

  // Sidebar visibility for the initial mount. puckKey is the dependency on
  // purpose even though it is not read here: a new key remounts Puck, which
  // re-reads this as its initial `ui`, so the budget must be applied again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialSidebarUi = useMemo<Partial<UiState>>(() => initialPanelUi(), [puckKey]);

  // Focus highlighting is handled via direct DOM manipulation in
  // PresenceFocusBridge (P1App.tsx) — no config wrapping needed.

  // Inject per-component resolvePermissions into the Puck config.
  // Puck doesn't have a top-level resolvePermissions prop — permissions
  // must be resolved per-component via config[type].resolvePermissions.
  const resolvePermsRef = useRef(ccr.resolvePermissions);
  resolvePermsRef.current = ccr.resolvePermissions;

  // Template mode: editing a template document (path `_registry/templates/<name>`).
  const isTemplateMode = /^_registry\/templates\//.test(ccr.currentDocument?.path ?? '');

  const configWithPermissions = useMemo(() => {
    let cfg = puckConfig as Record<string, unknown>;

    if (ccr.resolvePermissions) {
      const components = (cfg.components ?? {}) as Record<string, Record<string, unknown>>;
      const wrapped: Record<string, unknown> = {};
      for (const [name, comp] of Object.entries(components)) {
        wrapped[name] = {
          ...comp,
          resolvePermissions: (
            data: { props?: { id?: string } },
            params: { permissions: Record<string, boolean>; appState: { data: { root: { props: Record<string, unknown> } } } }
          ) => {
            const resolver = resolvePermsRef.current;
            if (!resolver) return params.permissions;
            const basePerms = resolver({ type: name, props: data?.props }, {});

            // Template-authoring mode: the context resolver only sees a
            // metadata summary (no pins), so the document's live _pinMap is the
            // pin source. On a bound page the resolver reads the live template
            // and already governs pins, so the page's own snapshot pinMap is
            // ignored — otherwise a stale pin would stay locked after the
            // template unpins it.
            if (isTemplateMode) {
              const pinMap = (params.appState?.data?.root?.props?._pinMap ?? {}) as Record<string, boolean>;
              const compId = data?.props?.id;

              if (compId && pinMap[compId]) {
                return { ...basePerms, drag: false, delete: false };
              }
            }

            return basePerms;
          },
        };
      }
      cfg = { ...cfg, components: wrapped };
    }

    // In template mode, relabel the right-sidebar root header "Page" -> "Template".
    // Puck derives that heading from `config.root.label` (no override hook exists).
    if (isTemplateMode) {
      const root = (cfg.root ?? {}) as Record<string, unknown>;
      cfg = { ...cfg, root: { ...root, label: 'Template' } };
    }

    return cfg;
  }, [puckConfig, !!ccr.resolvePermissions, isTemplateMode]);

  const puckProps: PuckProps = useMemo(
    () => ({
      config: configWithPermissions,
      data: ccr.safeData,
      onChange,
      plugins,
      overrides: mergedOverrides,
      ui: initialSidebarUi,
      permissions,
      onAction: ccr.handleAction,
    }),
    [configWithPermissions, ccr.safeData, onChange, plugins, mergedOverrides, initialSidebarUi, permissions, ccr.handleAction]
  );

  // =========================================================================
  // Retained content
  // =========================================================================

  // A reload empties ccr.safeData before the new document arrives, so handing
  // the live props straight to Puck blanks the canvas mid-switch. Keeping the
  // last props that rendered lets the caller show the outgoing page under a
  // waiting indicator instead — and spares every caller from re-implementing
  // the same ref.
  const inFlight = branchBootError === null && loading;
  const lastGoodRef = useRef<{ puckKey: string; puckProps: PuckProps } | null>(null);
  // `loading` only turns on once the load effect fires, a render after the path
  // or branch already changed. Keying off the path the effect actually finished
  // is what stops that in-between render from banking an emptied document.
  const settled =
    loadedPathRef.current === documentPath && loadedBranchRef.current === ccr.branchId;
  if (settled && !inFlight && !error && !branchBootError) {
    lastGoodRef.current = { puckKey, puckProps };
  }
  const retained = lastGoodRef.current;
  const hasContent = retained !== null;
  const reloadKind: ReloadKind =
    loadedBranchRef.current !== null && loadedBranchRef.current !== ccr.branchId
      ? 'branch'
      : 'document';

  return {
    loading: inFlight && !hasContent,
    reloading: inFlight && hasContent ? reloadKind : null,
    hasContent,
    error: error ?? branchBootError,
    puckKey: retained?.puckKey ?? puckKey,
    puckProps: retained?.puckProps ?? puckProps,
    css: ccr,
    /** @deprecated No longer emitted — editor now shows an empty state when a document is not found on the current branch. */
    redirectPath: null as string | null,
  };
}
