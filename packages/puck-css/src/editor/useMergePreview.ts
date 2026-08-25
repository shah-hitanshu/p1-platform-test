import { useState, useEffect } from 'react';
import { useP1Puck } from '../core/P1PuckContext.js';
import type { DocumentDiffSummary } from '../versioning/utils/branchDiff.js';

export interface UseMergePreviewReturn {
  documents: DocumentDiffSummary[];
  loading: boolean;
  error: Error | null;
  sourceBranchName: string;
  targetBranchName: string;
  isMainBranch: boolean;
}

/**
 * Automatically loads a merge preview comparing the current branch against main.
 * Must be used inside a P1PuckProvider.
 */
export function useMergePreview(): UseMergePreviewReturn {
  const ccr = useP1Puck();

  const mainBranch = ccr.branches.find((b) => b.isMain) ?? null;
  const isMainBranch = ccr.currentBranch?.isMain ?? false;

  const [documents, setDocuments] = useState<DocumentDiffSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const sourceBranchName = ccr.currentBranch?.name ?? 'Draft';
  const targetBranchName = mainBranch?.name ?? 'Live';

  useEffect(() => {
    if (ccr.branchesLoading) return;

    if (isMainBranch || !mainBranch) {
      setLoading(false);
      setDocuments([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    ccr.client.merge
      .preview(ccr.siteId, ccr.branchId, mainBranch.id, {
        includeContent: true,
        excludePathPrefixes: ['_registry/'],
      })
      .then((preview) => {
        if (cancelled) return;
        const docs: DocumentDiffSummary[] = (preview.documentDiffs ?? []).map((d) => ({
          documentId: d.documentId,
          documentPath: d.documentPath,
          sourceSnapshot: d.sourceSnapshot,
          targetSnapshot: d.targetSnapshot,
        }));
        setDocuments(docs);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ccr.siteId, ccr.branchId, mainBranch?.id, ccr.branchesLoading, isMainBranch]);

  return { documents, loading, error, sourceBranchName, targetBranchName, isMainBranch };
}
