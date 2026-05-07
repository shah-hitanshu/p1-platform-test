import { describe, expect, it } from 'vitest';

import { rawValueToString } from '../../data/utils';

describe('rawValueToString', () => {
  it('returns the string as-is', () => {
    expect(rawValueToString('hello')).toBe('hello');
  });

  it('converts numbers', () => {
    expect(rawValueToString(42)).toBe('42');
    expect(rawValueToString(0)).toBe('0');
    expect(rawValueToString(-1)).toBe('-1');
  });

  it('converts booleans', () => {
    expect(rawValueToString(true)).toBe('true');
    expect(rawValueToString(false)).toBe('false');
  });

  it('returns empty for null/undefined', () => {
    expect(rawValueToString(null)).toBe('');
    expect(rawValueToString(undefined)).toBe('');
  });

  it('returns empty for objects/arrays', () => {
    expect(rawValueToString({})).toBe('');
    expect(rawValueToString([])).toBe('');
    expect(rawValueToString({ key: 'value' })).toBe('');
  });
});
