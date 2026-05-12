/**
 * Tests for toP1Path()
 *
 * Validates URL path normalization for P1 document paths.
 */
import { describe, it, expect } from 'vitest';
import { toP1Path } from '../editor/utils/path';

describe('toP1Path', () => {
  it('converts "/" to "home"', () => {
    expect(toP1Path('/')).toBe('home');
  });

  it('converts "/about" to "about"', () => {
    expect(toP1Path('/about')).toBe('about');
  });

  it('converts "/en/products" to "en/products"', () => {
    expect(toP1Path('/en/products')).toBe('en/products');
  });

  it('strips leading slashes', () => {
    expect(toP1Path('/foo')).toBe('foo');
    expect(toP1Path('///bar')).toBe('bar');
  });

  it('strips trailing slashes', () => {
    expect(toP1Path('/about/')).toBe('about');
    expect(toP1Path('/products//')).toBe('products');
  });

  it('converts empty string to "home"', () => {
    expect(toP1Path('')).toBe('home');
  });

  it('passes through paths without leading slash', () => {
    expect(toP1Path('about')).toBe('about');
  });

  it('converts "/a/b/c/" to "a/b/c"', () => {
    expect(toP1Path('/a/b/c/')).toBe('a/b/c');
  });
});
