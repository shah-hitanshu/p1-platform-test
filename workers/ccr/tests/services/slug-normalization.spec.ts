/**
 * Tests for slug normalization and validation
 */

import { describe, it, expect } from 'vitest';
import { normalizeSlug } from '../../src/services/structure-types';
import { InvalidSlugError } from '../../src/services/errors';

describe('normalizeSlug', () => {
  it('should convert slug to lowercase', () => {
    expect(normalizeSlug('Main-Nav')).toBe('main-nav');
    expect(normalizeSlug('BLOG')).toBe('blog');
    expect(normalizeSlug('MixedCase')).toBe('mixedcase');
  });

  it('should trim whitespace', () => {
    expect(normalizeSlug('  main-nav  ')).toBe('main-nav');
    expect(normalizeSlug(' blog ')).toBe('blog');
  });

  it('should handle already normalized slugs', () => {
    expect(normalizeSlug('main-nav')).toBe('main-nav');
    expect(normalizeSlug('blog')).toBe('blog');
  });

  it('should accept alphanumeric characters and hyphens', () => {
    expect(normalizeSlug('abc-123')).toBe('abc-123');
    expect(normalizeSlug('my-nav-2024')).toBe('my-nav-2024');
  });

  it('should accept underscores and dots', () => {
    expect(normalizeSlug('main_nav')).toBe('main_nav');
    expect(normalizeSlug('nav.v2')).toBe('nav.v2');
  });

  it('should throw InvalidSlugError for empty slug', () => {
    expect(() => normalizeSlug('')).toThrow(InvalidSlugError);
    expect(() => normalizeSlug('  ')).toThrow(InvalidSlugError);
  });

  it('should throw InvalidSlugError for slugs with spaces', () => {
    expect(() => normalizeSlug('main nav')).toThrow(InvalidSlugError);
  });

  it('should throw InvalidSlugError for slugs with slashes', () => {
    expect(() => normalizeSlug('main/nav')).toThrow(InvalidSlugError);
  });

  it('should throw InvalidSlugError for slugs with special characters', () => {
    expect(() => normalizeSlug('main@nav')).toThrow(InvalidSlugError);
    expect(() => normalizeSlug('slug!')).toThrow(InvalidSlugError);
    expect(() => normalizeSlug('slug#tag')).toThrow(InvalidSlugError);
  });
});
