import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = join(import.meta.dirname);
const registryBuilt = existsSync(join(root, 'public', 'r', 'registry.json'));

describe('static export configuration', () => {
  it('next.config declares output: export', () => {
    const cfg = readFileSync(join(root, 'next.config.ts'), 'utf8');
    expect(cfg).toContain("output: 'export'");
  });

  it('next.config disables image optimization (required for static export)', () => {
    const cfg = readFileSync(join(root, 'next.config.ts'), 'utf8');
    expect(cfg).toContain('unoptimized: true');
  });
});

describe.skipIf(!registryBuilt)('registry build output', () => {
  const registryDir = join(root, 'public', 'r');

  it('public/r/registry.json is present (registry:build was run)', () => {
    expect(existsSync(join(registryDir, 'registry.json'))).toBe(true);
  });

  it('all block JSON files are present', () => {
    const index = JSON.parse(readFileSync(join(registryDir, 'registry.json'), 'utf8')) as {
      items: { name: string }[];
    };
    const blockNames = index.items
      .map((i) => i.name)
      .filter((n) => !['base', 'tokens', 'internal-btn', 'internal-icons', 'internal-rich'].includes(n));

    for (const name of blockNames) {
      const itemPath = join(registryDir, `${name}.json`);
      expect(existsSync(itemPath), `missing ${name}.json`).toBe(true);
    }
  });

  it('tokens.json is present', () => {
    expect(existsSync(join(registryDir, 'tokens.json'))).toBe(true);
  });

  it('base.json is present', () => {
    expect(existsSync(join(registryDir, 'base.json'))).toBe(true);
  });
});
