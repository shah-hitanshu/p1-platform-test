import React from 'react';
import type { DragHandlers } from './useDragReorder.js';
import styles from './OutlinePanel.module.css';

/** Indent per nesting level, matching the prototype's nested container rows. */
const INDENT_PX = 24;
const BASE_INDENT = 10;

interface DraggableRowProps {
  depth: number;
  isSelected: boolean;
  isDropTarget: boolean;
  onSelect: () => void;
  dragHandlers: DragHandlers;
  children: React.ReactNode;
}

export function DraggableRow({
  depth,
  isSelected,
  isDropTarget,
  onSelect,
  dragHandlers,
  children,
}: DraggableRowProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      {...dragHandlers}
      aria-current={isSelected ? 'true' : undefined}
      className={[
        styles.row,
        isSelected ? styles.rowSelected : '',
        isDropTarget ? styles.rowDropTarget : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: BASE_INDENT + depth * INDENT_PX }}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {children}
    </div>
  );
}
