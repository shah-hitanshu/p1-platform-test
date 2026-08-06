/**
 * Tests for getAvatarColor.
 *
 * The guard matters because this runs during render: hashString reads
 * `str.length`, so a missing id would throw and take the whole avatar stack
 * down rather than degrading to a default colour.
 */

import { describe, it, expect } from 'vitest';
import { getAvatarColor } from './avatarColor.js';

describe('getAvatarColor', () => {
  it('returns a stable colour per id and never throws on a missing one', () => {
    expect(getAvatarColor('user-1')).toBe(getAvatarColor('user-1'));
    expect(getAvatarColor('user-1')).toMatch(/^hsl\(\d+, 65%, 45%\)$/);

    expect(() => getAvatarColor(undefined as unknown as string)).not.toThrow();
    expect(() => getAvatarColor(null as unknown as string)).not.toThrow();
    expect(getAvatarColor('')).toMatch(/^hsl\(\d+, 65%, 45%\)$/);
  });
});
