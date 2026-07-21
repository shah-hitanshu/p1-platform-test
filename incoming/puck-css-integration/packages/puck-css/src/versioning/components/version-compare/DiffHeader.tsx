/**
 * DiffHeader Component
 *
 * Header bar for the version comparison view showing versions and summary.
 */

import React from 'react';

export interface DiffHeaderProps {
  /**
   * The before version number.
   */
  beforeVersion: number;

  /**
   * The after version number.
   */
  afterVersion: number;

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
 * Renders a header bar for the version comparison view.
 */
export function DiffHeader({
  beforeVersion,
  afterVersion,
  added = 0,
  removed = 0,
  modified = 0,
  reordered = 0,
  onClose,
  className = '',
}: DiffHeaderProps): React.ReactElement {
  const baseClass = 'diff-header';
  const classes = [baseClass, className].filter(Boolean).join(' ');

  const hasChanges = added > 0 || removed > 0 || modified > 0 || reordered > 0;

  return (
    <header className={classes}>
      <div className={`${baseClass}__versions`}>
        <span className={`${baseClass}__version ${baseClass}__version--before`}>
          v{beforeVersion}
        </span>
        <span className={`${baseClass}__arrow`}>→</span>
        <span className={`${baseClass}__version ${baseClass}__version--after`}>
          v{afterVersion}
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
