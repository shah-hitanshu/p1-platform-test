/**
 * Merge Preview Panel Component
 *
 * Shows a preview of what will happen when a merge is executed.
 */

import { useState } from 'react';
import { previewMerge } from '../api/merge-requests';
import { ConflictList } from './ConflictList';
import type { MergePreview } from '../types';
import './MergePreviewPanel.css';

interface MergePreviewPanelProps {
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  sourceBranchName: string;
  targetBranchName: string;
}

export function MergePreviewPanel({
  siteId,
  sourceBranchId,
  targetBranchId,
  sourceBranchName,
  targetBranchName,
}: MergePreviewPanelProps) {
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const handlePreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await previewMerge(siteId, {
        sourceBranchId,
        targetBranchId,
      });
      setPreview(result);
      setHasLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="merge-preview-panel">
      <div className="preview-header">
        <h3 className="preview-title">Merge Preview</h3>
        <button
          className="preview-btn"
          onClick={handlePreview}
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : hasLoaded ? 'Refresh Preview' : 'Preview Merge'}
        </button>
      </div>

      <div className="preview-info">
        <p className="preview-description">
          Preview the merge from <code>{sourceBranchName}</code> into <code>{targetBranchName}</code>.
        </p>
      </div>

      {error && (
        <div className="preview-error">
          <span className="error-icon">!</span>
          <span className="error-text">{error}</span>
        </div>
      )}

      {hasLoaded && preview && (
        <div className="preview-result">
          <div className="preview-summary">
            <div className={`merge-status ${preview.canMerge ? 'can-merge' : 'cannot-merge'}`}>
              {preview.canMerge ? (
                <>
                  <span className="status-icon">✓</span>
                  <span className="status-text">Can be merged</span>
                </>
              ) : (
                <>
                  <span className="status-icon">✗</span>
                  <span className="status-text">Cannot be merged automatically</span>
                </>
              )}
            </div>
            {preview.hasConflicts && (
              <div className="conflicts-warning">
                <span className="warning-icon">!</span>
                <span className="warning-text">
                  This merge has conflicts that need to be resolved
                </span>
              </div>
            )}
          </div>

          {preview.hasConflicts && preview.conflicts.documentConflicts.length > 0 && (
            <div className="preview-conflicts">
              <ConflictList conflicts={preview.conflicts.documentConflicts} />
            </div>
          )}

          {!preview.hasConflicts && (
            <div className="clean-merge">
              <p>This is a clean merge with no conflicts.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
