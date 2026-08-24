import type { CSSProperties } from 'react';

/**
 * Hides an element from view while leaving it in the accessibility tree. Clipped rather than
 * `display: none` or `visibility: hidden`, which remove it from assistive tech as well.
 */
export const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
