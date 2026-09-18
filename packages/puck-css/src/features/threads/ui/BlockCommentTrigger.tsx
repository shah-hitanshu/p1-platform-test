import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createUsePuck } from '@puckeditor/core';

import { useBlockSubject } from '../use-block-subject.js';
import { CommentTrigger } from './CommentTrigger.js';
import styles from './BlockCommentTrigger.module.css';

export interface BlockCommentTriggerProps {
  /** The Puck component id of the block being discussed. */
  blockId: string;
}

/**
 * How much the canvas is scaled down to fit the editor, or 1 when it is not scaled.
 *
 * Everything drawn over the canvas is scaled with the content, which leaves a control
 * sized for reading too small to read. Measuring the frame gives the factor to undo.
 */
function canvasFrame(el: HTMLElement): HTMLElement | null {
  return el.ownerDocument.defaultView?.frameElement as HTMLElement | null;
}

function canvasScale(frame: HTMLElement | null): number {
  return frame?.offsetWidth ? frame.getBoundingClientRect().width / frame.offsetWidth : 1;
}

/** Re-measures whenever the frame is laid out again: a pane resize, a zoom change. */
function watchScale(frame: HTMLElement | null, onScale: (scale: number) => void): () => void {
  onScale(canvasScale(frame));
  const Observer = frame?.ownerDocument.defaultView?.ResizeObserver;
  if (!frame || !Observer) return () => {};
  const observer = new Observer(() => onScale(canvasScale(frame)));
  observer.observe(frame);
  return () => observer.disconnect();
}

const usePuckSelection = createUsePuck();

/** Whether the editor has this block selected, and so is drawing its action bar. */
function useBlockSelected(blockId: string): boolean {
  return usePuckSelection((s) => {
    const selected = (s as { selectedItem?: { props?: { id?: string } } | null }).selectedItem;
    return selected?.props?.id === blockId;
  }) as boolean;
}

function hover(block: HTMLElement, hovered: boolean): void {
  block.dispatchEvent(new MouseEvent(hovered ? 'mouseover' : 'mouseout', { bubbles: true }));
}

/**
 * The comment trigger for one block, pinned to the block's top right corner.
 *
 * The thread and its message count are not wired yet: until threads are stored,
 * every block reads as having none.
 */
export function BlockCommentTrigger({ blockId }: BlockCommentTriggerProps): React.ReactElement {
  const anchorRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLElement | null>(null);
  const threadOpen = useRef(false);
  const [scale, setScale] = useState(1);
  const selected = useBlockSelected(blockId);
  const subject = useBlockSubject(blockId);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const block = anchor?.ownerDocument.querySelector<HTMLElement>(
      `[data-puck-component="${blockId}"]`,
    );
    if (!anchor || !block) return;

    blockRef.current = block;
    const stopWatchingScale = watchScale(canvasFrame(anchor), setScale);

    // The editor draws this overlay for as long as the block reads as hovered, and reads
    // that from mouseover and mouseout on the block itself — but the overlay is drawn
    // outside the block, so a pointer arriving here reads as one leaving. Handing the
    // block the hover it would have had keeps the overlay open instead of closing it and
    // reopening it under the pointer.
    const followPointer = (e: MouseEvent) => {
      const to = e.relatedTarget as Node | null;
      const stillOverBlock = e.type === 'mouseover' || anchor.contains(to) || block.contains(to);
      hover(block, stillOverBlock);
    };

    // An open thread outlives the pointer, so the block has to stay hovered for it: the
    // overlay is what the thread is drawn in, and the editor takes the overlay away the
    // moment the block stops reading as hovered. This listener is added after the
    // editor's own, so handing the hover straight back lands in the same render.
    const holdHover = () => {
      if (threadOpen.current) hover(block, true);
    };

    anchor.addEventListener('mouseover', followPointer);
    anchor.addEventListener('mouseout', followPointer);
    block.addEventListener('mouseout', holdHover);
    return () => {
      stopWatchingScale();
      anchor.removeEventListener('mouseover', followPointer);
      anchor.removeEventListener('mouseout', followPointer);
      block.removeEventListener('mouseout', holdHover);
    };
  }, [blockId]);

  const onOpenChange = useCallback((open: boolean) => {
    threadOpen.current = open;
    const block = blockRef.current;
    if (!open && block && !block.matches(':hover')) hover(block, false);

    // An overlay has no stacking order of its own, so a thread reaching past its own
    // block is painted over by the next block's overlay — and by the layers inside it,
    // which stack against ours rather than within their own overlay. Clearing those
    // takes a value above the highest of them.
    const overlay = anchorRef.current?.closest<HTMLElement>('[data-puck-overlay]');
    if (overlay) overlay.style.zIndex = open ? '3' : '';
  }, []);

  return (
    <div
      ref={anchorRef}
      className={selected ? `${styles.anchor} ${styles.belowActionBar}` : styles.anchor}
      style={{ transform: `scale(${1 / scale})`, '--p1-trigger-scale': 1 / scale } as React.CSSProperties}
    >
      <CommentTrigger
        contextType="block"
        contextId={blockId}
        subject={subject}
        onOpenChange={onOpenChange}
      />
    </div>
  );
}
