import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as lib from './index';
import { allBlocks, sourceCategories } from './index';

const EXPECTED_BLOCK_COUNT = 37;
const blocksDir = import.meta.dirname;

const blockDirs = readdirSync(blocksDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('block layout on disk', () => {
  it('has exactly 37 block directories', () => {
    expect(blockDirs).toHaveLength(EXPECTED_BLOCK_COUNT);
  });

  it('names every directory in kebab-case', () => {
    // Directory names become registry item names — renaming one after release
    // breaks every customer's install command.
    const bad = blockDirs.filter((name) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name));
    expect(bad, `not kebab-case: ${bad.join(', ')}`).toEqual([]);
  });

  it('puts a <name>.tsx inside every block directory', () => {
    const missing = blockDirs.filter((name) => !existsSync(join(blocksDir, name, `${name}.tsx`)));
    expect(missing, `no entry file: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('block barrel', () => {
  it('exports exactly 37 blocks in allBlocks', () => {
    expect(Object.keys(allBlocks)).toHaveLength(EXPECTED_BLOCK_COUNT);
  });

  it('exports every allBlocks entry as a named export too', () => {
    for (const name of Object.keys(allBlocks)) {
      expect(lib, `${name} is in allBlocks but not a named export`).toHaveProperty(name);
    }
  });

  it('gives every block a render function', () => {
    for (const [name, block] of Object.entries(allBlocks)) {
      expect(typeof block.render, `${name}.render`).toBe('function');
    }
  });

  it('lists every block in exactly one category', () => {
    const seen = new Map<string, string>();
    for (const [key, category] of Object.entries(sourceCategories ?? {}) as [string, { components?: string[] }][]) {
      for (const name of category.components ?? []) {
        const previous = seen.get(name);
        expect(previous, `${name} is in both "${previous}" and "${key}"`).toBeUndefined();
        seen.set(name, key);
      }
    }
    expect([...seen.keys()].sort()).toEqual(Object.keys(allBlocks).sort());
  });
});
