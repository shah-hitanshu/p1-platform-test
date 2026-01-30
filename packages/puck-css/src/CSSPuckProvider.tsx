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
} from '@pantheon/css-client';
import type { CSSPuckConfig, CSSPuckContextValue, SaveStatus, PresenceState } from './types.js';
import { CSSPuckContext } from './CSSPuckContext.js';
import { NotificationProvider, useNotifications } from './NotificationContext.js';
import { PresenceContext } from './PresenceContext.js';
import type { PresenceContextValue } from './PresenceContext.js';
import { debounce } from './utils/debounce.js';
import { withRetry } from './utils/retry.js';
import { useRealtime } from './hooks/useRealtime.js';
import type { UseAgentEditReturn } from './hooks/useAgentEdit.js';
import type { UseAgentTriggerReturn } from './hooks/useAgentTrigger.js';
import type { ConflictNotification } from './components/conflict-notifications/index.js';

interface CSSPuckProviderProps extends CSSPuckConfig {
  children: React.ReactNode;
  /**
   * Whether to show error notifications automatically.
   * @default true
   */
  showErrorNotifications?: boolean;
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
 * import { CSSPuckProvider, CSSPuckEditor } from '@pantheon/puck-css';
 * import { CSSClient } from '@pantheon/css-client';
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
  enableRealtime = false,
  wsBaseUrl,
  realtimeApiKey,
  // Phase 9: Presence props
  presenceEnabled = false,
  presencePollingInterval = 5000,
  userName: _userName,
  userAvatar: _userAvatar,
  // Phase 9: Agent mode props
  agentModeEnabled = false,
  agentId,
  agentTrigger: _agentTrigger,
  // Phase 9: Callbacks
  onPresenceChange,
  onAgentConflict: _onAgentConflict,
  children,
}: CSSPuckProviderProps): React.ReactElement {
  // Access notification context
  const notificationContext = useNotifications();
  // Branch state - start with initialBranchId or empty (will be set to main)
  const [branchId, setBranchId] = useState(initialBranchId ?? '');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(!initialBranchId);

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
  const isApplyingRemoteSyncRef = useRef(false);

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
  const wsPresenceActiveRef = useRef(false);

  // Real-time collaboration hook
  const realtime = useRealtime({
    baseUrl: wsBaseUrl ?? '',
    apiKey: realtimeApiKey,
    siteId,
    branchId,
    documentPath: currentDocument?.path ?? null,
    actorId: userId,
    actorType: 'user',
    enabled: enableRealtime && !!wsBaseUrl,
    // WebSocket presence callbacks - receive instant presence updates
    onPresenceUpdate: (actors) => {
      // Mark WebSocket presence as active
      wsPresenceActiveRef.current = true;
      // Filter out self and update state
      const filtered = actors.filter((a) => a.actorId !== userId);
      setWsPresenceActors(filtered);
    },
    onFocusRegionBroadcast: (actorId, focusRegions) => {
      // Update focus regions for the specific actor
      setWsPresenceActors((prev) =>
        prev.map((a) => (a.actorId === actorId ? { ...a, focusRegions } : a))
      );
    },
    onRemoteUpdate: (data) => {
      // Don't apply remote updates while viewing a historical version
      // The user is viewing read-only historical data and shouldn't see live changes
      if (viewingVersionRef.current !== null) {
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
          // Set flag to indicate we're applying a remote sync.
          // All onChange events during this period should be skipped to prevent
          // the receiving client from echoing updates back to the sender.
          // There may be multiple onChange events (from data prop change and setData dispatch).
          isApplyingRemoteSyncRef.current = true;

          // Also increment counter as backup (for returnToLatest and other paths)
          pendingRemoteUpdatesRef.current += 1;

          // Update current data when remote changes arrive
          setCurrentData(dataToSync);
          // Update sync key to trigger Puck re-sync
          setRemoteSyncKey(`remote-${Date.now()}`);

          pendingRemoteDataRef.current = null;

          // Clear the flag after a short delay to ensure all onChange events are captured.
          // React may batch state updates and fire onChange asynchronously.
          // 100ms should be enough for React to process the state changes.
          setTimeout(() => {
            isApplyingRemoteSyncRef.current = false;
          }, 100);
        }
        remoteSyncTimerRef.current = null;
      }, REMOTE_SYNC_DEBOUNCE_DELAY);
    },
  });

  // Cleanup remote sync timer on unmount
  useEffect(() => {
    return () => {
      if (remoteSyncTimerRef.current) {
        clearTimeout(remoteSyncTimerRef.current);
      }
    };
  }, []);

  // Keep refs in sync with state
  useEffect(() => {
    currentDocumentRef.current = currentDocument;
  }, [currentDocument]);

  useEffect(() => {
    viewingVersionRef.current = viewingVersion;
  }, [viewingVersion]);

  // Create client with user principal
  const userClient = useMemo(
    () => client.withPrincipal({ id: userId, type: 'user' }),
    [client, userId]
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

        // If no branchId set, default to main branch
        if (!effectiveBranchId) {
          const mainBranch = branchList.find((b) => b.isMain);
          if (mainBranch) {
            effectiveBranchId = mainBranch.id;
          }
        }

        const current = branchList.find((b) => b.id === effectiveBranchId);
        setCurrentBranch(current ?? null);

        return effectiveBranchId;
      });
    } catch (error) {
      console.error('Failed to load branches:', error);
    } finally {
      setBranchesLoading(false);
    }
  }, [userClient, siteId]);

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
  }, [userClient, siteId, branchId, maxRetries, showErrorNotifications, notificationContext]);

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

  // Public save function (triggers debounce)
  // Also resumes auto-save if paused, per user requirement
  // Sends changes via WebSocket when realtime is enabled (but not for remote updates)
  const saveData = useCallback(
    (data: PuckData) => {
      pendingDataRef.current = data;
      // Resume on next edit if paused
      if (debouncedSave.isPaused()) {
        debouncedSave.resume();
        setAutoSavePaused(false);
      }
      debouncedSave();

      // Send changes via WebSocket for real-time collaboration
      // Skip if:
      // 1. We're currently applying a remote sync (flag-based, prevents bounce-back loop)
      // 2. This change originated from a remote update counter (backup check)
      // 3. We're viewing a historical version (prevents broadcasting historical data)
      if (enableRealtime && realtime.connected) {
        if (isApplyingRemoteSyncRef.current) {
          // We're in the middle of applying a remote sync, skip to prevent echo
          // Decrement counter if it was incremented (for cleanup)
          if (pendingRemoteUpdatesRef.current > 0) {
            pendingRemoteUpdatesRef.current -= 1;
          }
        } else if (pendingRemoteUpdatesRef.current > 0) {
          // Backup: counter indicates this onChange is from a recent remote update
          pendingRemoteUpdatesRef.current -= 1;
        } else if (viewingVersionRef.current !== null) {
          // User is viewing historical version - don't broadcast historical data
          // This prevents other users from seeing historical content
        } else {
          realtime.applyLocalChange(data);
        }
      }
    },
    [debouncedSave, enableRealtime, realtime]
  );

  // Force immediate save
  const saveNow = useCallback(async () => {
    debouncedSave.cancel();
    await performSave();
  }, [debouncedSave, performSave]);

  // Load document by path
  const loadDocument = useCallback(
    async (path: string) => {
      // Cancel any pending remote sync to prevent race conditions
      // where a stale remote update overrides the document we're loading
      cancelPendingRemoteSync();

      try {
        // Normalize path: strip leading slash if present
        const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

        // Get document by path
        const doc = await userClient.documents.getByPath(siteId, normalizedPath);
        setCurrentDocument(doc);

        // Get latest version
        const version = await userClient.versions.getLatest(siteId, branchId, doc.id);
        const puckData = version.snapshot as unknown as PuckData;

        // IMPORTANT: Update the ref BEFORE state updates
        // Setting to null allows remote updates after document loads
        viewingVersionRef.current = null;

        setCurrentData(puckData);
        setLatestVersionData(puckData);
        setViewingVersion(null);
        // Clear remoteSyncKey so document sync takes priority
        setRemoteSyncKey(null);
        pendingDataRef.current = null;
        setSaveStatus('idle');
        setSaveError(null);
      } catch (error) {
        console.error('Failed to load document:', error);
        throw error;
      }
    },
    [userClient, siteId, branchId, cancelPendingRemoteSync]
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

      // Filter out self
      const filteredActors = branchPresence.actors.filter(
        (actor) => actor.actorId !== userId
      );

      setPresenceActors(filteredActors);

      // Call onPresenceChange if actors changed
      if (onPresenceChange) {
        const actorsChanged =
          JSON.stringify(filteredActors.map((a) => a.id).sort()) !==
          JSON.stringify(prevActorsRef.current.map((a) => a.id).sort());
        if (actorsChanged) {
          onPresenceChange(filteredActors);
          prevActorsRef.current = filteredActors;
        }
      }
    } catch (error) {
      console.error('Failed to fetch presence:', error);
    }
  }, [presenceEnabled, branchId, siteId, userId, userClient, onPresenceChange]);

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
    const shouldSkipPolling = wsPresenceActiveRef.current && realtime.connected;

    // Initial fetch (only if WS isn't active yet)
    if (!presenceInitializedRef.current && !shouldSkipPolling) {
      presenceInitializedRef.current = true;
      void fetchPresenceRef.current();
    }

    // Set up polling - use ref to avoid restarting interval when callback changes
    // Skip polling when WebSocket is handling presence
    const intervalId = setInterval(() => {
      // Check again at each interval - WS state may have changed
      if (!wsPresenceActiveRef.current || !realtime.connected) {
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

  // Compute derived presence values
  // Prefer WebSocket presence when connected for instant updates
  const presenceState: PresenceState | null = useMemo(() => {
    if (!presenceEnabled) return null;

    // Use WebSocket presence when active and connected, otherwise fall back to HTTP polling data
    const effectiveActors =
      wsPresenceActiveRef.current && realtime.connected ? wsPresenceActors : presenceActors;

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
  }, [presenceEnabled, presenceActors, wsPresenceActors, realtime.connected, fetchPresence]);

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

  // Create checkpoint
  const createCheckpoint = useCallback(
    async (name?: string): Promise<Checkpoint> => {
      // Save any pending changes first
      if (pendingDataRef.current) {
        debouncedSave.cancel();
        await performSave();
      }

      const checkpoint = await userClient.checkpoints.create(siteId, {
        branchId,
        name,
        type: 'manual',
      });

      return checkpoint;
    },
    [userClient, siteId, branchId, debouncedSave, performSave]
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
      setCurrentDocument(null);
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
    [branches, debouncedSave, performSave, cancelPendingRemoteSync]
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

  // Context value
  const contextValue: CSSPuckContextValue = useMemo(
    () => ({
      client: userClient,
      notifications: notificationContext,
      siteId,
      branchId,
      userId,
      currentDocument,
      currentData,
      saveStatus,
      lastSaved,
      saveError,
      loadDocument,
      saveData,
      saveNow,
      createCheckpoint,
      switchBranch,
      branches,
      currentBranch,
      refreshBranches,
      branchesLoading,
      autoSavePaused,
      pauseAutoSave,
      resumeAutoSave,
      viewingVersion,
      latestVersionData,
      isViewingHistoricalVersion,
      loadVersion,
      returnToLatest,
      realtimeEnabled: enableRealtime,
      realtimeConnected: realtime.connected,
      remoteSyncKey,
      // WebSocket presence - send focus regions via WebSocket when connected
      sendFocusRegions: realtime.sendFocusRegions,
      // Phase 9: Presence & Agent values
      presence: presenceState,
      agentEdit: agentEditCapabilities,
      triggerAgent: triggerAgentFn,
      conflicts,
      dismissConflict,
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
      loadDocument,
      saveData,
      saveNow,
      createCheckpoint,
      switchBranch,
      branches,
      currentBranch,
      refreshBranches,
      branchesLoading,
      autoSavePaused,
      pauseAutoSave,
      resumeAutoSave,
      viewingVersion,
      latestVersionData,
      isViewingHistoricalVersion,
      loadVersion,
      returnToLatest,
      enableRealtime,
      realtime.connected,
      remoteSyncKey,
      realtime.sendFocusRegions,
      // Phase 9 dependencies
      presenceState,
      agentEditCapabilities,
      triggerAgentFn,
      conflicts,
      dismissConflict,
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

  return <CSSPuckContext.Provider value={contextValue}>{wrappedChildren}</CSSPuckContext.Provider>;
}
