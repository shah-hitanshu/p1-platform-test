import { describe, expect, it } from 'vitest';

import { toText, TEMPLATE_FUNCTIONS } from '../../data/template-functions';

describe('toText', () => {
  it('converts strings', () => {
    expect(toText('hello')).toBe('hello');
  });

  it('converts numbers', () => {
    expect(toText(42)).toBe('42');
    expect(toText(0)).toBe('0');
  });

  it('converts booleans', () => {
    expect(toText(true)).toBe('true');
    expect(toText(false)).toBe('false');
  });

  it('returns empty for null/undefined', () => {
    expect(toText(null)).toBe('');
    expect(toText(undefined)).toBe('');
  });

  it('returns empty for objects/arrays', () => {
    expect(toText({})).toBe('');
    expect(toText([])).toBe('');
  });
});

describe('TEMPLATE_FUNCTIONS', () => {
  it('trim removes whitespace', () => {
    expect(TEMPLATE_FUNCTIONS.trim(['  hello  '])).toBe('hello');
  });

  it('toLowerCase converts to lowercase', () => {
    expect(TEMPLATE_FUNCTIONS.toLowerCase(['HELLO'])).toBe('hello');
  });

  it('toUpperCase converts to uppercase', () => {
    expect(TEMPLATE_FUNCTIONS.toUpperCase(['hello'])).toBe('HELLO');
  });

  it('slice extracts substring by indices', () => {
    expect(TEMPLATE_FUNCTIONS.slice(['hello', 1, 3])).toBe('el');
    expect(TEMPLATE_FUNCTIONS.slice(['hello', 0])).toBe('hello');
  });

  it('slice returns empty for invalid start', () => {
    expect(TEMPLATE_FUNCTIONS.slice(['hello', 'invalid'])).toBe('');
  });

  it('substring extracts substring', () => {
    expect(TEMPLATE_FUNCTIONS.substring(['hello', 1, 3])).toBe('el');
  });

  it('replace replaces first occurrence', () => {
    expect(TEMPLATE_FUNCTIONS.replace(['hello world', 'world', 'earth'])).toBe('hello earth');
  });

  it('replace returns empty for non-string args', () => {
    expect(TEMPLATE_FUNCTIONS.replace(['hello', 42, 'x'])).toBe('');
  });

  it('replaceAll replaces all occurrences', () => {
    expect(TEMPLATE_FUNCTIONS.replaceAll(['aaa', 'a', 'b'])).toBe('bbb');
  });

  it('padStart pads to length', () => {
    expect(TEMPLATE_FUNCTIONS.padStart(['5', 3, '0'])).toBe('005');
  });

  it('padEnd pads to length', () => {
    expect(TEMPLATE_FUNCTIONS.padEnd(['5', 3, '0'])).toBe('500');
  });

  it('default uses fallback for empty/null', () => {
    expect(TEMPLATE_FUNCTIONS.default([null, 'fallback'])).toBe('fallback');
    expect(TEMPLATE_FUNCTIONS.default(['', 'fallback'])).toBe('fallback');
    expect(TEMPLATE_FUNCTIONS.default(['value', 'fallback'])).toBe('value');
  });

  it('truncate respects max length', () => {
    expect(TEMPLATE_FUNCTIONS.truncate(['hello world', 5])).toBe('he...');
    expect(TEMPLATE_FUNCTIONS.truncate(['hi', 5])).toBe('hi');
  });

  it('truncate uses custom suffix', () => {
    expect(TEMPLATE_FUNCTIONS.truncate(['hello world', 6, '…'])).toBe('hello…');
  });

  it('truncate returns empty for invalid maxLen', () => {
    expect(TEMPLATE_FUNCTIONS.truncate(['hello', 'invalid'])).toBe('');
  });
});
