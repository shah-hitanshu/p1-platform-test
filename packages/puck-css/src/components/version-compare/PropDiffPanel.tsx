/**
 * PropDiffPanel Component
 *
 * Displays a panel showing all prop changes for a component.
 */

import React from 'react';
import type { PropDiff } from '../../types.js';
import { PropDiffRow } from './PropDiffRow.js';

export interface PropDiffPanelProps {
  /**
   * Component type name.
   */
  componentType: string;

  /**
   * Component ID.
   */
  componentId: string;

  /**
   * Array of prop diffs to display.
   */
  diffs: PropDiff[];

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Counts prop diffs by type.
 */
function countPropDiffs(diffs: PropDiff[]): {
  added: number;
  removed: number;
  modified: number;
} {
  const counts = { added: 0, removed: 0, modified: 0 };
  for (const diff of diffs) {
    counts[diff.type]++;
  }
  return counts;
}

/**
 * Renders a panel showing all prop changes for a component.
 */
export function PropDiffPanel({
  componentType,
  componentId,
  diffs,
  className = '',
}: PropDiffPanelProps): React.ReactElement {
  const baseClass = 'prop-diff-panel';
  const classes = [baseClass, className].filter(Boolean).join(' ');

  const counts = countPropDiffs(diffs);
  const hasDiffs = diffs.length > 0;

  // Build summary parts
  const summaryParts: string[] = [];
  if (counts.added > 0) {
    summaryParts.push(`${counts.added} added`);
  }
  if (counts.removed > 0) {
    summaryParts.push(`${counts.removed} removed`);
  }
  if (counts.modified > 0) {
    summaryParts.push(`${counts.modified} modified`);
  }

  return (
    <div className={classes}>
      <div className={`${baseClass}__header`}>
        <span className={`${baseClass}__type`}>{componentType}</span>
        <span className={`${baseClass}__id`}>{componentId}</span>
      </div>

      {hasDiffs && (
        <div className={`${baseClass}__summary`}>
          {summaryParts.join(', ')}
        </div>
      )}

      <div className={`${baseClass}__content`}>
        {hasDiffs ? (
          <div className={`${baseClass}__rows`}>
            {diffs.map((diff) => (
              <PropDiffRow key={diff.propName} diff={diff} />
            ))}
          </div>
        ) : (
          <div className={`${baseClass}__empty`}>
            No prop changes
          </div>
        )}
      </div>
    </div>
  );
}
