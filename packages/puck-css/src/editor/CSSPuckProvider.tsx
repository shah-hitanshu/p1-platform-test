/**
 * CSS Puck Provider
 *
 * React context provider for CSS Puck integration.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type {
  Document,
  PuckData,
  Checkpoint,
  Branch,
  DocumentVersion,
  ActorPresence,
} from '@pantheon-systems/css-client';
import type { CSSPuckConfig, CSSPuckContextValue, SaveStatus, PresenceState } from '../core/types.js';
import { CSSPuckContext } from '../core/CSSPuckContext.js';
import { NotificationProvider, useNotifications } from '../core/NotificationContext.js';
import { PresenceContext } from '../core/PresenceContext.js';
import type { PresenceContextValue } from '../core/PresenceContext.js';
import { debounce } from '../core/utils/debounce.js';
import { withRetry } from '../core/utils/retry.js';
import { useRealtime } from './useRealtime.js';
import { useDocuments } from './useDocuments.js';
import type { UseAgentEditReturn } from '../agent/useAgentEdit.js';
import type { UseAgentTriggerReturn } from '../agent/useAgentTrigger.js';
import type { ConflictNotification } from '../merge/components/conflict-notifications/index.js';
import type { CSSFeaturePlugin, CSSFeaturePluginDeps } from '../core/plugin-types.js';
import type { CSSFeatureConfig } from '../core/featureConfig.js';
import { resolveFeatureConfig } from '../core/featureConfig.js';
import { resolveActivePlugins, composeProviders } from './composePlugins.js';
import { DEFAULT_CSS_FEATURE_PLUGINS } from './defaultPlugins.js';

export interface CSSPuckProviderProps extends CSSPuckConfig {
  children: React.ReactNode;
  /**
   * Whether to show error notifications automatically.
   * @default true
   */
  showErrorNotifications?: boolean;
  /**
   * Optional token refresher for WebSocket reconnection with fresh tokens.
   */
  realtimeTokenRefresher?: () => Promise<string | null>;
  /**
   * Feature plugins to compose into the provider tree.
   * Each plugin can provide a React context wrapper, Puck plugins, and overrides.
   * Defaults to DEFAULT_CSS_FEATURE_PLUGINS when not provided.
   */
  featurePlugins?: CSSFeaturePlugin[];
  /**
   * Feature configuration flags controlling which UI features are enabled.
   * When provided, overrides boolean props (presenceEnabled, agentModeEnabled, etc.).
   * When omitted, derived from the existing boolean props for backwards compatibility.
   */
  featureConfig?: CSSFeatureConfig;
}

/**
 * Provider component for CSS Puck integration.
 *
 * Wraps your Puck editor to provide CSS functionality including:
 * - Auto-save with debouncing
 * - Document loading
 * - Checkpoint (publish) creation
 * - Branch switching
 * - Toast notifications for errors and success
 *
 * @example
 * ```tsx
 * import { CSSPuckProvider, CSSPuckEditor } from '@pantheon-systems/puck-css';
 * import { CSSClient } from '@pantheon-systems/css-client';
 *
 * const client = new CSSClient({
 *   baseUrl: 'http://localhost:8787',
 *   apiKey: 'your-api-key',
 * });
 *
 * function App() {
 *   return (
 *     <CSSPuckProvider
 *       client={client}
 *       siteId="site-123"
 *       branchId="branch-456"
 *       userId="user-789"
 *     >
 *       <CSSPuckEditor config={puckConfig} documentPath="/home" />
 *     </CSSPuckProvider>
 *   );
 * }
 * ```
 */
export function CSSPuckProvider(props: CSSPuckProviderProps): React.ReactElement {
  return (
    <NotificationProvider>
      <CSSPuckProviderInner {...props} />
    </NotificationProvider>
  );
}

/**
 * Inner provider component that has access to notification context.
 */
function CSSPuckProviderInner({
  client,
  siteId,
  branchId: initialBranchId,
  userId,
  autoSaveDelay = 3000,
  maxRetries = 3,
  showErrorNotifications = true,
  enableRealtime = true,
  wsBaseUrl,
  realtimeApiKey,
  realtimeSyncInterval: _realtimeSyncInterval = 250,
  realtimeTokenRefresher,
  // Phase 9: Presence props
  presenceEnabled = true,
  presencePollingInterval = 5000,
  userName: _userName,
  userAvatar: _userAvatar,
  userNameResolver,
  // Phase 9: Agent mode props
  agentModeEnabled = false,
  agentId,
  agentTrigger: _agentTrigger,
  // Phase 9: Callbacks
  onPresenceChange,
  onAgentConflict: _onAgentConflict,
  // Plugin system props (B.4)
  featurePlugins,
  featureConfig,
  children,
}: CSSPuckProviderProps): React.ReactElement {
  // Access notification context
  const notificationContext = useNotifications();

  // Persist selected branch in sessionStorage so it survives provider remounts
  // (e.g. when CSSApp is rendered per-page instead of in a shared layout).
  const branchStorageKey = `css-branch-${siteId}`;

  const getPersistedBranchId = useCallback((): string => {
    try {
      return (typeof window !== 'undefined' && sessionStorage.getItem(branchStorageKey)) || '';
    } catch {
      return '';
    }
  }, [branchStorageKey]);

  const persistBranchId = useCallback((id: string) => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(branchStorageKey, id);
      }
    } catch {
      // sessionStorage may be unavailable (SSR, privacy mode)
    }
  }, [branchStorageKey]);

  // Site name — fetched once on mount from the CSS API
  const [siteName, setSiteName] = useState<string | null>(null);
  useEffect(() => {
    client.sites?.get(siteId)
      ?.then((site) => setSiteName(site.name))
      .catch(() => {});
  }, [client, siteId]);

  // Branch state - start with initialBranchId, persisted branch, or empty (will be set to main)
  const [branchId, setBranchId] = useState(() => {
    if (initialBranchId) return initialBranchId;
    try {
      return (typeof window !== 'undefined' && sessionStorage.getItem(branchStorageKey)) || '';
    } catch {
      return '';
    }
  });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(() => {
    if (initialBranchId) return false;
    try {
      return !(typeof window !== 'undefined' && sessionStorage.getItem(branchStorageKey));
    } catch {
      return true;
    }
  });

  // Document state
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [currentData, setCurrentData] = useState<PuckData | null>(null);

  // Save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<Error | null>(null);

  // Pending data for debounced save - use ref to avoid recreating debounce
  const pendingDataRef = useRef<PuckData | null>(null);
  const currentDocumentRef = useRef<Document | null>(null);
  const initializedRef = useRef(false);

  // Track the latest Puck action metadata for inclusion in sync payloads.
  // Set by handleAction (Puck's onAction callback), consumed by saveData
  // when sending changes via realtime, then cleared.
  const lastActionRef = useRef<{ actionType: string; actionMetadata: Record<string, unknown> } | null>(null);

  // Tracks the document path that the current data in state belongs to.
  // Set alongside every setCurrentData call to record the data's origin.
  // Checked before every write (realtime or REST) to prevent cross-document
  // corruption during rapid document switching.
  const currentDataDocumentPathRef = useRef<string | null>(null);

  // Suppresses the next saveData call after loadDocument completes.
  // PuckDataSynchronizer dispatches setData into Puck, which fires onChange,
  // which calls saveData — but this is just echoing the loaded data, not a
  // user edit. This flag prevents that echo from triggering a false save.
  const suppressNextSaveRef = useRef(false);

  // Monotonically increasing counter for stale loadDocument response detection.
  // Each loadDocument call increments this and captures the current value.
  // After each async operation, the captured value is compared to the current
  // value — if they differ, a newer loadDocument call has started and the
  // current one should bail out.
  const loadRequestIdRef = useRef(0);

  // Track realtime connection state for use in performSave (avoids stale closure)
  const realtimeConnectedRef = useRef(false);

  // Auto-save pause state
  const [autoSavePaused, setAutoSavePaused] = useState(false);

  // Version viewing state
  const [viewingVersion, setViewingVersion] = useState<DocumentVersion | null>(null);
  const [latestVersionData, setLatestVersionData] = useState<PuckData | null>(null);

  // Remote sync key - changes when remote updates arrive to trigger Puck sync
  const [remoteSyncKey, setRemoteSyncKey] = useState<string | null>(null);

  // Counter to track pending remote updates that will trigger onChange callbacks.
  // When we receive a remote update and sync it to Puck via setData, Puck fires onChange.
  // We need to skip the realtime send for that onChange to prevent bounce-back loops.
  // Using a counter is more reliable than a timeout because it's synchronized with
  // the actual number of remote updates received.
  const pendingRemoteUpdatesRef = useRef(0);

  // Flag to track if we're currently applying a remote sync.
  // This is set before setCurrentData and cleared after a short delay to ensure
  // all related onChange events are skipped (there may be multiple: one from data
  // prop change and one from setData dispatch).

  // Pending remote data ref - stores latest data during debounce period
  const pendingRemoteDataRef = useRef<PuckData | null>(null);
  // Debounce timer for remote sync - batches rapid updates to reduce flickering
  const remoteSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Delay for debouncing remote sync updates (ms)
  const REMOTE_SYNC_DEBOUNCE_DELAY = 50;


  // Ref to track viewingVersion for use in callbacks (avoids stale closure)
  const viewingVersionRef = useRef<DocumentVersion | null>(null);

  // Helper to cancel any pending remote sync - used when loading documents/versions
  // This prevents race conditions where a pending remote update overrides loaded data
  const cancelPendingRemoteSync = useCallback(() => {
    if (remoteSyncTimerRef.current) {
      clearTimeout(remoteSyncTimerRef.current);
      remoteSyncTimerRef.current = null;
    }
    pendingRemoteDataRef.current = null;
  }, []);

  // WebSocket presence state - used when realtime is connected for instant presence updates
  const [wsPresenceActors, setWsPresenceActors] = useState<ActorPresence[]>([]);
  const [wsPresenceActive, setWsPresenceActive] = useState(false);

  // Helper to enrich actors with display names from the resolver
  const enrichActorsWithNames = useCallback((actors: ActorPresence[]): ActorPresence[] => {
    if (!userNameResolver) return actors;
    return actors.map((actor) => {
      const resolvedName = userNameResolver(actor.actorId);
      return resolvedName ? { ...actor, name: resolvedName } : actor;
    });
  }, [userNameResolver]);

  // Real-time collaboration hook
  const realtime = useRealtime({
    baseUrl: wsBaseUrl ?? '',
    apiKey: realtimeApiKey,
    tokenRefresher: realtimeTokenRefresher,
    siteId,
    branchId,
    documentPath: currentDocument?.path ?? null,
    actorId: userId,
    actorType: 'user',
    enabled: enableRealtime && !!wsBaseUrl,
    initialData: currentData,
    // WebSocket presence callbacks - receive instant presence updates
    onPresenceUpdate: (actors) => {
      // Mark WebSocket presence as active (first update received)
      setWsPresenceActive(true);
      // Filter out self, enrich with names, and update state
      const filtered = actors.filter((a) => a.actorId !== userId);
      const enriched = enrichActorsWithNames(filtered);
      setWsPresenceActors(enriched);
    },
    onFocusRegionBroadcast: (actorId, focusRegions) => {
      // Update focus regions for the specific actor
      setWsPresenceActors((prev) =>
        prev.map((a) => (a.actorId === actorId ? { ...a, focusRegions } : a))
      );
    },
    onRemoteUpdate: (data) => {
      const componentCount = data.content?.length ?? 0;
      const zoneCount = data.zones ? Object.keys(data.zones).length : 0;
      console.log(
        '[CSSPuckProvider] onRemoteUpdate received:',
        `components=${componentCount}, zones=${zoneCount},`,
        `pendingRemoteUpdates=${pendingRemoteUpdatesRef.current},`,
        `viewingVersion=${viewingVersionRef.current !== null}`
      );

      // Don't apply remote updates while viewing a historical version
      // The user is viewing read-only historical data and shouldn't see live changes
      if (viewingVersionRef.current !== null) {
        console.log('[CSSPuckProvider] onRemoteUpdate SKIPPED: viewing historical version');
        return;
      }

      // Reject empty data that would overwrite real editor content.
      // During initial Yjs sync, the remote doc may be empty, producing
      // { content: [], root: { props: {} } }. Applying this would clear
      // the editor and trigger a save loop.
      const rootProps = data.root.props;
      if (
        data.content.length === 0 &&
        (!rootProps || Object.keys(rootProps).length === 0) &&
        !data.zones
      ) {
        console.log('[CSSPuckProvider] onRemoteUpdate SKIPPED: empty data rejected');
        return;
      }

      // Store the latest data - will be used when debounce fires
      pendingRemoteDataRef.current = data;

      // Clear any pending debounce timer
      if (remoteSyncTimerRef.current) {
        clearTimeout(remoteSyncTimerRef.current);
      }

      // Debounce the sync to batch rapid successive updates
      // This prevents plugin recreation and flickering on every update
      remoteSyncTimerRef.current = setTimeout(() => {
        // Double-check we're still not viewing a historical version
        // (user might have switched while debounce was pending)
        if (viewingVersionRef.current !== null) {
          pendingRemoteDataRef.current = null;
          remoteSyncTimerRef.current = null;
          return;
        }

        const dataToSync = pendingRemoteDataRef.current;
        if (dataToSync) {
          const syncComponentCount = dataToSync.content?.length ?? 0;
          console.log(
            '[CSSPuckProvider] onRemoteUpdate APPLYING:',
            `components=${syncComponentCount},`,
            `pendingRemoteUpdates will be=${pendingRemoteUpdatesRef.current + 1}`
          );

          // Increment counter to skip the onChange echo(es) that will fire
          // when Puck processes the setCurrentData call below.
          // The content-based guards in puckDataToYMap and RealtimeClient
          // prevent actual echo loops at the Y.Doc/WebSocket layer.
          pendingRemoteUpdatesRef.current += 1;

          // Update current data when remote changes arrive
          currentDataDocumentPathRef.current = currentDocumentRef.current?.path ?? null;
          setCurrentData(dataToSync);
          // Update sync key to trigger Puck re-sync
          setRemoteSyncKey(`remote-${Date.now()}`);

          pendingRemoteDataRef.current = null;

          // Safety net: reset counter after React has processed the state updates.
          // If the remote data is identical to current editor state, Puck won't
          // fire onChange and the counter would never be decremented naturally.
          // Leaving it > 0 would cause subsequent local edits to be dropped.
          setTimeout(() => {
            pendingRemoteUpdatesRef.current = 0;
          }, 100);
        }
        remoteSyncTimerRef.current = null;
      }, REMOTE_SYNC_DEBOUNCE_DELAY);
    },
  });

  // Keep a stable ref to realtime for use in callbacks without dependency churn
  const realtimeRef = useRef(realtime);
  realtimeRef.current = realtime;

  // Cleanup remote sync timer on unmount
  useEffect(() => {
    return () => {
      if (remoteSyncTimerRef.current) {
        clearTimeout(remoteSyncTimerRef.current);
      }
    };
  }, []);

  // PuckDataCapture catch-up: detects data that Puck's onChange missed.
  // Puck's onChange can miss the very last keystroke in a typing burst because
  // createOnChange dispatches asynchronously (via resolveComponentData) and
  // the Zustand subscriber may not fire for the final state update in time.
  // PuckDataCapture subscribes to Puck's Zustand store independently via
  // createUsePuck() and writes the true current data to this ref.
  // The onDataChange callback debounces and compares with what saveData last
  // sent — if they differ, it pushes the corrected data through realtime.
  const realtimeDataCaptureRef = useRef<PuckData | null>(null);
  const lastSentDataRef = useRef<string | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the last data sent via saveData so we can detect missed updates.
  // Updated in saveData's realtime branch (the happy path).
  const trackSentData = useCallback((data: PuckData) => {
    lastSentDataRef.current = JSON.stringify(data);
  }, []);

  // Callback for PuckDataCapture.onDataChange — fires when Puck's store
  // updates (may fire for changes that onChange misses).
  const handleRealtimeDataCapture = useCallback((data: PuckData) => {
    if (!enableRealtime) return;

    // Store the latest data in the ref for comparison when the timer fires.
    // The ref always holds the most recent Zustand store snapshot.
    realtimeDataCaptureRef.current = data;

    // Debounce: wait 800ms after the last store update to allow onChange
    // to process normally. When the timer fires, compare the ref's current
    // data (not the closure's stale copy) against what was last sent.
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    captureTimerRef.current = setTimeout(() => {
      if (!realtimeConnectedRef.current) return;
      if (viewingVersionRef.current !== null) return;

      const currentData = realtimeDataCaptureRef.current;
      if (!currentData) return;

      const dataJson = JSON.stringify(currentData);

      // If saveData already sent this exact data, no catch-up needed
      if (dataJson === lastSentDataRef.current) return;

      // Data origin guard
      const currentPath = currentDocumentRef.current?.path ?? null;
      const dataOriginPath = currentDataDocumentPathRef.current;
      if (dataOriginPath !== currentPath) return;

      console.log('[CSSPuckProvider] PuckDataCapture catch-up: sending missed data,', `components=${currentData.content?.length ?? 0}`);
      realtimeRef.current.applyLocalChange(currentData);
      lastSentDataRef.current = dataJson;
    }, 800);
  }, [enableRealtime]);

  // Cleanup capture timer on unmount
  useEffect(() => {
    return () => {
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    };
  }, []);

  // Keep refs in sync with state
  useEffect(() => {
    currentDocumentRef.current = currentDocument;
  }, [currentDocument]);

  useEffect(() => {
    viewingVersionRef.current = viewingVersion;
  }, [viewingVersion]);

  // Keep realtime connection ref in sync (used by performSave to avoid stale closure)
  useEffect(() => {
    realtimeConnectedRef.current = realtime.connected;
  }, [realtime.connected]);

  // Create client with user principal
  const userClient = useMemo(
    () => client.withPrincipal({ id: userId, type: 'user' }),
    [client, userId]
  );

  // Document list for current branch
  const {
    documents: branchDocuments,
    loading: documentsLoading,
    create: createDocumentRaw,
    remove: removeDocumentRaw,
  } = useDocuments({ client: userClient, siteId, branchId });

  // Stable document create/delete callbacks
  const branchIdRef = useRef(branchId);
  branchIdRef.current = branchId;
  const createDocumentRawRef = useRef(createDocumentRaw);
  createDocumentRawRef.current = createDocumentRaw;
  const stableCreateDocument = useCallback(
    async (path: string): Promise<void> => {
      if (!branchIdRef.current) {
        throw new Error('Cannot create document: no branch selected');
      }
      await createDocumentRawRef.current(path);
    },
    []
  );

  const removeDocumentRawRef = useRef(removeDocumentRaw);
  removeDocumentRawRef.current = removeDocumentRaw;
  const stableDeleteDocument = useCallback(
    async (documentId: string, _path: string): Promise<void> => {
      if (!branchIdRef.current) {
        throw new Error('Cannot delete document: no branch selected');
      }
      await removeDocumentRawRef.current(documentId);
    },
    []
  );

  // Load branches
  const refreshBranches = useCallback(async () => {
    try {
      setBranchesLoading(true);
      const branchList = await userClient.branches.list(siteId);
      setBranches(branchList);

      // Update current branch from current branchId state
      setBranchId((currentBranchId) => {
        let effectiveBranchId = currentBranchId;

        // If no branchId set, try persisted branch, then default to main
        if (!effectiveBranchId) {
          const persisted = getPersistedBranchId();
          if (persisted && branchList.some((b) => b.id === persisted)) {
            effectiveBranchId = persisted;
          }
        }

        // Validate that the branch exists in the list; fall back to main if not
        if (effectiveBranchId && !branchList.some((b) => b.id === effectiveBranchId)) {
          const mainBranch = branchList.find((b) => b.isMain);
          effectiveBranchId = mainBranch?.id ?? effectiveBranchId;
        }

        // Default to main if still empty
        if (!effectiveBranchId) {
          const mainBranch = branchList.find((b) => b.isMain);
          if (mainBranch) {
            effectiveBranchId = mainBranch.id;
          }
        }

        persistBranchId(effectiveBranchId);
        const current = branchList.find((b) => b.id === effectiveBranchId);
        setCurrentBranch(current ?? null);

        return effectiveBranchId;
      });
    } catch (error) {
      console.error('Failed to load branches:', error);
    } finally {
      setBranchesLoading(false);
    }
  }, [userClient, siteId, getPersistedBranchId, persistBranchId]);

  const createBranch = useCallback(
    async (name: string) => {
      const branch = await userClient.branches.create({ siteId, name });
      await refreshBranches();
      return branch;
    },
    [userClient, siteId, refreshBranches],
  );

  // Initial branch load - only once
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      void refreshBranches();
    }
  }, [refreshBranches]);

  // Perform save operation - uses refs to avoid dependency issues
  const performSave = useCallback(async () => {
    const dataToSave = pendingDataRef.current;
    const doc = currentDocumentRef.current;

    if (!dataToSave || !doc) {
      return;
    }

    // Data origin guard: reject writes if data doesn't belong to current document
    if (currentDataDocumentPathRef.current !== doc.path) {
      pendingDataRef.current = null;
      return;
    }

    // When realtime is connected, the DO handles persistence via WebSocket sync.
    // Skip REST API save to avoid creating duplicate versions without CRDT state.
    if (enableRealtime && realtimeConnectedRef.current) {
      // The data is already being sent via realtime.applyLocalChange in saveData.
      // Mark as saved since the DO will persist it.
      pendingDataRef.current = null;
      setSaveStatus('saved');
      setLastSaved(new Date());
      return;
    }

    // Fallback: REST API save when realtime is disabled or disconnected
    setSaveStatus('saving');
    setSaveError(null);

    try {
      await withRetry(
        async () => {
          await userClient.versions.create(siteId, {
            documentId: doc.id,
            branchId,
            snapshot: dataToSave as unknown as Record<string, unknown>,
          });
        },
        { maxAttempts: maxRetries }
      );

      // Note: We intentionally do NOT call setCurrentData(dataToSave) here.
      // The data is already in Puck's internal state (it came from Puck's onChange).
      // Updating currentData would trigger a re-render cascade that recreates the
      // cssPlugin, causing Puck to potentially re-render and flicker.
      // currentData should only be updated when loading a document or switching versions.
      pendingDataRef.current = null;
      setSaveStatus('saved');
      setLastSaved(new Date());
    } catch (error) {
      setSaveStatus('error');
      const saveErr = error instanceof Error ? error : new Error(String(error));
      setSaveError(saveErr);

      // Show error notification with retry action
      if (showErrorNotifications) {
        notificationContext.addError(
          `Failed to save changes: ${saveErr.message}`,
          () => void performSave()
        );
      }
    }
  }, [userClient, siteId, branchId, maxRetries, showErrorNotifications, notificationContext, enableRealtime]);

  // Debounced save
  const debouncedSave = useMemo(
    () =>
      debounce(() => {
        void performSave();
      }, autoSaveDelay),
    [performSave, autoSaveDelay]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  // Pause auto-save
  const pauseAutoSave = useCallback(() => {
    debouncedSave.pause();
    setAutoSavePaused(true);
  }, [debouncedSave]);

  // Resume auto-save
  const resumeAutoSave = useCallback(() => {
    debouncedSave.resume();
    setAutoSavePaused(false);
  }, [debouncedSave]);

  // Capture Puck action metadata from the onAction callback.
  // This captures the action type and relevant metadata fields so they
  // can be included in the sync payload for backend version storage.
  const handleAction = useCallback((action: Record<string, unknown>) => {
    const actionMetadata: Record<string, unknown> = {};

    if (action.componentType) actionMetadata.componentType = action.componentType;
    if (action.componentId) actionMetadata.componentId = action.componentId;
    if (action.zone) actionMetadata.zone = action.zone;
    if (action.sourceIndex !== undefined) actionMetadata.sourceIndex = action.sourceIndex;
    if (action.destinationIndex !== undefined) actionMetadata.destinationIndex = action.destinationIndex;

    lastActionRef.current = {
      actionType: (action.type as string) || 'unknown',
      actionMetadata,
    };
  }, []);

  // Public save function (triggers debounce)
  // Also resumes auto-save if paused, per user requirement
  // Sends changes via WebSocket when realtime is enabled (but not for remote updates)
  const saveData = useCallback(
    (data: PuckData) => {
      const componentCount = data.content?.length ?? 0;

      // Suppress the onChange echo from PuckDataSynchronizer after loadDocument.
      if (suppressNextSaveRef.current) {
        console.log(`[CSSPuckProvider] saveData SKIPPED: suppressNextSave (components=${componentCount})`);
        suppressNextSaveRef.current = false;
        return;
      }

      // When realtime is enabled, detect whether this onChange came from a remote
      // sync (Yjs update from another client) vs. a local user edit.
      // Remote updates should NOT trigger a REST save — the DO handles persistence.
      // Important: we must NOT set pendingDataRef for remote syncs, otherwise
      // getHasUnsavedChanges() will incorrectly report unsaved changes.
      if (enableRealtime && realtime.connected) {
        if (pendingRemoteUpdatesRef.current > 0) {
          // Counter indicates this onChange is from a remote update or data load
          console.log(`[CSSPuckProvider] saveData SKIPPED: pendingRemoteUpdates=${pendingRemoteUpdatesRef.current} (components=${componentCount})`);
          pendingRemoteUpdatesRef.current -= 1;
          return;
        } else if (viewingVersionRef.current !== null) {
          // User is viewing historical version - don't broadcast or save
          console.log(`[CSSPuckProvider] saveData SKIPPED: viewing historical version (components=${componentCount})`);
          return;
        } else {
          const currentPath = currentDocumentRef.current?.path ?? null;

          // Data origin guard: verify the data in state belongs to the
          // current document. During rapid document switching, a stale
          // loadDocument call can resolve and set data from document Y
          // into state after currentDocument has been updated to X.
          const dataOriginPath = currentDataDocumentPathRef.current;
          if (dataOriginPath !== currentPath) {
            console.warn(
              '[CSSPuckProvider] saveData SKIPPED: data origin mismatch.',
              'dataOrigin:', dataOriginPath, 'currentDoc:', currentPath,
              `components=${componentCount}`,
            );
            return;
          }

          // Connection identity guard: verify the realtime connection is
          // bound to the same document we're currently editing.
          const connectedPath = realtime.connectedDocumentPath;
          if (currentPath !== connectedPath) {
            console.warn(
              '[CSSPuckProvider] saveData SKIPPED: connection identity mismatch.',
              'currentDoc:', currentPath, 'connectedDoc:', connectedPath,
              `components=${componentCount}`,
            );
            return;
          }

          // Local user edit — send via WebSocket (DO handles persistence)
          // Echo prevention is handled at lower layers:
          // - puckDataToYMap no-ops when Y.Doc already has identical data
          // - RealtimeClient.lastSentSnapshot drops sends matching last sent/received
          console.log(`[CSSPuckProvider] saveData SENDING via realtime: components=${componentCount}, path=${currentPath}`);
          realtime.applyLocalChange(data);
          trackSentData(data);
          lastActionRef.current = null;
          // Data sent via WebSocket — DO handles persistence.
          // Update save status directly (skip debouncedSave/performSave chain).
          setSaveStatus('saved');
          setLastSaved(new Date());
          return;
        }
      }

      // Non-realtime path: mark data as pending and trigger debounced REST save
      console.log(`[CSSPuckProvider] saveData via REST (debounced): components=${componentCount}, realtimeEnabled=${enableRealtime}, connected=${realtime.connected}`);
      pendingDataRef.current = data;

      if (debouncedSave.isPaused()) {
        debouncedSave.resume();
        setAutoSavePaused(false);
      }
      debouncedSave();
    },
    [debouncedSave, enableRealtime, realtime.connected, trackSentData]
  );

  // Force immediate save
  const saveNow = useCallback(async () => {
    debouncedSave.cancel();

    // When realtime is connected, ensure the latest data is sent via WebSocket
    if (enableRealtime && realtimeConnectedRef.current && pendingDataRef.current) {
      const currentPath = currentDocumentRef.current?.path ?? null;
      const dataOriginPath = currentDataDocumentPathRef.current;
      const connectedPath = realtime.connectedDocumentPath;
      // Data origin + connection identity guards
      if (dataOriginPath === currentPath && currentPath === connectedPath) {
        realtime.applyLocalChange(pendingDataRef.current);
        pendingDataRef.current = null;
        setSaveStatus('saved');
        setLastSaved(new Date());
        return;
      }
      // Fall through to REST save if mismatch
    }

    await performSave();
  }, [debouncedSave, performSave, enableRealtime]);

  // Load document by path
  const loadDocument = useCallback(
    async (path: string) => {
      // Cancel any pending remote sync to prevent race conditions
      // where a stale remote update overrides the document we're loading
      cancelPendingRemoteSync();

      // Increment load request counter and capture for staleness detection.
      // If a newer loadDocument call starts before our awaits resolve, the
      // counter will have been incremented again and our captured value
      // will no longer match — signaling that our response is stale.
      loadRequestIdRef.current += 1;
      const thisRequestId = loadRequestIdRef.current;

      // Pre-clear the current document immediately so the preview shows the
      // empty state right away rather than stale content during the fetch.
      currentDataDocumentPathRef.current = null;
      setCurrentData(null);
      setCurrentDocument(null);

      try {
        // Normalize path: strip leading slash if present
        const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

        // Get document by path
        const doc = await userClient.documents.getByPath(siteId, normalizedPath);

        // Staleness check: a newer loadDocument call has started
        if (thisRequestId !== loadRequestIdRef.current) {
          console.debug('[CSSPuckProvider] Stale loadDocument — skipping (after getByPath)');
          return;
        }

        // Clear stale data BEFORE updating the document identity so that
        // useRealtime's new useEffect sees initialData=null when it creates
        // the fresh Y.Doc. Without this, currentData still holds the previous
        // document's content when setCurrentDocument triggers the re-render,
        // causing the new Y.Doc to be seeded with the wrong document's Yjs
        // state — which the DO then commits as the first realtime version.
        currentDataDocumentPathRef.current = null;
        setCurrentData(null);
        setCurrentDocument(doc);

        // Get latest version
        const version = await userClient.versions.getLatest(siteId, branchId, doc.id);
        const puckData = version.snapshot as unknown as PuckData;

        // Staleness check: a newer loadDocument call has started
        if (thisRequestId !== loadRequestIdRef.current) {
          console.debug('[CSSPuckProvider] Stale loadDocument — skipping (after getLatest)');
          return;
        }

        // Mark REST data as non-local to prevent the Puck onChange handler
        // from echoing it back through the Y.Doc via applyLocalChange.
        // This is critical after the Hibernatable WS migration because
        // initializeIfNeeded() latency can invert the ordering of WebSocket
        // initial state vs REST response, causing the remote-update guard
        // (pendingRemoteUpdatesRef) to be bypassed.
        if (enableRealtime) {
          pendingRemoteUpdatesRef.current += 1;

          // Safety net: reset after React has processed the state updates.
          // If Puck's data is identical to current editor state, onChange
          // won't fire and the counter would never be decremented naturally.
          // Leaving it > 0 would cause subsequent local edits to be dropped.
          setTimeout(() => {
            pendingRemoteUpdatesRef.current = 0;
          }, 100);
        }

        // IMPORTANT: Update the ref BEFORE state updates
        // Setting to null allows remote updates after document loads
        viewingVersionRef.current = null;

        // Cancel any pending PuckDataCapture catch-up timer and reset its
        // ref before arming the data-origin guard below. Without this, the
        // timer can fire in the window between currentDataDocumentPathRef
        // being set to doc.path and the new document's first remote update
        // arriving — passing the origin check while still carrying the
        // previous document's Puck state.
        if (captureTimerRef.current) {
          clearTimeout(captureTimerRef.current);
          captureTimerRef.current = null;
        }
        realtimeDataCaptureRef.current = null;

        currentDataDocumentPathRef.current = doc.path;
        suppressNextSaveRef.current = true;
        setCurrentData(puckData);
        setLatestVersionData(puckData);
        setViewingVersion(null);
        // Clear remoteSyncKey so document sync takes priority
        setRemoteSyncKey(null);
        pendingDataRef.current = null;
        setSaveStatus('idle');
        setSaveError(null);
      } catch (error) {
        // Use warn, not error: callers handle this and console.error triggers
        // the Next.js dev overlay unnecessarily.
        console.warn('[CSSPuckProvider] loadDocument failed:', error);
        // Unload the current document so VersionBannerOverride shows the empty
        // state instead of the previous document's content.
        currentDataDocumentPathRef.current = null;
        setCurrentData(null);
        setCurrentDocument(null);
        throw error;
      }
    },
    [userClient, siteId, branchId, cancelPendingRemoteSync, enableRealtime]
  );

  // Load a specific version into the editor
  const loadVersion = useCallback(
    async (version: DocumentVersion) => {
      // Cancel any pending remote sync to prevent race conditions
      // where a stale remote update overrides the version we're loading
      cancelPendingRemoteSync();

      try {
        const doc = currentDocumentRef.current;
        if (!doc) {
          throw new Error('No document loaded');
        }

        let versionToUse = version;

        // If the version doesn't have snapshot data, try fetching it from the API
        if (!version.snapshot || Object.keys(version.snapshot).length === 0) {
          try {
            versionToUse = await userClient.versions.get(siteId, branchId, doc.id, version.id);
          } catch (fetchError) {
            // If fetching fails, log a warning and use the version as-is
            console.warn('Could not fetch full version data, using version from list:', fetchError);
          }
        }

        let puckData = versionToUse.snapshot as unknown as PuckData;

        // If snapshot is empty or invalid, use blank Puck data
        // This is expected for version 1 which represents the initial blank state
        if (!puckData || (!puckData.content && !puckData.root)) {
          puckData = { content: [], root: { props: {} } };
        }

        // IMPORTANT: Update the ref BEFORE state updates to block any incoming remote updates
        // The effect that syncs viewingVersionRef runs AFTER render, which is too late
        // Remote updates check this ref, so we need it set synchronously
        viewingVersionRef.current = versionToUse;

        currentDataDocumentPathRef.current = currentDocumentRef.current?.path ?? null;
        setCurrentData(puckData);
        setViewingVersion(versionToUse);
        // Clear remoteSyncKey so version sync takes priority
        setRemoteSyncKey(null);
        // Pause auto-save when viewing historical version
        debouncedSave.pause();
        setAutoSavePaused(true);
        pendingDataRef.current = null;
        setSaveStatus('idle');
      } catch (error) {
        console.error('Failed to load version:', error);
        throw error;
      }
    },
    [userClient, siteId, branchId, debouncedSave, cancelPendingRemoteSync]
  );

  // Return to the latest version
  const returnToLatest = useCallback(async () => {
    // Cancel any pending remote sync to prevent race conditions
    // The latest data will be loaded fresh, then remote sync can resume
    cancelPendingRemoteSync();

    // Get current state from Yjs if realtime is connected
    // This ensures we get any changes made by other users while viewing history
    let dataToRestore: PuckData | null = null;

    if (enableRealtime && realtime.connected) {
      const currentYjsData = realtime.getSnapshot();
      if (currentYjsData) {
        dataToRestore = currentYjsData;
      }
    }

    // Fall back to latestVersionData if Yjs snapshot not available
    if (!dataToRestore) {
      dataToRestore = latestVersionData;
    }

    if (dataToRestore) {
      // IMPORTANT: Update the ref BEFORE state updates
      // Setting to null allows remote updates to resume
      viewingVersionRef.current = null;

      // Increment counter to skip onChange that will fire
      pendingRemoteUpdatesRef.current += 1;

      currentDataDocumentPathRef.current = currentDocumentRef.current?.path ?? null;
      setCurrentData(dataToRestore);
      setViewingVersion(null);
      // Clear remoteSyncKey so latest version sync takes priority
      setRemoteSyncKey(null);
      // Resume auto-save
      debouncedSave.resume();
      setAutoSavePaused(false);
      pendingDataRef.current = null;
      setSaveStatus('idle');
    }
  }, [latestVersionData, debouncedSave, cancelPendingRemoteSync, enableRealtime, realtime]);

  // Computed property for whether viewing historical version
  const isViewingHistoricalVersion = viewingVersion !== null;

  // =========================================================================
  // Phase 9: Presence & Agent Mode State
  // =========================================================================

  // Presence state (when presenceEnabled)
  const [presenceActors, setPresenceActors] = useState<ActorPresence[]>([]);
  const presenceInitializedRef = useRef(false);

  // Track previous actors for onPresenceChange callback comparison
  const prevActorsRef = useRef<ActorPresence[]>([]);

  // Conflict notifications state
  const [conflicts, setConflicts] = useState<ConflictNotification[]>([]);

  // Agent edit session state (when agentModeEnabled && agentId)
  const [agentSession, setAgentSession] = useState<{ sessionId: string; checkpointId?: string } | null>(null);
  const [agentEditLoading, setAgentEditLoading] = useState(false);
  const [agentEditError, setAgentEditError] = useState<Error | null>(null);

  // Fetch presence data
  const fetchPresence = useCallback(async () => {
    if (!presenceEnabled || !branchId) return;

    try {
      const branchPresence = await userClient.presence.getBranchPresence(siteId, branchId);

      // Filter out self and enrich with names
      const filteredActors = branchPresence.actors.filter(
        (actor) => actor.actorId !== userId
      );
      const enrichedActors = enrichActorsWithNames(filteredActors);

      setPresenceActors(enrichedActors);

      // Call onPresenceChange if actors changed
      if (onPresenceChange) {
        const actorsChanged =
          JSON.stringify(enrichedActors.map((a) => a.id).sort()) !==
          JSON.stringify(prevActorsRef.current.map((a) => a.id).sort());
        if (actorsChanged) {
          onPresenceChange(enrichedActors);
          prevActorsRef.current = enrichedActors;
        }
      }
    } catch (error) {
      console.error('Failed to fetch presence:', error);
    }
  }, [presenceEnabled, branchId, siteId, userId, userClient, onPresenceChange, enrichActorsWithNames]);

  // Keep fetchPresence in a ref to avoid restarting the interval when callback changes
  const fetchPresenceRef = useRef(fetchPresence);
  useEffect(() => {
    fetchPresenceRef.current = fetchPresence;
  }, [fetchPresence]);

  // Initial presence fetch and polling
  // HTTP polling is skipped when WebSocket presence is active and connected
  useEffect(() => {
    if (!presenceEnabled) return;

    // Skip HTTP polling if WebSocket presence is handling updates
    const shouldSkipPolling = wsPresenceActive && realtime.connected;

    // Initial fetch (only if WS isn't active yet)
    if (!presenceInitializedRef.current && !shouldSkipPolling) {
      presenceInitializedRef.current = true;
      void fetchPresenceRef.current();
    }

    // Set up polling - use ref to avoid restarting interval when callback changes
    // Skip polling when WebSocket is handling presence
    const intervalId = setInterval(() => {
      // Check again at each interval - WS state may have changed
      if (!wsPresenceActive || !realtime.connected) {
        void fetchPresenceRef.current();
      }
    }, presencePollingInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [presenceEnabled, presencePollingInterval, realtime.connected]);

  // Reset presence when disabled
  useEffect(() => {
    if (!presenceEnabled) {
      setPresenceActors([]);
      presenceInitializedRef.current = false;
    }
  }, [presenceEnabled]);

  // Reset WebSocket presence state when disconnected so the UI falls back
  // to HTTP-polled presence data. Without this, wsPresenceActive stays
  // true after disconnect and the UI shows stale WebSocket presence
  // (e.g. an agent that already completed its edit session still appears).
  useEffect(() => {
    if (!realtime.connected) {
      setWsPresenceActive(false);
      setWsPresenceActors([]);
    }
  }, [realtime.connected]);

  // Compute derived presence values
  // Prefer WebSocket presence when connected for instant updates
  const presenceState: PresenceState | null = useMemo(() => {
    if (!presenceEnabled) return null;

    // Use WebSocket presence when active and connected, otherwise fall back to HTTP polling data
    const effectiveActors =
      wsPresenceActive && realtime.connected ? wsPresenceActors : presenceActors;

    const humans = effectiveActors.filter((actor) => actor.role === 'human');
    const agents = effectiveActors.filter((actor) => actor.role === 'agent');
    const hasActiveHumans = humans.some(
      (actor) => actor.state === 'active' || actor.state === 'editing'
    );
    const hasActiveAgents = agents.some(
      (actor) => actor.state === 'active' || actor.state === 'editing'
    );

    return {
      actors: effectiveActors,
      humans,
      agents,
      hasActiveHumans,
      hasActiveAgents,
      refresh: fetchPresence,
    };
  }, [presenceEnabled, presenceActors, wsPresenceActors, wsPresenceActive, realtime.connected, fetchPresence]);

  // Keep presence in a ref so it can be read via getter without triggering
  // context recreation. Presence changes frequently (focus region broadcasts)
  // but shouldn't cause PuckDataSynchronizer or plugin re-renders.
  const presenceStateRef = useRef(presenceState);
  presenceStateRef.current = presenceState;

  // =========================================================================
  // Phase 9: Agent Edit Capabilities (when this client IS an agent)
  // =========================================================================

  const agentEditCapabilities: UseAgentEditReturn | null = useMemo(() => {
    if (!agentModeEnabled || !agentId) return null;

    const documentPath = currentDocument?.path ?? null;

    const canEdit = async (params: {
      trigger: 'human_requested' | 'autonomous';
      intent: string;
      targetRegions: string[];
      requestedById?: string;
    }) => {
      if (!documentPath) {
        throw new Error('No document loaded');
      }
      return userClient.agentEdit.canEdit(siteId, branchId, documentPath, {
        agentId,
        trigger: params.trigger,
        intent: params.intent,
        targetRegions: params.targetRegions,
        requestedById: params.requestedById,
      });
    };

    const startEdit = async (params: {
      trigger: 'human_requested' | 'autonomous';
      intent: string;
      targetRegions: string[];
      requestedById?: string;
    }) => {
      if (!documentPath) {
        throw new Error('No document loaded');
      }
      setAgentEditLoading(true);
      setAgentEditError(null);
      try {
        const session = await userClient.agentEdit.startEdit(siteId, branchId, documentPath, {
          agentId,
          trigger: params.trigger,
          intent: params.intent,
          targetRegions: params.targetRegions,
          requestedById: params.requestedById,
        });
        setAgentSession(session);
        setAgentEditLoading(false);
        return session;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setAgentEditError(e);
        setAgentEditLoading(false);
        throw e;
      }
    };

    const completeEdit = async () => {
      if (!agentSession) {
        throw new Error('No active edit session');
      }
      if (!documentPath) {
        throw new Error('No document loaded');
      }
      setAgentEditLoading(true);
      try {
        await userClient.agentEdit.completeEdit(siteId, branchId, documentPath, agentId);
        setAgentSession(null);
        setAgentEditLoading(false);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setAgentEditError(e);
        setAgentEditLoading(false);
        throw e;
      }
    };

    const abortEdit = async () => {
      if (!agentSession) {
        throw new Error('No active edit session');
      }
      if (!documentPath) {
        throw new Error('No document loaded');
      }
      if (!agentSession.checkpointId) {
        throw new Error('No checkpoint ID in session');
      }
      setAgentEditLoading(true);
      try {
        await userClient.agentEdit.abortEdit(
          siteId,
          branchId,
          documentPath,
          agentId,
          agentSession.checkpointId
        );
        setAgentSession(null);
        setAgentEditLoading(false);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setAgentEditError(e);
        setAgentEditLoading(false);
        throw e;
      }
    };

    return {
      canEdit,
      startEdit,
      completeEdit,
      abortEdit,
      session: agentSession,
      sessionId: agentSession?.sessionId ?? null,
      isEditing: agentSession !== null,
      isLoading: agentEditLoading,
      error: agentEditError,
    };
  }, [
    agentModeEnabled,
    agentId,
    currentDocument,
    siteId,
    branchId,
    userClient,
    agentSession,
    agentEditLoading,
    agentEditError,
  ]);

  // =========================================================================
  // Phase 9: Agent Trigger (for human users to trigger agents)
  // =========================================================================

  const triggerAgentFn: UseAgentTriggerReturn['triggerAgent'] | null = useMemo(() => {
    // Only available when agentModeEnabled but no agentId (human user)
    if (!agentModeEnabled || agentId) return null;

    const documentPath = currentDocument?.path ?? null;

    return async (action: {
      agentId: string;
      intent: string;
      targetRegions: string[];
      operationType?: string;
    }) => {
      if (!documentPath) {
        return { success: false, error: 'No document loaded' };
      }

      try {
        // Check permission
        const permission = await userClient.agentEdit.canEdit(siteId, branchId, documentPath, {
          agentId: action.agentId,
          trigger: 'human_requested',
          intent: action.intent,
          targetRegions: action.targetRegions,
          requestedById: userId,
        });

        if (!permission.allowed) {
          return { success: false, error: permission.reason };
        }

        // Start edit session
        const session = await userClient.agentEdit.startEdit(siteId, branchId, documentPath, {
          agentId: action.agentId,
          trigger: 'human_requested',
          intent: action.intent,
          targetRegions: action.targetRegions,
          requestedById: userId,
        });

        return { success: true, checkpointId: session.checkpointId };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };
  }, [agentModeEnabled, agentId, currentDocument, siteId, branchId, userId, userClient]);

  // =========================================================================
  // Phase 9: Conflict Notifications
  // =========================================================================

  const dismissConflict = useCallback((id: string) => {
    setConflicts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Stop an agent's edit session (human-initiated)
  const handleStopAgent = useCallback(
    async (agent: ActorPresence) => {
      const documentPath = currentDocumentRef.current?.path;
      if (!documentPath) {
        notificationContext.addError('Cannot stop agent: no document loaded');
        return;
      }
      try {
        await userClient.agentEdit.stopAgent(siteId, branchId, documentPath, agent.actorId);
        notificationContext.addSuccess(`Agent "${agent.name}" has been stopped`);
        // Refresh presence to reflect the agent's removal
        if (presenceEnabled) {
          void fetchPresenceRef.current();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notificationContext.addError(`Failed to stop agent: ${message}`);
      }
    },
    [userClient, siteId, branchId, notificationContext, presenceEnabled]
  );

  // Create checkpoint
  const createCheckpoint = useCallback(
    async (name?: string): Promise<Checkpoint> => {
      // Save any pending changes first
      if (pendingDataRef.current) {
        if (enableRealtime && realtimeConnectedRef.current) {
          // Data origin guard: only send if data belongs to current document
          const currentPath = currentDocumentRef.current?.path ?? null;
          if (currentDataDocumentPathRef.current === currentPath) {
            realtime.applyLocalChange(pendingDataRef.current);
          }
          pendingDataRef.current = null;
        } else {
          debouncedSave.cancel();
          await performSave();
        }
      }

      // When realtime is connected, wait for the DO to acknowledge receipt of
      // all preceding WebSocket messages before creating the checkpoint.
      if (enableRealtime && realtimeConnectedRef.current) {
        try {
          await realtime.waitForDelivery();
        } catch {
          console.warn('[CSSPuckProvider] Delivery ack before checkpoint failed, proceeding anyway');
        }
      }

      const checkpoint = await userClient.checkpoints.create(siteId, {
        branchId,
        name,
        type: 'manual',
      });

      return checkpoint;
    },
    [userClient, siteId, branchId, debouncedSave, performSave, enableRealtime, realtime]
  );

  // Publish current document
  const publishDocument = useCallback(
    async (): Promise<Checkpoint> => {
      const doc = currentDocumentRef.current;
      if (!doc) {
        throw new Error('No document loaded to publish');
      }

      // Send any pending changes before publish
      if (pendingDataRef.current) {
        if (enableRealtime && realtimeConnectedRef.current) {
          const currentPath = currentDocumentRef.current?.path ?? null;
          if (currentDataDocumentPathRef.current === currentPath) {
            realtime.applyLocalChange(pendingDataRef.current);
          }
          pendingDataRef.current = null;
        } else {
          debouncedSave.cancel();
          await performSave();
        }
      }

      // When realtime is connected, use WebSocket-driven publish.
      // The DO handles the entire flow: flush CRDT to Postgres, then
      // create the checkpoint. TCP ordering guarantees all preceding
      // binary CRDT updates are processed before the publish_request.
      if (enableRealtime && realtimeConnectedRef.current) {
        const publishResult = await realtime.requestPublish();
        if (!publishResult.success) {
          throw new Error(publishResult.error ?? 'Publish failed');
        }
        if (!publishResult.checkpoint) {
          throw new Error('Publish succeeded but no checkpoint returned');
        }
        return publishResult.checkpoint;
      }

      // Fallback: HTTP publish when realtime is not connected
      const result = await userClient.documents.publish(siteId, branchId, doc.id);
      return result.checkpoint;
    },
    [userClient, siteId, branchId, debouncedSave, performSave, enableRealtime, realtime]
  );

  // Switch branch
  const switchBranch = useCallback(
    async (newBranchId: string) => {
      // Cancel any pending remote sync - we're switching to a different branch
      cancelPendingRemoteSync();

      // Save any pending changes first
      if (pendingDataRef.current) {
        debouncedSave.cancel();
        await performSave();
      }

      // IMPORTANT: Update the ref BEFORE state updates
      viewingVersionRef.current = null;

      setBranchId(newBranchId);
      persistBranchId(newBranchId);
      setCurrentDocument(null);
      currentDataDocumentPathRef.current = null;
      setCurrentData(null);
      setViewingVersion(null);
      // Clear remoteSyncKey so new branch document sync takes priority
      setRemoteSyncKey(null);
      pendingDataRef.current = null;
      setSaveStatus('idle');
      setSaveError(null);

      // Update current branch
      const branch = branches.find((b) => b.id === newBranchId);
      setCurrentBranch(branch ?? null);
    },
    [branches, debouncedSave, performSave, cancelPendingRemoteSync, persistBranchId]
  );

  // Presence context value (for hooks like useFocusRegionReporting)
  const presenceContextValue: PresenceContextValue | null = useMemo(() => {
    if (!presenceEnabled) return null;

    const actors = presenceState?.actors ?? [];
    return {
      client: userClient,
      siteId,
      branchId,
      documentPath: currentDocument?.path ?? null,
      userId,
      currentUserId: userId,
      isConnected: realtime.connected,
      presence: actors,
      actors,
      activeAgents: presenceState?.agents?.filter(a => a.state === 'editing') ?? [],
      agentEditingRegions: presenceState?.agents
        ?.filter(a => a.state === 'editing')
        ?.flatMap(a => a.focusRegions ?? []) ?? [],
      isAgentEditing: presenceState?.hasActiveAgents ?? false,
      // Agent edit functions - placeholder implementations
      // These are handled by agentEditCapabilities in the main context
      canEdit: async () => ({ allowed: true }),
      startEdit: async () => ({ sessionId: '' }),
      completeEdit: async () => ({ success: true }),
      abortEdit: async () => ({ success: true }),
      subscribe: () => () => {},
    };
  }, [
    presenceEnabled,
    userClient,
    siteId,
    branchId,
    currentDocument?.path,
    userId,
    realtime.connected,
    presenceState,
  ]);

  // =========================================================================
  // Stable Callback Wrappers
  // =========================================================================
  // Wrap volatile callbacks in refs + stable wrappers so consumers don't need
  // to stabilize them manually. The ref is updated inline during render (safe
  // because it's a ref write, not a state write) and the stable wrapper
  // delegates to ref.current, ensuring the latest implementation is always used.

  const saveDataRef = useRef(saveData);
  saveDataRef.current = saveData;
  const stableSaveData = useCallback(
    (data: PuckData) => saveDataRef.current(data),
    []
  );

  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;
  const stableSaveNow = useCallback(
    () => saveNowRef.current(),
    []
  );

  const createCheckpointRef = useRef(createCheckpoint);
  createCheckpointRef.current = createCheckpoint;
  const stableCreateCheckpoint = useCallback(
    (name?: string) => createCheckpointRef.current(name),
    []
  );

  const publishDocumentRef = useRef(publishDocument);
  publishDocumentRef.current = publishDocument;
  const stablePublishDocument = useCallback(
    () => publishDocumentRef.current(),
    []
  );

  const pauseAutoSaveRef = useRef(pauseAutoSave);
  pauseAutoSaveRef.current = pauseAutoSave;
  const stablePauseAutoSave = useCallback(
    () => pauseAutoSaveRef.current(),
    []
  );

  const resumeAutoSaveRef = useRef(resumeAutoSave);
  resumeAutoSaveRef.current = resumeAutoSave;
  const stableResumeAutoSave = useCallback(
    () => resumeAutoSaveRef.current(),
    []
  );

  const switchBranchRef = useRef(switchBranch);
  switchBranchRef.current = switchBranch;
  const stableSwitchBranch = useCallback(
    (newBranchId: string) => switchBranchRef.current(newBranchId),
    []
  );

  const loadDocumentRef = useRef(loadDocument);
  loadDocumentRef.current = loadDocument;
  const stableLoadDocument = useCallback(
    (path: string) => loadDocumentRef.current(path),
    []
  );

  const loadVersionRef = useRef(loadVersion);
  loadVersionRef.current = loadVersion;
  const stableLoadVersion = useCallback(
    (version: DocumentVersion) => loadVersionRef.current(version),
    []
  );

  const returnToLatestRef = useRef(returnToLatest);
  returnToLatestRef.current = returnToLatest;
  const stableReturnToLatest = useCallback(
    () => returnToLatestRef.current(),
    []
  );

  const handleStopAgentRef = useRef(handleStopAgent);
  handleStopAgentRef.current = handleStopAgent;
  const stableStopAgent = useCallback(
    (agent: ActorPresence) => handleStopAgentRef.current(agent),
    []
  );

  // =========================================================================
  // Stable Getters (Items 2 & 3)
  // =========================================================================
  // Refs updated inline during render, exposed as stable getter callbacks.

  const saveStatusGetterRef = useRef(saveStatus);
  saveStatusGetterRef.current = saveStatus;
  const getSaveStatus = useCallback(() => saveStatusGetterRef.current, []);

  const lastSavedGetterRef = useRef(lastSaved);
  lastSavedGetterRef.current = lastSaved;
  const getLastSaved = useCallback(() => lastSavedGetterRef.current, []);

  const saveErrorGetterRef = useRef(saveError);
  saveErrorGetterRef.current = saveError;
  const getSaveError = useCallback(() => saveErrorGetterRef.current, []);

  const getHasUnsavedChanges = useCallback(
    () => pendingDataRef.current !== null,
    []
  );

  // Data sync getters (Item 3)
  const currentDataGetterRef = useRef(currentData);
  currentDataGetterRef.current = currentData;
  const remoteSyncKeyGetterRef = useRef(remoteSyncKey);
  remoteSyncKeyGetterRef.current = remoteSyncKey;
  const currentDocumentGetterRef = useRef(currentDocument);
  currentDocumentGetterRef.current = currentDocument;
  const viewingVersionGetterRef = useRef(viewingVersion);
  viewingVersionGetterRef.current = viewingVersion;

  const getSyncData = useCallback(
    (): PuckData | undefined => currentDataGetterRef.current ?? undefined,
    []
  );

  const getDataSyncKey = useCallback((): string | undefined => {
    const syncKey = remoteSyncKeyGetterRef.current;
    const doc = currentDocumentGetterRef.current;
    const version = viewingVersionGetterRef.current;

    if (syncKey) return syncKey;
    if (version) return `version-${version.id}`;
    if (doc) return `doc-${doc.id}-latest`;
    return undefined;
  }, []);

  // =========================================================================
  // Plugin Composition (B.4)
  // =========================================================================

  const resolvedFeatureConfig = useMemo(() => {
    if (featureConfig) return resolveFeatureConfig(featureConfig);
    return resolveFeatureConfig({
      enableRealtime,
      presenceEnabled,
      agentModeEnabled,
    });
  }, [featureConfig, enableRealtime, presenceEnabled, agentModeEnabled]);

  const activePlugins = useMemo(() => {
    const plugins = featurePlugins ?? DEFAULT_CSS_FEATURE_PLUGINS;
    return resolveActivePlugins(plugins, resolvedFeatureConfig);
  }, [featurePlugins, resolvedFeatureConfig]);

  const pluginDeps: CSSFeaturePluginDeps = useMemo(() => ({
    client: userClient,
    siteId,
    branchId,
    userId,
    config: resolvedFeatureConfig,
  }), [userClient, siteId, branchId, userId, resolvedFeatureConfig]);

  const ComposedPluginProviders = useMemo(
    () => composeProviders(activePlugins, resolvedFeatureConfig, pluginDeps),
    [activePlugins, resolvedFeatureConfig, pluginDeps],
  );

  // =========================================================================
  // safeData (Item 4) — never null
  // =========================================================================

  const EMPTY_PUCK_DATA: PuckData = useMemo(
    () => ({ content: [], root: { props: {} } }),
    []
  );

  const lastGoodDataRef = useRef<PuckData>(EMPTY_PUCK_DATA);
  if (currentDocument && currentData) {
    lastGoodDataRef.current = currentData;
  }
  const safeData = lastGoodDataRef.current;

  // Context value
  const contextValue: CSSPuckContextValue = useMemo(
    () => ({
      client: userClient,
      notifications: notificationContext,
      siteId,
      siteName,
      branchId,
      userId,
      currentDocument,
      currentData,
      saveStatus,
      lastSaved,
      saveError,
      loadDocument: stableLoadDocument,
      saveData: stableSaveData,
      saveNow: stableSaveNow,
      createCheckpoint: stableCreateCheckpoint,
      publishDocument: stablePublishDocument,
      switchBranch: stableSwitchBranch,
      // Stable getters (Items 2, 3)
      getSaveStatus,
      getLastSaved,
      getSaveError,
      getHasUnsavedChanges,
      getSyncData,
      getDataSyncKey,
      // safeData (Item 4)
      safeData,
      // Documents (Item 8)
      documents: branchDocuments,
      documentsLoading,
      createDocument: stableCreateDocument,
      deleteDocument: stableDeleteDocument,
      branches,
      currentBranch,
      refreshBranches,
      createBranch,
      branchesLoading,
      autoSavePaused,
      pauseAutoSave: stablePauseAutoSave,
      resumeAutoSave: stableResumeAutoSave,
      viewingVersion,
      latestVersionData,
      isViewingHistoricalVersion,
      loadVersion: stableLoadVersion,
      returnToLatest: stableReturnToLatest,
      realtimeEnabled: enableRealtime,
      realtimeConnected: realtime.connected,
      remoteSyncKey,
      // WebSocket presence - send focus regions via WebSocket when connected
      sendFocusRegions: realtime.sendFocusRegions,
      // Puck action metadata capture - pass as onAction to <Puck>
      handleAction,
      // Phase 9: Presence & Agent values
      // Use getter to avoid context recreation on every focus-region update.
      // Expose humanPresenceCount/hasActiveHumans/hasActiveAgents directly so every
      // join/leave triggers context re-renders and causes consumers to re-invoke the getter.
      get presence() { return presenceStateRef.current; },
      hasActiveHumans: presenceState?.hasActiveHumans ?? false,
      humanPresenceCount: presenceState?.humans.length ?? 0,
      hasActiveAgents: presenceState?.hasActiveAgents ?? false,
      agentEdit: agentEditCapabilities,
      triggerAgent: triggerAgentFn,
      stopAgent: stableStopAgent,
      conflicts,
      dismissConflict,
      // Feature configuration (Phase B.5)
      featureConfig: resolvedFeatureConfig,
      // Internal: realtime data capture for catch-up (sends missed keystrokes)
      _realtimeDataCaptureRef: enableRealtime ? realtimeDataCaptureRef : null,
      _onRealtimeDataCapture: enableRealtime ? handleRealtimeDataCapture : null,
    }),
    [
      userClient,
      notificationContext,
      siteId,
      branchId,
      userId,
      currentDocument,
      currentData,
      saveStatus,
      lastSaved,
      saveError,
      stableLoadDocument,
      stableSaveData,
      stableSaveNow,
      stableCreateCheckpoint,
      stablePublishDocument,
      stableSwitchBranch,
      getSaveStatus,
      getLastSaved,
      getSaveError,
      getHasUnsavedChanges,
      getSyncData,
      getDataSyncKey,
      safeData,
      branchDocuments,
      documentsLoading,
      stableCreateDocument,
      stableDeleteDocument,
      branches,
      currentBranch,
      refreshBranches,
      branchesLoading,
      autoSavePaused,
      stablePauseAutoSave,
      stableResumeAutoSave,
      viewingVersion,
      latestVersionData,
      isViewingHistoricalVersion,
      stableLoadVersion,
      stableReturnToLatest,
      enableRealtime,
      realtime.connected,
      remoteSyncKey,
      realtime.sendFocusRegions,
      handleAction,
      handleRealtimeDataCapture,
      // Phase 9 dependencies (full presenceState excluded — accessed via getter/ref,
      // but humanPresenceCount/hasActiveHumans/hasActiveAgents are direct values so every
      // join/leave triggers re-renders regardless of how many actors are present)
      presenceState?.humans.length,
      presenceState?.hasActiveHumans,
      presenceState?.hasActiveAgents,
      agentEditCapabilities,
      triggerAgentFn,
      stableStopAgent,
      conflicts,
      dismissConflict,
      enableRealtime,
      resolvedFeatureConfig,
    ]
  );

  // Wrap with PresenceContext.Provider when presence is enabled
  const wrappedChildren = presenceContextValue ? (
    <PresenceContext.Provider value={presenceContextValue}>
      {children}
    </PresenceContext.Provider>
  ) : (
    children
  );

  return (
    <CSSPuckContext.Provider value={contextValue}>
      <ComposedPluginProviders>
        {wrappedChildren}
      </ComposedPluginProviders>
    </CSSPuckContext.Provider>
  );
}
