import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { describe, it, expect } from 'vitest';
import { registrySchema, registryItemSchema } from 'shadcn/schema';

const packageDir = join(import.meta.dirname, '..', '..');
const root = JSON.parse(readFileSync(join(packageDir, 'registry.json'), 'utf8'));

interface Item {
  name: string;
  type: string;
  title?: string;
  description?: string;
  files?: { path: string; type: string; target?: string }[];
  dependencies?: string[];
  registryDependencies?: string[];
  categories?: string[];
  docs?: string;
  meta?: Record<string, unknown>;
}

/** Every item, paired with the directory its paths resolve against. */
const items: { item: Item; dir: string }[] = root.include.flatMap((relative: string) => {
  const includePath = join(packageDir, relative);
  const included = JSON.parse(readFileSync(includePath, 'utf8'));
  return (included.items ?? []).map((item: Item) => ({ item, dir: dirname(includePath) }));
});

const blocks = items.filter(({ item }) => item.type === 'registry:block');

/** npm specifiers imported by a file, ignoring relative and @/registry imports. */
function npmImports(source: string): string[] {
  const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  return specifiers
    .filter((s) => !s.startsWith('.') && !s.startsWith('@/'))
    .map((s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]));
}

describe('registry catalog', () => {
  it('validates the root against shadcn/schema', () => {
    expect(() => registrySchema.parse(root)).not.toThrow();
  });

  it('has 37 block items', () => {
    expect(blocks).toHaveLength(37);
  });

  it('validates every item against registryItemSchema', () => {
    for (const { item } of items) {
      expect(() => registryItemSchema.parse(item), `${item.name} is invalid`).not.toThrow();
    }
  });

  it('uses unique kebab-case names', () => {
    const names = items.map(({ item }) => item.name);
    expect(new Set(names).size, 'duplicate item names').toBe(names.length);
    const bad = names.filter((n) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(n));
    expect(bad, `not kebab-case: ${bad.join(', ')}`).toEqual([]);
  });

  it('has one item per block directory, named after it', () => {
    const dirs = readdirSync(join(import.meta.dirname, 'blocks'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(blocks.map(({ item }) => item.name).sort()).toEqual(dirs);
  });

  it('points every declared file at a path that exists', () => {
    for (const { item, dir } of items) {
      for (const file of item.files ?? []) {
        expect(existsSync(join(dir, file.path)), `${item.name}: missing ${file.path}`).toBe(true);
      }
    }
  });

  it('ships all three files for every block, targeted under components/puck/blocks', () => {
    for (const { item } of blocks) {
      const targets = (item.files ?? []).map((f) => f.target ?? '');
      expect(targets, `${item.name} must declare a target for every file`).not.toContain('');
      for (const target of targets) {
        expect(target.startsWith(`components/puck/blocks/${item.name}/`), `${item.name}: ${target}`).toBe(true);
      }
      const names = (item.files ?? []).map((f) => f.path.split('/').pop());
      expect(names.sort()).toEqual(
        [`${item.name}.block.tsx`, `${item.name}.css`, `${item.name}.tsx`].sort(),
      );
    }
  });

  it('gives every block a title, a description, a category and a version', () => {
    for (const { item } of blocks) {
      expect(item.title, `${item.name} has no title`).toBeTruthy();
      // The description is what an agent reads when searching the registry.
      expect((item.description ?? '').length, `${item.name}: description too short`).toBeGreaterThan(20);
      expect(item.categories?.length, `${item.name} has no category`).toBeGreaterThan(0);
      expect(item.meta?.version, `${item.name} has no meta.version`).toBeTruthy();
    }
  });

  it('tells the user how to register every block in Puck', () => {
    // The CLI cannot edit puck.config.tsx; `docs` is printed after install and
    // is the only instruction most users will see.
    for (const { item } of blocks) {
      expect(item.docs ?? '', `${item.name}: docs must name the barrel`).toContain(
        'components/puck/blocks/index.ts',
      );
    }
  });

  it('declares every npm package its files import', () => {
    for (const { item, dir } of items) {
      const declared = new Set((item.dependencies ?? []).map((d) => d.split('@').slice(0, d.startsWith('@') ? 2 : 1).join('@')));
      const imported = new Set(
        (item.files ?? []).flatMap((f) => npmImports(readFileSync(join(dir, f.path), 'utf8'))),
      );
      // react/react-dom come from the host app; everything else must be declared.
      const missing = [...imported].filter(
        (pkg) => !['react', 'react-dom'].includes(pkg) && !declared.has(pkg),
      );
      expect(missing, `${item.name} imports undeclared: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('declares internals as registryDependencies rather than copying them per block', () => {
    for (const { item, dir } of items.filter((x) => x.item.type === 'registry:block')) {
      const usesInternal = (item.files ?? []).some((f) =>
        readFileSync(join(dir, f.path), 'utf8').includes('@/registry/p1/internal/'),
      );
      if (!usesInternal) continue;
      expect(
        (item.registryDependencies ?? []).some((d) => d.startsWith('@p1/internal-')),
        `${item.name} imports an internal but declares no @p1/internal-* dependency`,
      ).toBe(true);
    }
  });
});
