/**
 * CRDT Preview Button Component
 *
 * "Try auto-merge" button that calls the CRDT merge preview API
 * and passes the result to a callback for review.
 */

import { useState, useCallback } from 'react';
import { previewCrdtMerge } from '../../api/merge-requests';

/** Props for the {@link CrdtPreviewButton} component. */
interface CrdtPreviewButtonProps {
  /** The site ID owning the document. */
  siteId: string;
  /** The document ID to auto-merge. */
  documentId: string;
  /** The source branch ID for the merge. */
  sourceBranchId: string;
  /** The target branch ID for the merge. */
  targetBranchId: string;
  /** Callback invoked with the CRDT-merged snapshot on success. */
  onResult: (mergedSnapshot: Record<string, unknown>) => void;
}

/**
 * Button that triggers a CRDT auto-merge via the API and passes the
 * resulting merged snapshot to the parent for review.
 */
export function CrdtPreviewButton({
  siteId,
  documentId,
  sourceBranchId,
  targetBranchId,
  onResult,
}: CrdtPreviewButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await previewCrdtMerge(siteId, {
        documentId,
        sourceBranchId,
        targetBranchId,
      });

      if (!result.success) {
        setError(result.error || 'Unable to auto-merge these changes. Try resolving conflicts manually.');
        return;
      }

      onResult(result.snapshot);
    } catch {
      setError('Unable to auto-merge. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [siteId, documentId, sourceBranchId, targetBranchId, onResult]);

  return (
    <div className="crdt-preview-button">
      <button
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? 'Merging...' : 'Try auto-merge'}
      </button>
      {error && <span className="crdt-error">{error}</span>}
    </div>
  );
}
