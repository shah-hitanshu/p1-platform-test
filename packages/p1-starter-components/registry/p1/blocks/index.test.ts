import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import type { ComponentConfig } from '@puckeditor/core';

const blocksDir = import.meta.dirname;

const blockDirs = readdirSync(blocksDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('block layout on disk', () => {
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

type BlockData = { exportName: string; block: ComponentConfig; categories: string[] };

describe('block configs', () => {
  let allBlocks: BlockData[] = [];

  beforeAll(async () => {
    const modules = await Promise.all(
      blockDirs.map(async (name) => {
        const mod = await import(join(blocksDir, name, `${name}.block`));
        const entry = Object.entries(mod).find(
          ([k, v]) => k.endsWith('Block') && typeof (v as ComponentConfig)?.render === 'function',
        );
        if (!entry) return undefined;
        const [exportName, block] = entry as [string, ComponentConfig];
        const categories: string[] = (mod.meta as { categories?: string[] } | undefined)?.categories ?? [];
        return { exportName, block, categories };
      }),
    );
    allBlocks = modules.filter((m): m is BlockData => m !== undefined);
  });

  it('every block directory exports a block with a render function', () => {
    expect(allBlocks).toHaveLength(blockDirs.length);
  });

  it('every block has exactly one category in meta', () => {
    for (const { exportName, categories } of allBlocks) {
      expect(categories.length, `${exportName} has no categories in meta`).toBe(1);
    }
  });
});
