/**
 * Merge Preview Panel Component
 *
 * Shows a preview of what will happen when a merge is executed.
 * Loads automatically when mounted.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button, Alert } from '@pantheon-systems/design-toolkit-react';
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

  const loadPreview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await previewMerge(siteId, {
        sourceBranchId,
        targetBranchId,
      });
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setIsLoading(false);
    }
  }, [siteId, sourceBranchId, targetBranchId]);

  // Load preview automatically on mount
  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  return (
    <div className="merge-preview-panel">
      <div className="preview-header">
        <h3 className="preview-title">Merge Preview</h3>
        <Button
          type="secondary"
          onClick={loadPreview}
          disabled={isLoading}
          isLoading={isLoading}
          data-testid="refresh-preview-btn"
        >
          {isLoading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      <div className="preview-info">
        <p className="preview-description">
          Merging from <code>{sourceBranchName}</code> into <code>{targetBranchName}</code>
        </p>
      </div>

      {error && (
        <Alert type="danger" data-testid="preview-error">
          {error}
        </Alert>
      )}

      {isLoading && (
        <div className="preview-loading">
          <span className="loading-spinner"></span>
          <span>Loading preview...</span>
        </div>
      )}

      {!isLoading && preview && (
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
              <Alert type="warning" data-testid="conflicts-warning">
                This merge has conflicts that need to be resolved
              </Alert>
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
