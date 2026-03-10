/**
 * BranchDiffHeader Component
 *
 * Header bar for branch merge comparison showing branch names
 * instead of version numbers, along with change count summary.
 */

import React from 'react';

/**
 * Props for the BranchDiffHeader component.
 */
export interface BranchDiffHeaderProps {
  /**
   * Name of the source branch.
   */
  sourceBranchName: string;

  /**
   * Name of the target branch.
   */
  targetBranchName: string;

  /**
   * Number of added components.
   */
  added?: number;

  /**
   * Number of removed components.
   */
  removed?: number;

  /**
   * Number of modified components.
   */
  modified?: number;

  /**
   * Number of reordered components.
   */
  reordered?: number;

  /**
   * Callback when close button is clicked.
   */
  onClose: () => void;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Renders a header bar for branch merge comparison with branch names
 * and change count summary.
 *
 * @param props - {@link BranchDiffHeaderProps}
 * @returns A React element containing branch labels, change badges, and a close button.
 */
export function BranchDiffHeader({
  sourceBranchName,
  targetBranchName,
  added = 0,
  removed = 0,
  modified = 0,
  reordered = 0,
  onClose,
  className = '',
}: BranchDiffHeaderProps): React.ReactElement {
  const baseClass = 'branch-diff-header';
  const classes = [baseClass, className].filter(Boolean).join(' ');

  const hasChanges = added > 0 || removed > 0 || modified > 0 || reordered > 0;

  return (
    <header className={classes}>
      <div className={`${baseClass}__branches`}>
        <span className={`${baseClass}__branch ${baseClass}__branch--source`}>
          {sourceBranchName}
        </span>
        <span className={`${baseClass}__arrow`}>→</span>
        <span className={`${baseClass}__branch ${baseClass}__branch--target`}>
          {targetBranchName}
        </span>
      </div>

      {hasChanges && (
        <div className={`${baseClass}__summary`}>
          {added > 0 && (
            <span className={`${baseClass}__stat ${baseClass}__stat--added`}>
              +{added}
            </span>
          )}
          {removed > 0 && (
            <span className={`${baseClass}__stat ${baseClass}__stat--removed`}>
              -{removed}
            </span>
          )}
          {modified > 0 && (
            <span className={`${baseClass}__stat ${baseClass}__stat--modified`}>
              ~{modified}
            </span>
          )}
          {reordered > 0 && (
            <span className={`${baseClass}__stat ${baseClass}__stat--reordered`}>
              ↕{reordered}
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        className={`pds-button pds-button--subtle pds-button--sm ${baseClass}__close`}
        onClick={onClose}
        aria-label="Close comparison"
      >
        ×
      </button>
    </header>
  );
}
