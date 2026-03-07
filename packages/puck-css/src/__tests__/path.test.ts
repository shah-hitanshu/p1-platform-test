/**
 * Tests for toCSSPath()
 *
 * Validates URL path normalization for CSS document paths.
 */
import { describe, it, expect } from 'vitest';
import { toCSSPath } from '../utils/path';

describe('toCSSPath', () => {
  it('converts "/" to "home"', () => {
    expect(toCSSPath('/')).toBe('home');
  });

  it('converts "/about" to "about"', () => {
    expect(toCSSPath('/about')).toBe('about');
  });

  it('converts "/en/products" to "en/products"', () => {
    expect(toCSSPath('/en/products')).toBe('en/products');
  });

  it('strips leading slashes', () => {
    expect(toCSSPath('/foo')).toBe('foo');
    expect(toCSSPath('///bar')).toBe('bar');
  });

  it('strips trailing slashes', () => {
    expect(toCSSPath('/about/')).toBe('about');
    expect(toCSSPath('/products//')).toBe('products');
  });

  it('converts empty string to "home"', () => {
    expect(toCSSPath('')).toBe('home');
  });

  it('passes through paths without leading slash', () => {
    expect(toCSSPath('about')).toBe('about');
  });

  it('converts "/a/b/c/" to "a/b/c"', () => {
    expect(toCSSPath('/a/b/c/')).toBe('a/b/c');
  });
});
