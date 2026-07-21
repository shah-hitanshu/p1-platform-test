/**
 * ComponentNode Component
 *
 * Displays a single component in the tree with diff styling.
 */

import React from 'react';
import type { ComponentDiffWithPosition } from '../../../core/types.js';

export interface ComponentNodeProps {
  /**
   * The component diff data.
   */
  diff: ComponentDiffWithPosition;

  /**
   * Whether to show position indicator.
   */
  showPosition?: boolean;

  /**
   * Whether this node is selected.
   */
  isSelected?: boolean;

  /**
   * Click handler.
   */
  onClick?: (diff: ComponentDiffWithPosition) => void;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Renders a single component node with diff styling.
 */
export function ComponentNode({
  diff,
  showPosition = false,
  isSelected = false,
  onClick,
  className = '',
}: ComponentNodeProps): React.ReactElement {
  const baseClass = 'component-node';
  const typeClass = `${baseClass}--${diff.type}`;
  const selectedClass = isSelected ? `${baseClass}--selected` : '';
  const classes = [baseClass, typeClass, selectedClass, className].filter(Boolean).join(' ');

  const handleClick = () => {
    onClick?.(diff);
  };

  // Determine position to show (prefer afterIndex, fall back to beforeIndex)
  const position = diff.afterIndex !== undefined ? diff.afterIndex + 1 : (diff.beforeIndex !== undefined ? diff.beforeIndex + 1 : null);

  // Check if this is a move (reordered or modified+reordered)
  const isMoved = diff.type === 'reordered' || diff.reordered === true;
  const moveInfo = isMoved && diff.beforeIndex !== undefined && diff.afterIndex !== undefined
    ? `moved from #${diff.beforeIndex + 1} to #${diff.afterIndex + 1}`
    : null;

  return (
    <button
      type="button"
      className={classes}
      onClick={handleClick}
      aria-pressed={isSelected}
    >
      <span className={`${baseClass}__icon`}>
        {getTypeIcon(diff.type)}
      </span>
      <span className={`${baseClass}__type`}>
        {diff.componentType}
      </span>
      {showPosition && position !== null && (
        <span className={`${baseClass}__position`}>
          #{position}
        </span>
      )}
      {showPosition && moveInfo && (
        <span className={`${baseClass}__move-info`}>
          ({moveInfo})
        </span>
      )}
    </button>
  );
}

/**
 * Gets an icon for the diff type.
 */
function getTypeIcon(type: ComponentDiffWithPosition['type']): string {
  switch (type) {
    case 'added':
      return '+';
    case 'removed':
      return '−';
    case 'modified':
      return '~';
    case 'reordered':
      return '↕';
    case 'unchanged':
    default:
      return '•';
  }
}
