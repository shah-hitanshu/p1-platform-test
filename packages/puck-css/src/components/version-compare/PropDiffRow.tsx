/**
 * PropDiffRow Component
 *
 * Displays a single prop difference with before/after values.
 */

import React from 'react';
import type { PropDiff } from '../../types.js';
import { PropValueDisplay } from './PropValueDisplay.js';

export interface PropDiffRowProps {
  /**
   * The prop diff to display.
   */
  diff: PropDiff;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Renders a single row showing a prop change.
 */
export function PropDiffRow({
  diff,
  className = '',
}: PropDiffRowProps): React.ReactElement {
  const baseClass = 'prop-diff-row';
  const typeClass = `${baseClass}--${diff.type}`;
  const classes = [baseClass, typeClass, className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className={`${baseClass}__name`}>
        {diff.propName}
      </div>
      <div className={`${baseClass}__values`}>
        <div className={`${baseClass}__before`}>
          {diff.type === 'added' ? (
            <span className={`${baseClass}__empty`}>—</span>
          ) : (
            <PropValueDisplay value={diff.before} diffType="removed" />
          )}
        </div>
        <div className={`${baseClass}__arrow`}>→</div>
        <div className={`${baseClass}__after`}>
          {diff.type === 'removed' ? (
            <span className={`${baseClass}__empty`}>—</span>
          ) : (
            <PropValueDisplay value={diff.after} diffType="added" />
          )}
        </div>
      </div>
    </div>
  );
}
