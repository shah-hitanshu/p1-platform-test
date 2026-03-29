/**
 * MergeResolutionToolbar Component
 *
 * Top toolbar with progress indicator, bulk actions, keyboard shortcut hints,
 * inline merge confirmation, and Execute Merge button.
 */

import React, { useState } from 'react';
import type { MergeRequestStatus } from '@pantheon/css-client';

export interface MergeResolutionToolbarProps {
  sourceBranchName: string;
  targetBranchName: string;
  resolvedCount: number;
  totalCount: number;
  /** Number of documents that are actual conflicts requiring resolution */
  conflictCount?: number;
  allResolved: boolean;
  mergeExecuting: boolean;
  onClose: () => void;
  onExecuteMerge: () => void;
  onSetAllStrategy: (strategy: 'accept-draft' | 'accept-live') => void;
  onSetRemainingStrategy?: (strategy: 'accept-draft' | 'accept-live') => void;
  /** Current merge request, if one has been created */
  mergeRequest?: { id: string; status: MergeRequestStatus; title: string } | null;
  /** Whether a merge request is being created */
  mergeRequestCreating?: boolean;
  /** Error from merge request operations */
  mergeRequestError?: string | null;
  /** Create a new merge request */
  onCreateMergeRequest?: () => void;
  /** Approve the current merge request */
  onApproveMergeRequest?: () => void;
}

const baseClass = 'merge-resolution-toolbar';

export function MergeResolutionToolbar({
  sourceBranchName,
  targetBranchName,
  resolvedCount,
  totalCount,
  allResolved,
  mergeExecuting,
  onClose,
  onExecuteMerge,
  onSetAllStrategy,
  onSetRemainingStrategy,
  conflictCount,
  mergeRequest,
  mergeRequestCreating,
  mergeRequestError,
  onCreateMergeRequest,
  onApproveMergeRequest,
}: MergeResolutionToolbarProps): React.ReactElement {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const progressPercent = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  const bulkButtonStyle: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid #ccc',
    background: 'white',
    cursor: 'pointer',
    fontSize: 13,
  };

  const handleExecuteClick = () => {
    if (showConfirm) {
      onExecuteMerge();
      setShowConfirm(false);
    } else {
      setShowConfirm(true);
    }
  };

  const handleCancelConfirm = () => {
    setShowConfirm(false);
  };

  return (
    <div className={baseClass} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f8f9fa', borderBottom: '2px solid #e5e7eb', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
      <div className={`${baseClass}__left`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          className={`${baseClass}__back-button`}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc', background: 'white', cursor: 'pointer', fontSize: 14 }}
          onClick={onClose}
        >
          Back
        </button>
        <span className={`${baseClass}__branch-label`} style={{ fontSize: 14, color: '#666' }}>
          Draft ({sourceBranchName}) → {targetBranchName}
        </span>
      </div>

      <div className={`${baseClass}__center`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center', minWidth: 200 }}>
        <span className={`${baseClass}__progress`} style={{ fontSize: 13, color: '#555', whiteSpace: 'nowrap' }}>
          {conflictCount != null && conflictCount > 0
            ? `${conflictCount - (totalCount - resolvedCount)} of ${conflictCount} conflicts resolved`
            : `${totalCount} documents`}
          {conflictCount != null && totalCount > conflictCount && (
            <span style={{ color: '#999', marginLeft: 4 }}>
              ({totalCount - conflictCount} auto-merged)
            </span>
          )}
        </span>
        <div
          className={`${baseClass}__progress-bar`}
          style={{ width: 120, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${progressPercent}% resolved`}
        >
          <div
            className={`${baseClass}__progress-bar-fill`}
            style={{ width: `${progressPercent}%`, height: '100%', background: '#28a745', borderRadius: 3, transition: 'width 0.3s' }}
          />
        </div>
      </div>

      <div className={`${baseClass}__right`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`${baseClass}__bulk-button`}
          style={bulkButtonStyle}
          onClick={() => onSetAllStrategy('accept-draft')}
        >
          Accept all from Draft
        </button>
        <button
          type="button"
          className={`${baseClass}__bulk-button`}
          style={bulkButtonStyle}
          onClick={() => onSetAllStrategy('accept-live')}
        >
          Accept all from Live
        </button>
        {onSetRemainingStrategy && (
          <>
            <button
              type="button"
              className={`${baseClass}__bulk-button`}
              style={bulkButtonStyle}
              onClick={() => onSetRemainingStrategy('accept-draft')}
            >
              Accept remaining from Draft
            </button>
            <button
              type="button"
              className={`${baseClass}__bulk-button`}
              style={bulkButtonStyle}
              onClick={() => onSetRemainingStrategy('accept-live')}
            >
              Accept remaining from Live
            </button>
          </>
        )}
        <button
          type="button"
          className={`${baseClass}__shortcuts-toggle`}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc', background: 'white', cursor: 'pointer', fontSize: 13, color: '#0066cc' }}
          onClick={() => setShowShortcuts(!showShortcuts)}
          aria-expanded={showShortcuts}
        >
          Keyboard shortcuts
        </button>
        {/* Merge request error */}
        {mergeRequestError && (
          <span className={`${baseClass}__mr-error`} style={{ color: '#c53030', fontSize: 13, fontWeight: 500 }}>
            {mergeRequestError}
          </span>
        )}

        {/* Step 1: Create merge request */}
        {!mergeRequest && onCreateMergeRequest && (
          <button
            type="button"
            className={`${baseClass}__create-mr-button`}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#0066cc', color: 'white', cursor: (!allResolved || mergeRequestCreating) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: (!allResolved || mergeRequestCreating) ? 0.5 : 1 }}
            disabled={!allResolved || mergeRequestCreating}
            onClick={onCreateMergeRequest}
          >
            {mergeRequestCreating ? 'Creating...' : 'Create merge request'}
          </button>
        )}

        {/* Step 2: Approve merge request */}
        {mergeRequest && mergeRequest.status === 'open' && onApproveMergeRequest && (
          <button
            type="button"
            className={`${baseClass}__approve-mr-button`}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#28a745', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
            onClick={onApproveMergeRequest}
          >
            Approve merge request
          </button>
        )}

        {/* Step 3: Execute merge (with confirmation) */}
        {mergeRequest && (mergeRequest.status === 'approved' || mergeRequest.status === 'conflicted') && (
          <>
            {showConfirm ? (
              <span className={`${baseClass}__confirm`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <span className={`${baseClass}__confirm-text`} style={{ fontWeight: 600, color: '#c53030' }}>Are you sure?</span>
                <button
                  type="button"
                  className={`${baseClass}__confirm-button`}
                  style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#c53030', color: 'white', fontWeight: 600 }}
                  onClick={handleExecuteClick}
                  disabled={mergeExecuting}
                >
                  {mergeExecuting ? 'Merging...' : 'Confirm merge'}
                </button>
                <button
                  type="button"
                  className={`${baseClass}__cancel-button`}
                  style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc', background: 'white' }}
                  onClick={handleCancelConfirm}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={`${baseClass}__execute-button`}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#0066cc', color: 'white', cursor: mergeExecuting ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: mergeExecuting ? 0.5 : 1 }}
                disabled={mergeExecuting}
                onClick={handleExecuteClick}
              >
                {mergeExecuting ? 'Merging...' : 'Execute merge'}
              </button>
            )}
          </>
        )}

        {/* Merged status indicator */}
        {mergeRequest && mergeRequest.status === 'merged' && (
          <span className={`${baseClass}__merged-badge`} style={{ padding: '8px 16px', borderRadius: 6, background: '#d4edda', color: '#155724', fontSize: 14, fontWeight: 600 }}>
            Merged
          </span>
        )}
      </div>

      {showShortcuts && (
        <div className={`${baseClass}__shortcuts`} data-testid="keyboard-shortcuts" style={{ width: '100%', padding: '12px 16px', background: '#f0f4f8', borderRadius: 6, marginTop: 8 }}>
          <dl className={`${baseClass}__shortcuts-list`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: 0, fontSize: 13 }}>
            <dt style={{ fontWeight: 600, fontFamily: 'monospace', color: '#333' }}>J / ArrowDown</dt><dd style={{ margin: 0, color: '#666' }}>Next document</dd>
            <dt style={{ fontWeight: 600, fontFamily: 'monospace', color: '#333' }}>K / ArrowUp</dt><dd style={{ margin: 0, color: '#666' }}>Previous document</dd>
            <dt style={{ fontWeight: 600, fontFamily: 'monospace', color: '#333' }}>N</dt><dd style={{ margin: 0, color: '#666' }}>Next unresolved</dd>
            <dt style={{ fontWeight: 600, fontFamily: 'monospace', color: '#333' }}>1 / 2 / 3</dt><dd style={{ margin: 0, color: '#666' }}>Accept Draft / Live / Cherry-pick</dd>
            <dt style={{ fontWeight: 600, fontFamily: 'monospace', color: '#333' }}>Shift+D</dt><dd style={{ margin: 0, color: '#666' }}>Accept all remaining from Draft</dd>
            <dt style={{ fontWeight: 600, fontFamily: 'monospace', color: '#333' }}>Shift+L</dt><dd style={{ margin: 0, color: '#666' }}>Accept all remaining from Live</dd>
            <dt style={{ fontWeight: 600, fontFamily: 'monospace', color: '#333' }}>Enter</dt><dd style={{ margin: 0, color: '#666' }}>Toggle detail view</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
