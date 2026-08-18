import { describe, it, expect } from 'vitest';
import * as lib from './index';
import { marketingBlocks, secondaryLibraryCategories } from './index';

const EXPECTED_BLOCK_COUNT = 37;

describe('block registry', () => {
  it('exports exactly 37 blocks in marketingBlocks', () => {
    expect(Object.keys(marketingBlocks)).toHaveLength(EXPECTED_BLOCK_COUNT);
  });

  it('exports every marketingBlocks entry as a named export too', () => {
    for (const name of Object.keys(marketingBlocks)) {
      expect(lib, `${name} is in marketingBlocks but not a named export`).toHaveProperty(name);
    }
  });

  it('gives every block a render function', () => {
    for (const [name, block] of Object.entries(marketingBlocks)) {
      expect(typeof block.render, `${name}.render`).toBe('function');
    }
  });

  it('lists every block in exactly one category', () => {
    const seen = new Map<string, string>();
    for (const [key, category] of Object.entries(secondaryLibraryCategories ?? {})) {
      for (const name of category.components ?? []) {
        const previous = seen.get(name);
        expect(previous, `${name} is in both "${previous}" and "${key}"`).toBeUndefined();
        seen.set(name, key);
      }
    }
    expect([...seen.keys()].sort()).toEqual(Object.keys(marketingBlocks).sort());
  });
});
