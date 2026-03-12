/**
 * MergeResolutionToolbar Component
 *
 * Top toolbar with progress indicator, bulk actions, keyboard shortcut hints,
 * and Execute Merge button.
 */

import React from 'react';

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
          {sourceBranchName} → {targetBranchName}
        </span>
      </div>

      <div className={`${baseClass}__center`}>
        <span className={`${baseClass}__progress`}>
          {resolvedCount} of {totalCount} resolved
        </span>
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
          className={`${baseClass}__execute-button`}
          disabled={!allResolved || mergeExecuting}
          onClick={onExecuteMerge}
        >
          {mergeExecuting ? 'Merging...' : 'Execute merge'}
        </button>
      </div>
    </div>
  );
}
