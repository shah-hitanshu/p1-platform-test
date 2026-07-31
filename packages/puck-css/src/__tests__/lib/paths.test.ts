import { describe, expect, it } from 'vitest';

import {
  isUnsafeKey,
  isComponentNode,
  stripTrailingSlash,
  PATH_REGEX,
  isReservedPath,
  normalizePath,
} from '../../data/paths';

describe('isUnsafeKey', () => {
  it('rejects prototype-pollution keys', () => {
    expect(isUnsafeKey('__proto__')).toBe(true);
    expect(isUnsafeKey('constructor')).toBe(true);
    expect(isUnsafeKey('prototype')).toBe(true);
  });

  it('allows normal keys', () => {
    expect(isUnsafeKey('title')).toBe(false);
    expect(isUnsafeKey('id')).toBe(false);
    expect(isUnsafeKey('')).toBe(false);
  });
});

describe('isComponentNode', () => {
  it('returns true for valid component nodes', () => {
    expect(isComponentNode({ type: 'Text', props: { id: '1' } })).toBe(true);
  });

  it('returns false for non-objects', () => {
    expect(isComponentNode(null)).toBe(false);
    expect(isComponentNode(undefined)).toBe(false);
    expect(isComponentNode('string')).toBe(false);
    expect(isComponentNode(42)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isComponentNode([{ type: 'X', props: {} }])).toBe(false);
  });

  it('returns false when type is not a string', () => {
    expect(isComponentNode({ type: 123, props: {} })).toBe(false);
  });

  it('returns false when props is not an object', () => {
    expect(isComponentNode({ type: 'X', props: null })).toBe(false);
    expect(isComponentNode({ type: 'X', props: 'nope' })).toBe(false);
  });
});

describe('stripTrailingSlash', () => {
  it('removes trailing slash', () => {
    expect(stripTrailingSlash('/about/')).toBe('/about');
  });

  it('preserves root path', () => {
    expect(stripTrailingSlash('/')).toBe('/');
  });

  it('defaults empty to /', () => {
    expect(stripTrailingSlash('')).toBe('/');
  });

  it('leaves non-trailing-slash paths alone', () => {
    expect(stripTrailingSlash('/about')).toBe('/about');
  });
});

describe('PATH_REGEX', () => {
  it('matches valid paths', () => {
    expect(PATH_REGEX.test('/about')).toBe(true);
    expect(PATH_REGEX.test('/jedi/1')).toBe(true);
    expect(PATH_REGEX.test('/test/:a/:b')).toBe(true);
    expect(PATH_REGEX.test('/a-b_c.d')).toBe(true);
  });

  it('rejects invalid paths', () => {
    expect(PATH_REGEX.test('/')).toBe(false);
    expect(PATH_REGEX.test('')).toBe(false);
    expect(PATH_REGEX.test('about')).toBe(false);
    expect(PATH_REGEX.test('/about?q=1')).toBe(false);
  });
});

describe('isReservedPath', () => {
  it('detects reserved prefixes', () => {
    expect(isReservedPath('/p1')).toBe(true);
    expect(isReservedPath('/p1/edit')).toBe(true);
    expect(isReservedPath('/puck')).toBe(true);
    expect(isReservedPath('/_next')).toBe(true);
  });

  it('allows non-reserved paths', () => {
    expect(isReservedPath('/about')).toBe(false);
    expect(isReservedPath('/contact')).toBe(false);
    expect(isReservedPath('/structure')).toBe(false);
  });
});

describe('normalizePath', () => {
  it('normalizes valid paths', () => {
    expect(normalizePath('/about/')).toBe('/about');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('  /contact  ')).toBe('/contact');
  });

  it('returns null for reserved paths', () => {
    expect(normalizePath('/p1/edit')).toBeNull();
    expect(normalizePath('/_next/data')).toBeNull();
  });

  it('normalizes non-string inputs to root', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath(42)).toBe('/');
    expect(normalizePath(null)).toBe('/');
  });
});
