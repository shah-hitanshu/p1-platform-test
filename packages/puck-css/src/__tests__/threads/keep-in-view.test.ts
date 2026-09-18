import { describe, expect, it } from 'vitest';

import { shiftIntoView } from '../../features/threads/use-keep-in-view.js';

describe('shiftIntoView', () => {
  it('leaves a panel alone when it already fits', () => {
    expect(shiftIntoView(100, 300, 800)).toBe(0);
  });

  it('moves a panel up until its bottom clears the viewport', () => {
    expect(shiftIntoView(600, 300, 800)).toBe(800 - 8 - 300 - 600);
  });

  it('moves a panel down until its top clears the viewport', () => {
    expect(shiftIntoView(-40, 300, 800)).toBe(48);
  });

  it('keeps the top in view when the panel is taller than the viewport', () => {
    expect(shiftIntoView(200, 900, 800)).toBe(8 - 200);
  });

  it('expresses the shift in the panel\'s own pixels when it is drawn scaled', () => {
    expect(shiftIntoView(600, 300, 800, 2)).toBe((800 - 8 - 300 - 600) / 2);
  });
});
