/**
 * CRDT Preview Button Component
 *
 * "Try auto-merge" button that calls the CRDT merge API
 * and passes the result to a callback for review.
 */

import { useState, useCallback } from 'react';

interface CrdtPreviewButtonProps {
  siteId: string;
  documentId: string;
  sourceBranchId: string;
  targetBranchId: string;
  onResult: (mergedSnapshot: Record<string, unknown>) => void;
}

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
      const response = await fetch(
        `/api/sites/${siteId}/documents/${documentId}/crdt-merge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceBranchId, targetBranchId }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Auto-merge failed');
        return;
      }

      onResult(data.snapshot);
    } catch {
      setError('Auto-merge failed');
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
