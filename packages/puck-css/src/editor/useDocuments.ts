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
  create: (
    path: string,
    initialData?: PuckData,
    options?: { templateId?: string; templateVersion?: number; title?: string },
  ) => Promise<Document>;

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
    async (
      path: string,
      initialData?: PuckData,
      options?: { templateId?: string; templateVersion?: number; title?: string },
    ): Promise<Document> => {
      // Template pages get their initial version built by the backend from the
      // template, which preserves each component's durable slot id. A
      // client-built snapshot would be layered on top as a second version and
      // bury those ids, so it is rejected here.
      if (options?.templateId) {
        if (initialData !== undefined) {
          throw new Error(
            'Cannot supply initialData when creating a document from a template; the backend builds the initial version from the template.',
          );
        }

        const doc = await client.documents.create({
          siteId,
          branchId,
          path,
          templateId: options.templateId,
          templateVersion: options.templateVersion ?? 1,
          ...(options.title ? { title: options.title } : {}),
        });

        await refresh();

        return doc;
      }

      // Blank pages build their initial version on the client. A title seeds
      // root.props.title (the same field Puck's root "title" input
      // reads/writes) so it persists in the initial snapshot.
      const baseData = initialData ?? DEFAULT_PUCK_DATA;
      const data: PuckData = options?.title
        ? {
            ...baseData,
            root: {
              ...baseData.root,
              props: { ...(baseData.root?.props ?? {}), title: options.title },
            },
          }
        : baseData;

      // Create the document and its initial version in a SINGLE call by passing
      // the content inline as `snapshot`. Previously this was two calls
      // (documents.create with no snapshot, then a separate versions.create),
      // which produced two version rows for a brand-new page.
      const doc = await client.documents.create({
        siteId,
        branchId,
        path,
        snapshot: data as unknown as Record<string, unknown>,
      });

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
