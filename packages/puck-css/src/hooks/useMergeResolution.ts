/**
 * useMergeResolution Hook
 *
 * Central state machine for multi-document merge conflict resolution.
 * Manages document list, per-document strategy selection, cherry-pick
 * state, CRDT preview fetching, navigation, and merge execution.
 */

import { useState, useCallback, useMemo } from 'react';
import type { CSSClient, PuckData, DocumentConflictType, MergePreview, MergeRequest, MergeRequestStatus } from '@pantheon/css-client';
import {
  classifyPuckFields,
  buildMergedSnapshot,
} from '../utils/puckFieldClassifier.js';
import type { PuckFieldClassification } from '../utils/puckFieldClassifier.js';

// =============================================================================
// Types
// =============================================================================

export type DocumentResolutionStrategy =
  | 'accept-draft'
  | 'accept-live'
  | 'cherry-pick'
  | 'crdt-preview'
  | 'unresolved';

/** How this document changed in the merge */
export type DocumentChangeType = 'conflicting' | 'changed' | 'added' | 'deleted';

export interface DocumentResolution {
  documentId: string;
  documentPath: string;
  strategy: DocumentResolutionStrategy;
  /** How this document changed in the merge */
  changeType: DocumentChangeType;
  cherryPickSelections: Record<string, 'source' | 'target'>;
  mergedSnapshot: PuckData | null;
  crdtPreviewSnapshot: PuckData | null;
  crdtPreviewLoading: boolean;
  crdtPreviewError: string | null;
  sourceSnapshot: PuckData | null;
  targetSnapshot: PuckData | null;
  conflictType: DocumentConflictType;
  classifiedFields: PuckFieldClassification[] | null;
}

export interface UseMergeResolutionOptions {
  client: CSSClient;
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

  fetchCrdtPreview: (documentId: string) => Promise<void>;
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
        { includeContent: true }
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

      // Collect all document IDs we need to process
      const allDocIds = new Set<string>();
      for (const c of preview.conflicts.documentConflicts) {
        allDocIds.add(c.documentId);
      }
      for (const sc of preview.sourceChanges) {
        allDocIds.add(sc.documentId);
      }
      for (const tc of preview.targetChanges) {
        allDocIds.add(tc.documentId);
      }

      // Fetch snapshots for non-conflicting documents in parallel
      const snapshotFetches = new Map<string, Promise<{ source: PuckData | null; target: PuckData | null }>>();

      for (const docId of allDocIds) {
        // Conflicting documents have snapshots from documentDiffs
        if (conflictDocIds.has(docId) && diffMap.has(docId)) {
          continue;
        }

        // For non-conflicting docs, fetch snapshots via versions API.
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
          changeType = 'conflicting';
          strategy = 'unresolved';
          conflictType = conflict?.conflictType ?? 'both-modified';
        } else if (inSource && !inTarget) {
          // Source-only change: could be added or changed
          const snapshots = fetchedSnapshots.get(docId);
          if (snapshots?.target === null) {
            changeType = 'added';
          } else {
            changeType = 'changed';
          }
          strategy = 'accept-draft';
          conflictType = 'both-modified'; // Not actually a conflict
        } else if (inTarget && !inSource) {
          // Target-only change
          changeType = 'changed';
          strategy = 'accept-live';
          conflictType = 'both-modified'; // Not actually a conflict
        } else {
          // In both but not conflicting (shouldn't happen normally, but handle gracefully)
          changeType = 'changed';
          strategy = 'unresolved';
          conflictType = 'both-modified';
        }

        // Get snapshots
        let sourceSnapshot: PuckData | null = null;
        let targetSnapshot: PuckData | null = null;

        if (isConflicting && diff) {
          // Use snapshots from documentDiffs for conflicting docs
          sourceSnapshot = (diff.sourceSnapshot as unknown as PuckData) ?? null;
          targetSnapshot = (diff.targetSnapshot as unknown as PuckData) ?? null;
        } else {
          // Use fetched snapshots for non-conflicting docs
          const snapshots = fetchedSnapshots.get(docId);
          if (snapshots) {
            sourceSnapshot = snapshots.source;
            targetSnapshot = snapshots.target;
          }
        }

        docs.push({
          documentId: docId,
          documentPath: docPath,
          strategy,
          changeType,
          cherryPickSelections: {},
          mergedSnapshot: null,
          crdtPreviewSnapshot: null,
          crdtPreviewLoading: false,
          crdtPreviewError: null,
          sourceSnapshot,
          targetSnapshot,
          conflictType,
          classifiedFields: null,
        });
      }

      // Sort: conflicting first, then added, changed, deleted
      const changeTypeOrder: Record<DocumentChangeType, number> = {
        conflicting: 0,
        added: 1,
        changed: 2,
        deleted: 3,
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

          // Disallow cherry-pick and crdt-preview for delete conflicts
          if (
            isDeleteConflict(doc.conflictType) &&
            (strategy === 'cherry-pick' || strategy === 'crdt-preview')
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
  // CRDT preview
  // =========================================================================

  const fetchCrdtPreview = useCallback(
    async (documentId: string) => {
      // Set loading state
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.documentId === documentId
            ? { ...doc, crdtPreviewLoading: true, crdtPreviewError: null }
            : doc
        )
      );

      try {
        const result = await client.merge.crdtPreview(
          siteId,
          documentId,
          sourceBranchId,
          targetBranchId
        );

        setDocuments((prev) =>
          prev.map((doc) =>
            doc.documentId === documentId
              ? {
                  ...doc,
                  crdtPreviewSnapshot: result.snapshot as unknown as PuckData,
                  crdtPreviewLoading: false,
                }
              : doc
          )
        );
      } catch (err) {
        setDocuments((prev) =>
          prev.map((doc) =>
            doc.documentId === documentId
              ? {
                  ...doc,
                  crdtPreviewError:
                    err instanceof Error
                      ? err.message
                      : 'Failed to fetch CRDT preview',
                  crdtPreviewLoading: false,
                }
              : doc
          )
        );
      }
    },
    [client, siteId, sourceBranchId, targetBranchId]
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
            case 'crdt-preview':
              return { documentId: doc.documentId, strategy: 'merge-crdt' as const };
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

    fetchCrdtPreview,
    executeMerge,
    loadPreview,
  };
}
