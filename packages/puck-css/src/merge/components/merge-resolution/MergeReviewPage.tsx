import React, { useState, useCallback } from 'react';
import { IconButton } from '@pantheon-systems/pds-toolkit-react';
import { useCSSPuck } from '../../../core/CSSPuckContext.js';
import { MergeResolutionPage } from './MergeResolutionPage.js';

export interface MergeReviewPageProps {
  /** Puck config for rendering previews. */
  config: unknown;
  /** Called when user navigates away from the merge page. */
  onClose?: () => void;
  /** Called after a successful merge execution. */
  onMergeComplete?: () => void;
}

const baseClass = 'merge-review-page';

export function MergeReviewPage({
  config,
  onClose,
  onMergeComplete,
}: MergeReviewPageProps): React.ReactElement {
  const { client, siteId, branchId, branches, branchesLoading } = useCSSPuck();
  const [showResolveConflicts, setShowResolveConflicts] = useState(false);

  const mainBranch = branches.find((b) => b.isMain);
  const currentBranch = branches.find((b) => b.id === branchId);
  const isMainBranch = currentBranch?.isMain ?? false;

  const targetBranchId = mainBranch?.id ?? '';
  const sourceBranchName = currentBranch?.name ?? '';
  const targetBranchName = 'Live';

  const canReview =
    !branchesLoading && !isMainBranch && !!targetBranchId && branchId !== targetBranchId;

  const handleMergeComplete = useCallback(() => {
    setShowResolveConflicts(false);
    onMergeComplete?.();
  }, [onMergeComplete]);

  if (showResolveConflicts && canReview) {
    return (
      <MergeResolutionPage
        client={client}
        siteId={siteId}
        sourceBranchId={branchId}
        targetBranchId={targetBranchId}
        sourceBranchName={sourceBranchName}
        targetBranchName={targetBranchName}
        config={config}
        onClose={() => setShowResolveConflicts(false)}
        onMergeComplete={handleMergeComplete}
      />
    );
  }

  return (
    <div className={baseClass}>
      <header className={`${baseClass}__header`}>
        <div className={`${baseClass}__header-leading`}>
          {onClose && (
            <IconButton
              ariaLabel="Close"
              iconName="xmark"
              size="s"
              hasTooltip={false}
              hasBorder={false}
              onClick={onClose}
            />
          )}
          <h2 className={`${baseClass}__title`}>Merge review</h2>
        </div>
      </header>

      <div className={`${baseClass}__body`}>
        {isMainBranch ? (
          <p className={`${baseClass}__message`}>
            Switch to a workstream to review and merge changes.
          </p>
        ) : (
          <div className={`${baseClass}__branch-selectors`}>
            <div className={`${baseClass}__branch-field`}>
              <span className={`${baseClass}__label`}>Draft</span>
              <div className={`${baseClass}__branch-display`}>
                {branchesLoading ? '…' : sourceBranchName}
              </div>
            </div>

            <span className={`${baseClass}__arrow`}>{'\u2192'}</span>

            <div className={`${baseClass}__branch-field`}>
              <span className={`${baseClass}__label`}>Live</span>
              <div className={`${baseClass}__branch-display ${baseClass}__branch-display--target`}>
                {targetBranchName}
              </div>
            </div>

            <button
              type="button"
              className="pds-button pds-button--sm"
              disabled={!canReview}
              onClick={() => setShowResolveConflicts(true)}
            >
              {branchesLoading ? 'Loading…' : 'Review and merge'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
