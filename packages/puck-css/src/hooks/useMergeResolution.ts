/**
 * useMergeResolution Hook
 *
 * Central state machine for multi-document merge conflict resolution.
 * Manages document list, per-document strategy selection, cherry-pick
 * state, CRDT preview fetching, navigation, and merge execution.
 */

import { useState, useCallback, useMemo } from 'react';
import type { CSSClient, PuckData, DocumentConflictType, MergePreview } from '@pantheon/css-client';
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

export interface DocumentResolution {
  documentId: string;
  documentPath: string;
  strategy: DocumentResolutionStrategy;
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

      // Build source-only and target-only sets
      const sourceDocIds = new Set(
        preview.sourceChanges.map((c) => c.documentId)
      );
      const targetDocIds = new Set(
        preview.targetChanges.map((c) => c.documentId)
      );

      const docs: DocumentResolution[] = (preview.documentDiffs ?? []).map(
        (diff) => {
          const conflict = conflictMap.get(diff.documentId);
          const conflictType: DocumentConflictType =
            conflict?.conflictType ?? 'both-modified';

          let strategy: DocumentResolutionStrategy;
          if (conflictDocIds.has(diff.documentId)) {
            strategy = 'unresolved';
          } else if (
            sourceDocIds.has(diff.documentId) &&
            !targetDocIds.has(diff.documentId)
          ) {
            strategy = 'accept-draft';
          } else if (
            targetDocIds.has(diff.documentId) &&
            !sourceDocIds.has(diff.documentId)
          ) {
            strategy = 'accept-live';
          } else {
            // Both changed but no conflict listed => default unresolved
            strategy = 'unresolved';
          }

          return {
            documentId: diff.documentId,
            documentPath: diff.documentPath,
            strategy,
            cherryPickSelections: {},
            mergedSnapshot: null,
            crdtPreviewSnapshot: null,
            crdtPreviewLoading: false,
            crdtPreviewError: null,
            sourceSnapshot: (diff.sourceSnapshot as unknown as PuckData) ?? null,
            targetSnapshot: (diff.targetSnapshot as unknown as PuckData) ?? null,
            conflictType,
            classifiedFields: null,
          };
        }
      );

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
  // Merge execution
  // =========================================================================

  const executeMerge = useCallback(
    async (message?: string) => {
      setMergeExecuting(true);
      setMergeError(null);
      setMergeSuccess(false);

      try {
        const conflictResolutions = documents.map((doc) => {
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

        await client.merge.execute(siteId, {
          sourceBranchId,
          targetBranchId,
          message,
          conflictResolutions,
        });

        setMergeSuccess(true);
      } catch (err) {
        setMergeError(
          err instanceof Error ? err.message : 'Merge execution failed'
        );
      } finally {
        setMergeExecuting(false);
      }
    },
    [client, siteId, sourceBranchId, targetBranchId, documents]
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
