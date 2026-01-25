/**
 * CSS Puck Provider
 *
 * React context provider for CSS Puck integration.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Document, PuckData, Checkpoint, Branch, DocumentVersion } from '@pantheon/css-client';
import type { CSSPuckConfig, CSSPuckContextValue, SaveStatus } from './types.js';
import { CSSPuckContext } from './CSSPuckContext.js';
import { debounce } from './utils/debounce.js';
import { withRetry } from './utils/retry.js';

interface CSSPuckProviderProps extends CSSPuckConfig {
  children: React.ReactNode;
}

/**
 * Provider component for CSS Puck integration.
 *
 * Wraps your Puck editor to provide CSS functionality including:
 * - Auto-save with debouncing
 * - Document loading
 * - Checkpoint (publish) creation
 * - Branch switching
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
export function CSSPuckProvider({
  client,
  siteId,
  branchId: initialBranchId,
  userId,
  autoSaveDelay = 3000,
  maxRetries = 3,
  children,
}: CSSPuckProviderProps): React.ReactElement {
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

  // Keep refs in sync with state
  useEffect(() => {
    currentDocumentRef.current = currentDocument;
  }, [currentDocument]);

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

      setCurrentData(dataToSave);
      pendingDataRef.current = null;
      setSaveStatus('saved');
      setLastSaved(new Date());
    } catch (error) {
      setSaveStatus('error');
      setSaveError(error instanceof Error ? error : new Error(String(error)));
    }
  }, [userClient, siteId, branchId, maxRetries]);

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
  const saveData = useCallback(
    (data: PuckData) => {
      pendingDataRef.current = data;
      // Resume on next edit if paused
      if (debouncedSave.isPaused()) {
        debouncedSave.resume();
        setAutoSavePaused(false);
      }
      debouncedSave();
    },
    [debouncedSave]
  );

  // Force immediate save
  const saveNow = useCallback(async () => {
    debouncedSave.cancel();
    await performSave();
  }, [debouncedSave, performSave]);

  // Load document by path
  const loadDocument = useCallback(
    async (path: string) => {
      try {
        // Normalize path: strip leading slash if present
        const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

        // Get document by path
        const doc = await userClient.documents.getByPath(siteId, normalizedPath);
        setCurrentDocument(doc);

        // Get latest version
        const version = await userClient.versions.getLatest(siteId, branchId, doc.id);
        const puckData = version.snapshot as unknown as PuckData;
        setCurrentData(puckData);
        setLatestVersionData(puckData);
        setViewingVersion(null);
        pendingDataRef.current = null;
        setSaveStatus('idle');
        setSaveError(null);
      } catch (error) {
        console.error('Failed to load document:', error);
        throw error;
      }
    },
    [userClient, siteId, branchId]
  );

  // Load a specific version into the editor
  const loadVersion = useCallback(
    async (version: DocumentVersion) => {
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

        const puckData = versionToUse.snapshot as unknown as PuckData;

        // Validate that we have actual data to display
        if (!puckData || (!puckData.content && !puckData.root)) {
          throw new Error('Version snapshot is empty or invalid');
        }

        setCurrentData(puckData);
        setViewingVersion(versionToUse);
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
    [userClient, siteId, branchId, debouncedSave]
  );

  // Return to the latest version
  const returnToLatest = useCallback(async () => {
    if (latestVersionData) {
      setCurrentData(latestVersionData);
      setViewingVersion(null);
      // Resume auto-save
      debouncedSave.resume();
      setAutoSavePaused(false);
      pendingDataRef.current = null;
      setSaveStatus('idle');
    }
  }, [latestVersionData, debouncedSave]);

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
      // Save any pending changes first
      if (pendingDataRef.current) {
        debouncedSave.cancel();
        await performSave();
      }

      setBranchId(newBranchId);
      setCurrentDocument(null);
      setCurrentData(null);
      pendingDataRef.current = null;
      setSaveStatus('idle');
      setSaveError(null);

      // Update current branch
      const branch = branches.find((b) => b.id === newBranchId);
      setCurrentBranch(branch ?? null);
    },
    [branches, debouncedSave, performSave]
  );

  // Context value
  const contextValue: CSSPuckContextValue = useMemo(
    () => ({
      client: userClient,
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
    }),
    [
      userClient,
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
    ]
  );

  return <CSSPuckContext.Provider value={contextValue}>{children}</CSSPuckContext.Provider>;
}
