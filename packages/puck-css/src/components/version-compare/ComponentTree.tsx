/**
 * ComponentTree Component
 *
 * Displays a tree of components for one side of the comparison.
 */

import React from 'react';
import type { ComponentDiffWithPosition } from '../../types.js';
import { ComponentNode } from './ComponentNode.js';

export interface ComponentTreeProps {
  /**
   * Array of component diffs.
   */
  diffs: ComponentDiffWithPosition[];

  /**
   * Which side of the comparison this tree represents.
   */
  side: 'before' | 'after';

  /**
   * Currently selected component ID.
   */
  selectedComponentId?: string;

  /**
   * Callback when a component is selected.
   */
  onSelectComponent?: (diff: ComponentDiffWithPosition) => void;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Filters and sorts diffs for the given side.
 */
function getComponentsForSide(
  diffs: ComponentDiffWithPosition[],
  side: 'before' | 'after'
): ComponentDiffWithPosition[] {
  // Filter out components that don't exist on this side
  const filtered = diffs.filter((diff) => {
    if (side === 'before') {
      // Don't show added components on the before side
      return diff.type !== 'added';
    } else {
      // Don't show removed components on the after side
      return diff.type !== 'removed';
    }
  });

  // Sort by position
  return filtered.sort((a, b) => {
    const indexA = side === 'before' ? a.beforeIndex : a.afterIndex;
    const indexB = side === 'before' ? b.beforeIndex : b.afterIndex;
    return (indexA ?? 0) - (indexB ?? 0);
  });
}

/**
 * Renders a tree of components for one side of the comparison.
 */
export function ComponentTree({
  diffs,
  side,
  selectedComponentId,
  onSelectComponent,
  className = '',
}: ComponentTreeProps): React.ReactElement {
  const baseClass = 'component-tree';
  const classes = [baseClass, className].filter(Boolean).join(' ');

  const components = getComponentsForSide(diffs, side);
  const isEmpty = components.length === 0;

  return (
    <div className={classes}>
      <div className={`${baseClass}__header`}>
        <span className={`${baseClass}__title`}>
          {side === 'before' ? 'Before' : 'After'}
        </span>
        <span className={`${baseClass}__count`}>
          {components.length} components
        </span>
      </div>

      <div className={`${baseClass}__content`}>
        {isEmpty ? (
          <div className={`${baseClass}__empty`}>
            No components
          </div>
        ) : (
          <div className={`${baseClass}__nodes`}>
            {components.map((diff) => (
              <ComponentNode
                key={diff.componentId}
                diff={diff}
                showPosition
                isSelected={diff.componentId === selectedComponentId}
                onClick={onSelectComponent}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
