import { useLayoutEffect, type RefObject } from 'react';

/** Room left between the panel and the edge of the viewport, in screen pixels. */
export const VIEW_MARGIN_PX = 8;

/** The custom property the panel reads its vertical shift from. */
export const SHIFT_PROPERTY = '--p1-thread-shift';

/**
 * How far to move a panel, in its own CSS pixels, so that it stays inside the window
 * it is drawn in. The panel's natural top is where it would sit unshifted; a panel
 * taller than the window keeps its top in view and lets its bottom go.
 */
export function shiftIntoView(
  naturalTop: number,
  height: number,
  viewportHeight: number,
  scale = 1,
  margin = VIEW_MARGIN_PX,
): number {
  const lowest = Math.max(margin, viewportHeight - margin - height);
  const top = Math.min(Math.max(naturalTop, margin), lowest);
  return (top - naturalTop) / scale;
}

/**
 * Keeps an absolutely placed panel inside its window's viewport by writing the shift it
 * needs to a custom property on the element. Written straight to the DOM so a panel
 * riding along with a scroll never re-renders. The intersection observer catches the
 * moves nothing else reports, such as content above the panel reflowing.
 */
export function useKeepInView(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const panel = ref.current;
    const win = panel?.ownerDocument.defaultView;
    if (!panel || !win) return;

    let applied = 0;
    const place = () => {
      const rect = panel.getBoundingClientRect();
      const scale = panel.offsetHeight > 0 ? rect.height / panel.offsetHeight : 1;
      const naturalTop = rect.top - applied * scale;
      const next = shiftIntoView(naturalTop, rect.height, win.innerHeight, scale);
      if (Math.abs(next - applied) < 0.5) return;
      applied = next;
      panel.style.setProperty(SHIFT_PROPERTY, `${next}px`);
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof win.Node && panel.contains(event.target)) return;
      place();
    };

    place();
    win.addEventListener('scroll', onScroll, { capture: true, passive: true });
    win.addEventListener('resize', place);
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    resized?.observe(panel);
    const uncovered =
      typeof IntersectionObserver === 'function' ? new IntersectionObserver(place, { threshold: 1 }) : null;
    uncovered?.observe(panel);
    return () => {
      win.removeEventListener('scroll', onScroll, { capture: true });
      win.removeEventListener('resize', place);
      resized?.disconnect();
      uncovered?.disconnect();
      panel.style.removeProperty(SHIFT_PROPERTY);
    };
  }, [ref]);
}
