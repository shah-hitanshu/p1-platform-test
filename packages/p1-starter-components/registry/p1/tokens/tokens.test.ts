import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const tokensCss = readFileSync(join(import.meta.dirname, 'p1-tokens.css'), 'utf8');
const repoRoot = join(import.meta.dirname, '..', '..', '..', '..', '..');

/** Tailwind's spacing unit: `px-16` is 16 × 0.25rem = 4rem. */
const TAILWIND_UNIT_REM = 0.25;

describe('PDS derivation', () => {
  it('gives every --pds-* reference a literal fallback', () => {
    // A customer project may not load the PDS token layer; an unqualified
    // var(--pds-…) renders as nothing at all.
    const bare = [...tokensCss.matchAll(/var\(\s*(--pds-[a-z0-9-]+)\s*\)/g)].map((m) => m[1]);
    expect(bare, `no fallback for: ${bare.join(', ')}`).toEqual([]);
  });

  it('references at least one PDS token, so the derivation is real', () => {
    expect(tokensCss).toMatch(/var\(--pds-/);
  });
});

describe('block padding parity with apps/p1-starter', () => {
  function starterKitPaddingRem(): { inline: number; block: number } {
    const source = readFileSync(
      join(repoRoot, 'apps/p1-starter/components/puck/block-padding.ts'),
      'utf8',
    );
    const classes = source.match(/blockPaddingClass\s*=\s*"([^"]+)"/)?.[1];
    if (!classes) throw new Error('blockPaddingClass not found in apps/p1-starter');

    const inline = classes.match(/\bpx-(\d+(?:\.\d+)?)\b/)?.[1];
    const block = classes.match(/\bpy-(\d+(?:\.\d+)?)\b/)?.[1];
    if (!inline || !block) throw new Error(`blockPaddingClass "${classes}" is not a px-N py-M pair`);

    return { inline: Number(inline) * TAILWIND_UNIT_REM, block: Number(block) * TAILWIND_UNIT_REM };
  }

  function registryPaddingRem(): { inline: number; block: number } {
    const read = (name: string): number => {
      const value = tokensCss.match(new RegExp(`--p1-block-padding-${name}:\\s*([\\d.]+)rem`))?.[1];
      if (!value) throw new Error(`--p1-block-padding-${name} is not declared in rem`);
      return Number(value);
    };
    return { inline: read('inline'), block: read('block') };
  }

  it('matches the starter kit exactly', () => {
    let starter: { inline: number; block: number };
    try {
      starter = starterKitPaddingRem();
    } catch (e) {
      expect.fail(`Could not read starter kit padding: ${(e as Error).message}`);
    }
    expect(registryPaddingRem()).toEqual(starter);
  });
});
