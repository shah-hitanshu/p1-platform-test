/**
 * Merge Preview Panel Component
 *
 * Shows a preview of what will happen when a merge is executed.
 * Loads automatically when mounted.
 * Supports expandable diff viewing with lazy loading.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, InlineMessage } from '@pantheon-systems/pds-toolkit-react';
import { previewMerge } from '../api/merge-requests';
import { ExpandableConflictList } from './ExpandableConflictList';
import { DocumentChangeSummary } from './document-change-summary';
import type { MergePreview, DocumentDiff } from '../types';
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

  // State for lazy-loaded document diffs
  const [documentDiffs, setDocumentDiffs] = useState<DocumentDiff[]>([]);
  const [diffsLoading, setDiffsLoading] = useState(false);
  const diffsLoadedRef = useRef(false);

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
    // Reset diffs state on refresh
    diffsLoadedRef.current = false;
    setDocumentDiffs([]);
    setRefreshCounter((c) => c + 1);
  }, []);

  // Lazy load document diffs when user expands a conflict row
  const handleRequestDiffs = useCallback(async () => {
    // Only load once per preview
    if (diffsLoadedRef.current || !siteId || !sourceBranchId || !targetBranchId) {
      return;
    }

    diffsLoadedRef.current = true;
    setDiffsLoading(true);

    try {
      const result = await previewMerge(siteId, {
        sourceBranchId,
        targetBranchId,
        includeContent: true,
      });

      if (result.documentDiffs) {
        setDocumentDiffs(result.documentDiffs);
      }
    } catch (err) {
      // Silently fail diff loading - the main preview still works
      console.error('Failed to load document diffs:', err);
    } finally {
      setDiffsLoading(false);
    }
  }, [siteId, sourceBranchId, targetBranchId]);

  return (
    <div className="merge-preview-panel" data-testid="merge-preview-panel">
      <div className="preview-header">
        <h3 className="preview-title">Merge Preview</h3>
        <Button
          variant="secondary"
          label={isLoading ? 'Loading...' : 'Refresh'}
          onClick={handleRefresh}
          disabled={isLoading}
          isLoading={isLoading}
          data-testid="refresh-preview-btn"
        />
      </div>

      <div className="preview-info">
        <p className="preview-description">
          Merging from <code>{sourceBranchName}</code> into <code>{targetBranchName}</code>
        </p>
      </div>

      {error && (
        <InlineMessage type="critical" title={error} data-testid="preview-error" />
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
              <InlineMessage type="warning" title="This merge has conflicts that need to be resolved" data-testid="conflicts-warning" />
            )}
          </div>

          {(preview.sourceChanges || preview.targetChanges) && (
            <div className="preview-change-summary">
              <DocumentChangeSummary
                sourceChanges={preview.sourceChanges ?? []}
                targetChanges={preview.targetChanges ?? []}
                conflicts={preview.conflicts.documentConflicts}
                sourceBranchName={sourceBranchName}
                targetBranchName={targetBranchName}
              />
            </div>
          )}

          {preview.hasConflicts && preview.conflicts.documentConflicts.length > 0 && (
            <div className="preview-conflicts">
              <ExpandableConflictList
                conflicts={preview.conflicts.documentConflicts}
                documentDiffs={documentDiffs}
                diffsLoading={diffsLoading}
                onRequestDiffs={handleRequestDiffs}
              />
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
