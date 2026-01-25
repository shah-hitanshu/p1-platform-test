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
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Load preview automatically on mount, when branch IDs change, or on manual refresh
  useEffect(() => {
    // Guard against invalid IDs to prevent API errors
    if (!siteId || !sourceBranchId || !targetBranchId) {
      return;
    }

    let isCancelled = false;

    const fetchPreview = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await previewMerge(siteId, {
          sourceBranchId,
          targetBranchId,
        });

        if (!isCancelled) {
          setPreview(result);
          setIsLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load preview');
          setIsLoading(false);
        }
      }
    };

    // Delay initial load slightly to avoid racing with other page load requests
    // This helps prevent database connection conflicts in the backend
    const isInitialLoad = refreshCounter === 0;
    const timeoutId = setTimeout(
      fetchPreview,
      isInitialLoad ? 100 : 0
    );

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [siteId, sourceBranchId, targetBranchId, refreshCounter]);

  // Manual refresh handler - triggers useEffect by incrementing counter
  const handleRefresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  return (
    <div className="merge-preview-panel" data-testid="merge-preview-panel">
      <div className="preview-header">
        <h3 className="preview-title">Merge Preview</h3>
        <Button
          type="secondary"
          onClick={handleRefresh}
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
        <div className="preview-loading" data-testid="preview-loading">
          <span className="loading-spinner"></span>
          <span>Loading preview...</span>
        </div>
      )}

      {!isLoading && preview && (
        <div className="preview-result" data-testid="preview-result">
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
