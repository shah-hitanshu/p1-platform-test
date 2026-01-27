/**
 * CSS Puck Provider
 *
 * React context provider for CSS Puck integration.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Document, PuckData, Checkpoint, Branch, DocumentVersion } from '@pantheon/css-client';
import type { CSSPuckConfig, CSSPuckContextValue, SaveStatus } from './types.js';
import { CSSPuckContext } from './CSSPuckContext.js';
import { NotificationProvider, useNotifications } from './NotificationContext.js';
import { debounce } from './utils/debounce.js';
import { withRetry } from './utils/retry.js';
import { useRealtime } from './hooks/useRealtime.js';

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
          // Increment counter - we expect one onChange callback from Puck after setData
          pendingRemoteUpdatesRef.current += 1;

          // Update current data when remote changes arrive
          setCurrentData(dataToSync);
          // Update sync key to trigger Puck re-sync
          setRemoteSyncKey(`remote-${Date.now()}`);

          pendingRemoteDataRef.current = null;
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
      // Skip if this change originated from a remote update (prevents bounce-back loop)
      if (enableRealtime && realtime.connected) {
        if (pendingRemoteUpdatesRef.current > 0) {
          // This onChange is from a remote update we just synced to Puck, skip sending
          pendingRemoteUpdatesRef.current -= 1;
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

    if (latestVersionData) {
      // IMPORTANT: Update the ref BEFORE state updates
      // Setting to null allows remote updates to resume
      viewingVersionRef.current = null;

      setCurrentData(latestVersionData);
      setViewingVersion(null);
      // Clear remoteSyncKey so latest version sync takes priority
      setRemoteSyncKey(null);
      // Resume auto-save
      debouncedSave.resume();
      setAutoSavePaused(false);
      pendingDataRef.current = null;
      setSaveStatus('idle');
    }
  }, [latestVersionData, debouncedSave, cancelPendingRemoteSync]);

  // Computed property for whether viewing historical version
  const isViewingHistoricalVersion = viewingVersion !== null;

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
    ]
  );

  return <CSSPuckContext.Provider value={contextValue}>{children}</CSSPuckContext.Provider>;
}
