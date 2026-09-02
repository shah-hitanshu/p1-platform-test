import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { describe, it, expect } from 'vitest';
import { registrySchema } from 'shadcn/schema';

const packageDir = join(import.meta.dirname, '..', '..', '..');
const rootPath = join(packageDir, 'registry.json');

describe('code registry source', () => {
  const root = JSON.parse(readFileSync(rootPath, 'utf8'));

  it('validates the root catalog against shadcn/schema', () => {
    expect(() => registrySchema.parse(root)).not.toThrow();
  });

  it('names the registry p1, which is the namespace customers configure', () => {
    expect(root.name).toBe('p1');
  });

  it('composes item definitions with include rather than one giant file', () => {
    // 37 blocks in one root file is unreviewable and merge-conflicts constantly.
    expect(Array.isArray(root.include)).toBe(true);
    expect(root.include.length).toBeGreaterThan(0);
  });

  it('points every include at a file that exists', () => {
    for (const relative of root.include as string[]) {
      expect(existsSync(join(packageDir, relative)), `missing include: ${relative}`).toBe(true);
    }
  });

  it('points every item file at a path that exists, relative to its own registry.json', () => {
    for (const relative of root.include as string[]) {
      const includePath = join(packageDir, relative);
      const included = JSON.parse(readFileSync(includePath, 'utf8'));
      registrySchema.parse({ name: 'p1', homepage: root.homepage, ...included });
      for (const item of (included.items ?? []) as { name: string; files?: { path: string }[] }[]) {
        for (const file of item.files ?? []) {
          const resolved = join(dirname(includePath), file.path);
          expect(existsSync(resolved), `${item.name}: missing ${file.path}`).toBe(true);
        }
      }
    }
  });
});
