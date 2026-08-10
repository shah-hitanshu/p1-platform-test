import React from 'react';

export interface DragHandlers {
  draggable: true;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function useDragReorder<T>({
  getId,
  onReorder,
}: {
  getId: (item: T) => string;
  onReorder: (source: T, target: T) => void;
}): { dropTargetId: string | null; getDragHandlers: (item: T) => DragHandlers } {
  const [dragging, setDragging] = React.useState<T | null>(null);
  const [dropTargetId, setDropTargetId] = React.useState<string | null>(null);

  const endDrag = () => {
    setDragging(null);
    setDropTargetId(null);
  };

  const getDragHandlers = (item: T): DragHandlers => ({
    draggable: true,
    onDragStart: (e) => {
      setDragging(item);
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', getId(item));
      } catch {
        /* older browsers throw on setData during dragstart */
      }
    },
    onDragEnd: endDrag,
    onDragOver: (e) => {
      e.preventDefault();
      setDropTargetId(getId(item));
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dragging) onReorder(dragging, item);
      endDrag();
    },
  });

  return { dropTargetId, getDragHandlers };
}
