/**
 * useDocuments Hook
 *
 * Provides document management functionality.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Document, PuckData } from '@pantheon-systems/css-client';
import type { P1Client } from '@pantheon-systems/css-client';

interface UseDocumentsParams {
  client: P1Client;
  siteId: string;
  branchId: string;
}

interface UseDocumentsReturn {
  /**
   * List of documents on the current branch.
   */
  documents: Document[];

  /**
   * Loading state.
   */
  loading: boolean;

  /**
   * Error state.
   */
  error: Error | null;

  /**
   * Create a new document.
   */
  create: (path: string, initialData?: PuckData, options?: { templateId?: string; templateVersion?: number }) => Promise<Document>;

  /**
   * Delete a document.
   */
  remove: (documentId: string) => Promise<void>;

  /**
   * Refresh the documents list.
   */
  refresh: () => Promise<void>;

  /**
   * Get a document by path.
   */
  getByPath: (path: string) => Document | undefined;
}

/**
 * Default empty Puck data for new documents.
 */
const DEFAULT_PUCK_DATA: PuckData = {
  content: [],
  root: { props: {} },
};

/**
 * Hook for managing documents on a branch.
 *
 * @param params - Configuration for document management
 * @returns Document state and operations
 *
 * @example
 * ```tsx
 * const { documents, create, remove, loading } = useDocuments({
 *   client,
 *   siteId,
 *   branchId,
 * });
 *
 * // Create a new page
 * await create('/new-page');
 *
 * // Delete a page
 * await remove(documentId);
 * ```
 */
export function useDocuments({
  client,
  siteId,
  branchId,
}: UseDocumentsParams): UseDocumentsReturn {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Track the previous branchId to detect changes and reset state synchronously
  const prevBranchIdRef = useRef<string>(branchId);

  // Reset state synchronously when branchId changes
  // This prevents race conditions where loadDocument is recreated with new branchId
  // but documents array still contains old branch's documents
  if (branchId !== prevBranchIdRef.current) {
    prevBranchIdRef.current = branchId;
    // Clear documents and set loading synchronously during render
    // This ensures consumers see loading=true immediately when branch changes
    setDocuments([]);
    setLoading(true);
    setError(null);
  }

  // Fetch documents
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const docs = await client.documents.list(siteId, branchId);
      setDocuments(docs);
    } catch (err) {
      console.error('[useDocuments] error:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, siteId, branchId]);

  // Initial fetch and refetch when branchId changes
  useEffect(() => {
    if (branchId) {
      void refresh();
    }
  }, [refresh, branchId]);

  // Create a new document
  const create = useCallback(
    async (path: string, initialData?: PuckData, options?: { templateId?: string; templateVersion?: number }): Promise<Document> => {
      const doc = await client.documents.create({
        siteId,
        branchId,
        path,
        ...(options?.templateId ? {
          templateId: options.templateId,
          templateVersion: options.templateVersion ?? 1,
        } : {}),
      });

      // Create initial version with default or provided data
      const data = initialData ?? DEFAULT_PUCK_DATA;
      await client.versions.create(siteId, {
        documentId: doc.id,
        branchId,
        snapshot: data as unknown as Record<string, unknown>,
      });

      // Refresh the list
      await refresh();

      return doc;
    },
    [client, siteId, branchId, refresh]
  );

  // Delete a document
  const remove = useCallback(
    async (documentId: string): Promise<void> => {
      await client.documents.delete(siteId, branchId, documentId);
      await refresh();
    },
    [client, siteId, branchId, refresh]
  );

  // Get document by path
  const getByPath = useCallback(
    (path: string): Document | undefined => {
      return documents.find((doc) => doc.path === path);
    },
    [documents]
  );

  return {
    documents,
    loading,
    error,
    create,
    remove,
    refresh,
    getByPath,
  };
}
