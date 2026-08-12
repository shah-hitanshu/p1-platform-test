import { useRef, useLayoutEffect } from 'react';

const SIDEBAR_SELECTOR = '[class*="_Sidebar--right_"]';

/**
 * Keeps the inspector sidebar's scroll position across re-renders that rebuild
 * the field list (collapsing a section, switching a block's view mode), which
 * otherwise snap it back to the top.
 *
 * Selecting a different block deliberately does not restore — a new block
 * starts at the top rather than inheriting the previous one's offset.
 */
export function useSidebarScrollPreservation(
  itemSelector: unknown,
  containerSelector: string = SIDEBAR_SELECTOR,
): void {
  const savedScrollRef = useRef(0);
  const prevSelectorKeyRef = useRef<string>('');

  const container =
    typeof document === 'undefined'
      ? null
      : document.querySelector<HTMLElement>(containerSelector);

  const selectorKey = itemSelector ? JSON.stringify(itemSelector) : '';
  const selectionChanged = selectorKey !== prevSelectorKeyRef.current;

  // Captured during render, which runs before React commits DOM changes, so this
  // is always the live pre-update offset. Reading it from a `scroll` listener
  // instead would leave it stale whenever a background re-render (presence,
  // document sync) landed before the event dispatched.
  if (container && !selectionChanged) {
    savedScrollRef.current = container.scrollTop;
  }

  useLayoutEffect(() => {
    if (selectionChanged) {
      prevSelectorKeyRef.current = selectorKey;
      savedScrollRef.current = 0;
      return;
    }
    // Restore only when the commit actually reset the scroll. Writing on any
    // mismatch would yank the user mid-scroll on unrelated re-renders.
    if (container && container.scrollTop === 0 && savedScrollRef.current > 0) {
      container.scrollTop = savedScrollRef.current;
    }
  });
}
