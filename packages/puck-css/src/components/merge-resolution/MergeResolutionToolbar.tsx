/**
 * MergeResolutionToolbar Component
 *
 * Top toolbar with progress indicator, bulk actions, keyboard shortcut hints,
 * inline merge confirmation, and Execute Merge button.
 */

import React, { useState } from 'react';

export interface MergeResolutionToolbarProps {
  sourceBranchName: string;
  targetBranchName: string;
  resolvedCount: number;
  totalCount: number;
  allResolved: boolean;
  mergeExecuting: boolean;
  onClose: () => void;
  onExecuteMerge: () => void;
  onSetAllStrategy: (strategy: 'accept-draft' | 'accept-live') => void;
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
}: MergeResolutionToolbarProps): React.ReactElement {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const progressPercent = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

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
    <div className={baseClass}>
      <div className={`${baseClass}__left`}>
        <button
          type="button"
          className={`${baseClass}__back-button`}
          onClick={onClose}
        >
          Back
        </button>
        <span className={`${baseClass}__branch-label`}>
          Draft ({sourceBranchName}) → {targetBranchName}
        </span>
      </div>

      <div className={`${baseClass}__center`}>
        <span className={`${baseClass}__progress`}>
          {resolvedCount} of {totalCount} resolved
        </span>
        <div
          className={`${baseClass}__progress-bar`}
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${progressPercent}% resolved`}
        >
          <div
            className={`${baseClass}__progress-bar-fill`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className={`${baseClass}__right`}>
        <button
          type="button"
          className={`${baseClass}__bulk-button`}
          onClick={() => onSetAllStrategy('accept-draft')}
        >
          Accept all as Draft
        </button>
        <button
          type="button"
          className={`${baseClass}__bulk-button`}
          onClick={() => onSetAllStrategy('accept-live')}
        >
          Accept all as Live
        </button>
        <button
          type="button"
          className={`${baseClass}__shortcuts-toggle`}
          onClick={() => setShowShortcuts(!showShortcuts)}
          aria-expanded={showShortcuts}
        >
          Keyboard shortcuts
        </button>
        {showConfirm ? (
          <span className={`${baseClass}__confirm`}>
            <span className={`${baseClass}__confirm-text`}>Are you sure?</span>
            <button
              type="button"
              className={`${baseClass}__confirm-button`}
              onClick={handleExecuteClick}
              disabled={mergeExecuting}
            >
              {mergeExecuting ? 'Merging...' : 'Confirm merge'}
            </button>
            <button
              type="button"
              className={`${baseClass}__cancel-button`}
              onClick={handleCancelConfirm}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={`${baseClass}__execute-button`}
            disabled={!allResolved || mergeExecuting}
            onClick={handleExecuteClick}
          >
            {mergeExecuting ? 'Merging...' : 'Execute merge'}
          </button>
        )}
      </div>

      {showShortcuts && (
        <div className={`${baseClass}__shortcuts`} data-testid="keyboard-shortcuts">
          <dl className={`${baseClass}__shortcuts-list`}>
            <dt>J / ArrowDown</dt><dd>Next document</dd>
            <dt>K / ArrowUp</dt><dd>Previous document</dd>
            <dt>N</dt><dd>Next unresolved</dd>
            <dt>1 / 2 / 3 / 4</dt><dd>Accept Draft / Live / Cherry-pick / CRDT</dd>
            <dt>Shift+D</dt><dd>Accept all remaining as Draft</dd>
            <dt>Shift+L</dt><dd>Accept all remaining as Live</dd>
            <dt>Enter</dt><dd>Toggle detail view</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
