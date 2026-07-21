/**
 * useMergeResolution Hook
 *
 * Central state machine for multi-document merge conflict resolution.
 * Manages document list, per-document strategy selection, cherry-pick
 * state, CRDT preview fetching, navigation, and merge execution.
 */

import { useState, useCallback, useMemo } from 'react';
import type { P1Client, PuckData, DocumentConflictType, MergePreview, MergeRequest, MergeRequestStatus } from '@pantheon-systems/css-client';
import {
  classifyPuckFields,
  buildMergedSnapshot,
} from './utils/puckFieldClassifier.js';
import type { PuckFieldClassification } from './utils/puckFieldClassifier.js';

// =============================================================================
// Types
// =============================================================================

export type DocumentResolutionStrategy =
  | 'accept-draft'
  | 'accept-live'
  | 'cherry-pick'
  | 'unresolved';

/** How this document changed in the merge */
export type DocumentChangeType =
  | 'new-on-draft'       // New doc created on Draft, doesn't exist on Live
  | 'draft-changed'      // Doc edited on Draft, Live version is older than branch point
  | 'conflicting'        // Both branches edited the doc (Live version newer than branch point)
  | 'deleted-on-draft'   // Doc deleted on Draft, still exists on Live
  | 'deleted-on-main';   // Doc deleted on Live, still exists on Draft (needs resolution)

export interface DocumentResolution {
  documentId: string;
  documentPath: string;
  strategy: DocumentResolutionStrategy;
  /** How this document changed in the merge */
  changeType: DocumentChangeType;
  cherryPickSelections: Record<string, 'source' | 'target'>;
  mergedSnapshot: PuckData | null;
  sourceSnapshot: PuckData | null;
  targetSnapshot: PuckData | null;
  conflictType: DocumentConflictType;
  classifiedFields: PuckFieldClassification[] | null;
}

export interface UseMergeResolutionOptions {
  client: P1Client;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  sourceBranchName: string;
  targetBranchName: string;
}

export interface UseMergeResolutionReturn {
  documents: DocumentResolution[];
  currentIndex: number;
  currentDocument: DocumentResolution | null;
  totalCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  allResolved: boolean;

  previewLoading: boolean;
  previewError: string | null;
  mergeExecuting: boolean;
  mergeError: string | null;
  mergeSuccess: boolean;

  mergeRequest: MergeRequest | null;
  mergeRequestCreating: boolean;
  mergeRequestError: string | null;

  createMergeRequest: (title?: string) => Promise<void>;
  approveMergeRequest: () => Promise<void>;

  goToDocument: (index: number) => void;
  goToNext: () => void;
  goToPrevious: () => void;
  goToNextUnresolved: () => void;

  setStrategy: (documentId: string, strategy: DocumentResolutionStrategy) => void;
  setAllStrategy: (strategy: 'accept-draft' | 'accept-live') => void;
  setRemainingStrategy: (strategy: 'accept-draft' | 'accept-live') => void;

  setCherryPickSelection: (
    documentId: string,
    componentId: string,
    propName: string,
    choice: 'source' | 'target'
  ) => void;
  acceptAllComponentProps: (
    documentId: string,
    componentId: string,
    choice: 'source' | 'target'
  ) => void;

  executeMerge: (message?: string) => Promise<void>;
  loadPreview: () => Promise<void>;
}

// =============================================================================
// Helper: determine if a conflict type allows cherry-pick / CRDT
// =============================================================================

function isDeleteConflict(conflictType: DocumentConflictType): boolean {
  return conflictType === 'deleted-in-source' || conflictType === 'deleted-in-target';
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useMergeResolution(
  options: UseMergeResolutionOptions
): UseMergeResolutionReturn {
  const { client, siteId, sourceBranchId, targetBranchId } = options;

  const [documents, setDocuments] = useState<DocumentResolution[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mergeExecuting, setMergeExecuting] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeSuccess, setMergeSuccess] = useState(false);

  const [mergeRequest, setMergeRequest] = useState<MergeRequest | null>(null);
  const [mergeRequestCreating, setMergeRequestCreating] = useState(false);
  const [mergeRequestError, setMergeRequestError] = useState<string | null>(null);

  // Derived state
  const currentDocument = useMemo(
    () => documents[currentIndex] ?? null,
    [documents, currentIndex]
  );

  const totalCount = documents.length;

  const resolvedCount = useMemo(
    () => documents.filter((d) => d.strategy !== 'unresolved').length,
    [documents]
  );

  const unresolvedCount = useMemo(
    () => documents.filter((d) => d.strategy === 'unresolved').length,
    [documents]
  );

  const allResolved = useMemo(
    () => documents.length > 0 && unresolvedCount === 0,
    [documents.length, unresolvedCount]
  );

  // =========================================================================
  // Load preview
  // =========================================================================

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const preview: MergePreview = await client.merge.preview(
        siteId,
        sourceBranchId,
        targetBranchId,
        { includeContent: true, excludePathPrefixes: ['_registry/'] }
      );

      // Build conflict set for quick lookup
      const conflictDocIds = new Set(
        preview.conflicts.documentConflicts.map((c) => c.documentId)
      );
      const conflictMap = new Map(
        preview.conflicts.documentConflicts.map((c) => [c.documentId, c])
      );

      // Build source and target change sets
      const sourceChangeMap = new Map(
        preview.sourceChanges.map((c) => [c.documentId, c])
      );
      const targetChangeMap = new Map(
        preview.targetChanges.map((c) => [c.documentId, c])
      );

      // Build diff map for quick lookup
      const diffMap = new Map(
        (preview.documentDiffs ?? []).map((d) => [d.documentId, d])
      );

      // Collect document IDs from conflicts and source (Draft) changes only.
      // Target-only changes are already on Live and are not part of the merge.
      const allDocIds = new Set<string>();
      for (const c of preview.conflicts.documentConflicts) {
        allDocIds.add(c.documentId);
      }
      for (const sc of preview.sourceChanges) {
        allDocIds.add(sc.documentId);
      }

      // Fetch snapshots for non-conflicting documents in parallel
      const snapshotFetches = new Map<string, Promise<{ source: PuckData | null; target: PuckData | null }>>();

      for (const docId of allDocIds) {
        // Skip fetching only when the conflict diff already has both snapshots.
        // When a snapshot is missing from the diff (backend may return null for
        // targetSnapshot even for both-modified conflicts), fall through so we
        // can fetch it via getLatest as a fallback.
        if (conflictDocIds.has(docId) && diffMap.has(docId)) {
          const d = diffMap.get(docId);
          if (d?.sourceSnapshot && d.targetSnapshot) {
            continue;
          }
        }

        // For non-conflicting docs (and conflicting docs with incomplete diff
        // snapshots), fetch snapshots via versions API.
        // Always try both branches — a doc may exist on the other branch
        // via COW inheritance even if it wasn't changed there.
        snapshotFetches.set(docId, (async () => {
          const results = await Promise.allSettled([
            client.versions.getLatest(siteId, sourceBranchId, docId),
            client.versions.getLatest(siteId, targetBranchId, docId),
          ]);

          const sourceResult = results[0];
          const targetResult = results[1];

          return {
            source: sourceResult.status === 'fulfilled'
              ? (sourceResult.value.snapshot as unknown as PuckData)
              : null,
            target: targetResult.status === 'fulfilled'
              ? (targetResult.value.snapshot as unknown as PuckData)
              : null,
          };
        })());
      }

      // Wait for all snapshot fetches
      const fetchedSnapshots = new Map<string, { source: PuckData | null; target: PuckData | null }>();
      for (const [docId, fetchPromise] of snapshotFetches) {
        try {
          fetchedSnapshots.set(docId, await fetchPromise);
        } catch {
          fetchedSnapshots.set(docId, { source: null, target: null });
        }
      }

      // Build document resolutions for all documents
      const docs: DocumentResolution[] = [];

      for (const docId of allDocIds) {
        const conflict = conflictMap.get(docId);
        const diff = diffMap.get(docId);
        const inSource = sourceChangeMap.has(docId);
        const inTarget = targetChangeMap.has(docId);
        const isConflicting = conflictDocIds.has(docId);

        // Determine change path info
        const docPath = conflict?.documentPath
          ?? diff?.documentPath
          ?? sourceChangeMap.get(docId)?.documentPath
          ?? targetChangeMap.get(docId)?.documentPath
          ?? docId;

        // Determine changeType, strategy, and conflictType
        let changeType: DocumentChangeType;
        let strategy: DocumentResolutionStrategy;
        let conflictType: DocumentConflictType;

        if (isConflicting) {
          if (conflict?.conflictType === 'deleted-in-target') {
            changeType = 'deleted-on-main';
          } else {
            changeType = 'conflicting';
          }
          strategy = 'unresolved';
          conflictType = conflict?.conflictType ?? 'both-modified';
        } else if (inSource && !inTarget) {
          const sourceChange = sourceChangeMap.get(docId);
          const snapshots = fetchedSnapshots.get(docId);

          if (sourceChange?.isDeleted) {
            // State 5: Document deleted on Draft
            changeType = 'deleted-on-draft';
            strategy = 'accept-draft'; // Will delete on merge
          } else if (snapshots?.target === null) {
            // State 1: New document on Draft, doesn't exist on Live
            changeType = 'new-on-draft';
            strategy = 'accept-draft';
          } else {
            // State 3: Document changed on Draft, Live version is older
            changeType = 'draft-changed';
            strategy = 'accept-draft';
          }
          conflictType = 'both-modified'; // Not actually a conflict
        } else {
          // In both sourceChanges and targetChanges but not in conflicts
          // (shouldn't normally happen, but handle gracefully as a source change)
          changeType = 'draft-changed';
          strategy = 'accept-draft';
          conflictType = 'both-modified';
        }

        // Get snapshots
        let sourceSnapshot: PuckData | null = null;
        let targetSnapshot: PuckData | null = null;

        if (isConflicting && diff) {
          // Use snapshots from documentDiffs for conflicting docs
          sourceSnapshot = (diff.sourceSnapshot as unknown as PuckData) ?? null;
          targetSnapshot = (diff.targetSnapshot as unknown as PuckData) ?? null;
          // Fall back to separately-fetched snapshots when the conflict diff is
          // missing one (backend may return null targetSnapshot even for
          // both-modified conflicts when the version isn't directly accessible).
          const fetched = fetchedSnapshots.get(docId);
          if (fetched) {
            if (!sourceSnapshot) sourceSnapshot = fetched.source;
            if (!targetSnapshot) targetSnapshot = fetched.target;
          }
        } else {
          // Use fetched snapshots for non-conflicting docs
          const snapshots = fetchedSnapshots.get(docId);
          if (snapshots) {
            sourceSnapshot = snapshots.source;
            targetSnapshot = snapshots.target;
          }
        }

        // Skip conflicts where source and target content is identical —
        // no user action needed, the merge can proceed with either version.
        if (
          isConflicting &&
          sourceSnapshot &&
          targetSnapshot &&
          JSON.stringify(sourceSnapshot) === JSON.stringify(targetSnapshot)
        ) {
          continue;
        }

        // Skip internal component registry documents — these are managed
        // automatically by useComponentRegistry and must not appear in
        // the merge resolution UI.
        if (docPath.startsWith('_registry/')) {
          continue;
        }

        docs.push({
          documentId: docId,
          documentPath: docPath,
          strategy,
          changeType,
          cherryPickSelections: {},
          mergedSnapshot: null,
          sourceSnapshot,
          targetSnapshot,
          conflictType,
          classifiedFields: null,
        });
      }

      // Sort: conflicting first, then deleted-on-main, new, changed, deleted-on-draft
      const changeTypeOrder: Record<DocumentChangeType, number> = {
        conflicting: 0,
        'deleted-on-main': 1,
        'new-on-draft': 2,
        'draft-changed': 3,
        'deleted-on-draft': 4,
      };
      docs.sort((a, b) => changeTypeOrder[a.changeType] - changeTypeOrder[b.changeType]);

      setDocuments(docs);
      setCurrentIndex(0);
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : 'Failed to load merge preview'
      );
      setDocuments([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [client, siteId, sourceBranchId, targetBranchId]);

  // =========================================================================
  // Navigation
  // =========================================================================

  const goToDocument = useCallback(
    (index: number) => {
      if (index >= 0 && index < documents.length) {
        setCurrentIndex(index);
      }
    },
    [documents.length]
  );

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, documents.length - 1));
  }, [documents.length]);

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const goToNextUnresolved = useCallback(() => {
    if (documents.length === 0) return;

    // Search from currentIndex+1, wrapping around
    for (let i = 1; i <= documents.length; i++) {
      const idx = (currentIndex + i) % documents.length;
      if (documents[idx]?.strategy === 'unresolved') {
        setCurrentIndex(idx);
        return;
      }
    }
    // No unresolved documents found — stay put
  }, [documents, currentIndex]);

  // =========================================================================
  // Strategy selection
  // =========================================================================

  const setStrategy = useCallback(
    (documentId: string, strategy: DocumentResolutionStrategy) => {
      setDocuments((prev) =>
        prev.map((doc) => {
          if (doc.documentId !== documentId) return doc;

          // Disallow cherry-pick for delete conflicts
          if (
            isDeleteConflict(doc.conflictType) &&
            strategy === 'cherry-pick'
          ) {
            return doc;
          }

          const updates: Partial<DocumentResolution> = { strategy };

          // When switching to cherry-pick, populate classifiedFields
          if (
            strategy === 'cherry-pick' &&
            doc.sourceSnapshot &&
            doc.targetSnapshot
          ) {
            updates.classifiedFields = classifyPuckFields(
              doc.sourceSnapshot,
              doc.targetSnapshot,
              null
            );
          }

          return { ...doc, ...updates };
        })
      );
    },
    []
  );

  const setAllStrategy = useCallback(
    (strategy: 'accept-draft' | 'accept-live') => {
      setDocuments((prev) =>
        prev.map((doc) => ({ ...doc, strategy }))
      );
    },
    []
  );

  const setRemainingStrategy = useCallback(
    (strategy: 'accept-draft' | 'accept-live') => {
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.strategy === 'unresolved' ? { ...doc, strategy } : doc
        )
      );
    },
    []
  );

  // =========================================================================
  // Cherry-pick
  // =========================================================================

  const setCherryPickSelection = useCallback(
    (
      documentId: string,
      componentId: string,
      propName: string,
      choice: 'source' | 'target'
    ) => {
      setDocuments((prev) =>
        prev.map((doc) => {
          if (doc.documentId !== documentId) return doc;

          const key = `${componentId}:${propName}`;
          const newSelections = {
            ...doc.cherryPickSelections,
            [key]: choice,
          };

          // Recompute merged snapshot
          let mergedSnapshot: PuckData | null = null;
          if (doc.sourceSnapshot && doc.targetSnapshot && doc.classifiedFields) {
            mergedSnapshot = buildMergedSnapshot(
              doc.sourceSnapshot,
              doc.targetSnapshot,
              doc.classifiedFields,
              newSelections
            );
          }

          return {
            ...doc,
            cherryPickSelections: newSelections,
            mergedSnapshot,
          };
        })
      );
    },
    []
  );

  const acceptAllComponentProps = useCallback(
    (documentId: string, componentId: string, choice: 'source' | 'target') => {
      setDocuments((prev) =>
        prev.map((doc) => {
          if (doc.documentId !== documentId) return doc;
          if (!doc.classifiedFields) return doc;

          const newSelections = { ...doc.cherryPickSelections };
          for (const field of doc.classifiedFields) {
            if (
              field.componentId === componentId &&
              field.classification === 'conflicting'
            ) {
              newSelections[`${field.componentId}:${field.propName}`] = choice;
            }
          }

          let mergedSnapshot: PuckData | null = null;
          if (doc.sourceSnapshot && doc.targetSnapshot) {
            mergedSnapshot = buildMergedSnapshot(
              doc.sourceSnapshot,
              doc.targetSnapshot,
              doc.classifiedFields,
              newSelections
            );
          }

          return {
            ...doc,
            cherryPickSelections: newSelections,
            mergedSnapshot,
          };
        })
      );
    },
    []
  );

  // =========================================================================
  // Merge request lifecycle
  // =========================================================================

  const createMergeRequest = useCallback(
    async (title?: string) => {
      setMergeRequestCreating(true);
      setMergeRequestError(null);

      try {
        const mr = await client.merge.createRequest(siteId, {
          sourceBranchId,
          targetBranchId,
          title: title ?? `Merge Draft → Live`,
        });
        setMergeRequest(mr);
      } catch (err) {
        setMergeRequestError(
          err instanceof Error ? err.message : 'Failed to create merge request'
        );
      } finally {
        setMergeRequestCreating(false);
      }
    },
    [client, siteId, sourceBranchId, targetBranchId]
  );

  const approveMergeRequest = useCallback(async () => {
    if (!mergeRequest) return;
    setMergeRequestError(null);

    try {
      const updated = await client.merge.updateRequest(
        siteId,
        mergeRequest.id,
        { status: 'approved' as MergeRequestStatus }
      );
      setMergeRequest(updated);
    } catch (err) {
      setMergeRequestError(
        err instanceof Error ? err.message : 'Failed to approve merge request'
      );
    }
  }, [client, siteId, mergeRequest]);

  // =========================================================================
  // Merge execution (via merge request)
  // =========================================================================

  const executeMerge = useCallback(
    async (_message?: string) => {
      if (!mergeRequest) {
        setMergeError('No merge request created. Create and approve a merge request first.');
        return;
      }

      if (mergeRequest.status !== 'approved' && mergeRequest.status !== 'conflicted') {
        setMergeError(`Merge request must be approved before executing. Current status: ${mergeRequest.status}`);
        return;
      }

      setMergeExecuting(true);
      setMergeError(null);
      setMergeSuccess(false);

      try {
        const resolutions = documents.map((doc) => {
          switch (doc.strategy) {
            case 'accept-draft':
              return { documentId: doc.documentId, strategy: 'take-source' as const };
            case 'accept-live':
              return { documentId: doc.documentId, strategy: 'take-target' as const };
            case 'cherry-pick':
              return {
                documentId: doc.documentId,
                strategy: 'manual' as const,
                resolvedSnapshot: doc.mergedSnapshot as unknown as Record<string, unknown>,
              };
            default:
              throw new Error(
                `Cannot execute merge: document "${doc.documentPath}" (${doc.documentId}) is still unresolved`
              );
          }
        });

        await client.merge.executeRequest(siteId, mergeRequest.id, { resolutions });

        setMergeSuccess(true);
        setMergeRequest((prev) => prev ? { ...prev, status: 'merged' as MergeRequestStatus } : null);
      } catch (err) {
        setMergeError(
          err instanceof Error ? err.message : 'Merge execution failed'
        );
      } finally {
        setMergeExecuting(false);
      }
    },
    [client, siteId, mergeRequest, documents]
  );

  return {
    documents,
    currentIndex,
    currentDocument,
    totalCount,
    resolvedCount,
    unresolvedCount,
    allResolved,

    previewLoading,
    previewError,
    mergeExecuting,
    mergeError,
    mergeSuccess,

    mergeRequest,
    mergeRequestCreating,
    mergeRequestError,

    createMergeRequest,
    approveMergeRequest,

    goToDocument,
    goToNext,
    goToPrevious,
    goToNextUnresolved,

    setStrategy,
    setAllStrategy,
    setRemainingStrategy,

    setCherryPickSelection,
    acceptAllComponentProps,

    executeMerge,
    loadPreview,
  };
}
