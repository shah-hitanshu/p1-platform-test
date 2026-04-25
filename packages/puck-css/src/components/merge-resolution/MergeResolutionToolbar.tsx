import React, { useState } from 'react';
import { IconButton, UtilityButton } from '@pantheon-systems/pds-toolkit-react';
import type { MergeRequestStatus } from '@pantheon/css-client';

export interface MergeResolutionToolbarProps {
  sourceBranchName: string;
  targetBranchName: string;
  resolvedCount: number;
  totalCount: number;
  conflictCount?: number;
  allResolved: boolean;
  mergeExecuting: boolean;
  onClose: () => void;
  onExecuteMerge: () => void;
  onSetAllStrategy: (strategy: 'accept-draft' | 'accept-live') => void;
  onSetRemainingStrategy?: (strategy: 'accept-draft' | 'accept-live') => void;
  mergeRequest?: { id: string; status: MergeRequestStatus; title: string } | null;
  mergeRequestCreating?: boolean;
  mergeRequestError?: string | null;
  onCreateMergeRequest?: () => void;
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

  const handleExecuteClick = () => {
    if (showConfirm) {
      onExecuteMerge();
      setShowConfirm(false);
    } else {
      setShowConfirm(true);
    }
  };

  return (
    <div className={baseClass}>
      <div className={`${baseClass}__left`}>
        <IconButton
          ariaLabel="Close"
          iconName="xmark"
          size="s"
          hasTooltip={false}
          hasBorder={false}
          onClick={onClose}
        />
        <span className={`${baseClass}__branch-label`}>
          Draft ({sourceBranchName}) {'\u2192'} {targetBranchName}
        </span>
      </div>

      <div className={`${baseClass}__center`}>
        <span className={`${baseClass}__progress`}>
          {conflictCount != null && conflictCount > 0
            ? `${conflictCount - (totalCount - resolvedCount)} of ${conflictCount} conflicts resolved`
            : `${totalCount} documents`}
          {conflictCount != null && totalCount > conflictCount && (
            <span className={`${baseClass}__progress-auto`}>
              {' '}
              ({totalCount - conflictCount} auto-merged)
            </span>
          )}
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
        <div className="pds-utility-button-group">
          <UtilityButton
            label="Accept all from Draft"
            onClick={() => onSetAllStrategy('accept-draft')}
          />
          <UtilityButton
            label="Accept all from Live"
            onClick={() => onSetAllStrategy('accept-live')}
          />
          {onSetRemainingStrategy && (
            <>
              <UtilityButton
                label="Accept remaining from Draft"
                onClick={() => onSetRemainingStrategy('accept-draft')}
              />
              <UtilityButton
                label="Accept remaining from Live"
                onClick={() => onSetRemainingStrategy('accept-live')}
              />
            </>
          )}
          <span className="pds-utility-button-group__separator" />
          <UtilityButton
            label="Keyboard shortcuts"
            iconName="command"
            onClick={() => setShowShortcuts(!showShortcuts)}
            buttonProps={{ 'aria-expanded': showShortcuts } as React.ButtonHTMLAttributes<HTMLButtonElement>}
          />
        </div>

        {mergeRequestError && <span className={`${baseClass}__mr-error`}>{mergeRequestError}</span>}

        {!mergeRequest && onCreateMergeRequest && (
          <button
            type="button"
            className="pds-button pds-button--sm"
            disabled={!allResolved || mergeRequestCreating}
            onClick={onCreateMergeRequest}
          >
            {mergeRequestCreating ? 'Creating\u2026' : 'Create merge request'}
          </button>
        )}

        {mergeRequest && mergeRequest.status === 'open' && onApproveMergeRequest && (
          <button
            type="button"
            className="pds-button pds-button--sm"
            onClick={onApproveMergeRequest}
          >
            Approve merge request
          </button>
        )}

        {mergeRequest &&
          (mergeRequest.status === 'approved' || mergeRequest.status === 'conflicted') && (
            <>
              {showConfirm ? (
                <span className={`${baseClass}__confirm`}>
                  <span className={`${baseClass}__confirm-text`}>Are you sure?</span>
                  <button
                    type="button"
                    className={`pds-button pds-button--sm ${baseClass}__confirm-button`}
                    onClick={handleExecuteClick}
                    disabled={mergeExecuting}
                  >
                    {mergeExecuting ? 'Merging\u2026' : 'Confirm merge'}
                  </button>
                  <button
                    type="button"
                    className="pds-button pds-button--secondary pds-button--sm"
                    onClick={() => setShowConfirm(false)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="pds-button pds-button--sm"
                  disabled={mergeExecuting}
                  onClick={handleExecuteClick}
                >
                  {mergeExecuting ? 'Merging\u2026' : 'Execute merge'}
                </button>
              )}
            </>
          )}

        {mergeRequest && mergeRequest.status === 'merged' && (
          <span className="pds-status-badge pds-status-badge--neutral">
            <span className="pds-status-badge__status pds-status-badge__status--success">
              <span className="visually-hidden">Status: merged</span>
            </span>
            <span className="pds-status-badge__label">Merged</span>
          </span>
        )}
      </div>

      {showShortcuts && (
        <div className={`${baseClass}__shortcuts`} data-testid="keyboard-shortcuts">
          <dl className={`${baseClass}__shortcuts-list`}>
            <dt>J / ArrowDown</dt>
            <dd>Next document</dd>
            <dt>K / ArrowUp</dt>
            <dd>Previous document</dd>
            <dt>N</dt>
            <dd>Next unresolved</dd>
            <dt>1 / 2 / 3</dt>
            <dd>Accept Draft / Live / Cherry-pick</dd>
            <dt>Shift+D</dt>
            <dd>Accept all remaining from Draft</dd>
            <dt>Shift+L</dt>
            <dd>Accept all remaining from Live</dd>
            <dt>Enter</dt>
            <dd>Toggle detail view</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
