/**
 * This package shipped five files styled with Tailwind utility classes while
 * declaring no Tailwind dependency. They rendered only because the starter's
 * stylesheet pointed an `@source` directive at this package's dist, so a
 * consumer who dropped Tailwind lost package-internal UI, not just their own
 * blocks. Every file here now styles itself, and this keeps it that way.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(import.meta.dirname, '..');
const packageDir = join(srcDir, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__mocks__' ? [] : sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Utility prefixes and bare utilities that only exist because of Tailwind.
 * Uses (?<![a-z\d_-]) instead of \b so semantic class names like "p1-block"
 * do not false-positive on the bare "block" alternative.
 */
const UTILITY_CLASS =
  /className=(?:"|\{`)[^"`]*(?<![a-z\d_-])(?:flex|grid|hidden|block|truncate|mx-auto|max-w-[\w[]|[mp][trblxy]?-\d|gap-\d|space-[xy]-\d|w-full|h-full|inset-\d|text-(?:xs|sm|base|lg|xl|\dxl|center|white|black|gray|slate|zinc)|bg-(?:white|black|gray|indigo|slate|zinc|cover|center)|border(?:-(?:gray|slate|dashed|\d))?|rounded(?:-(?:sm|md|lg|xl|full))?|shadow-(?:sm|md|lg)|items-|justify-|object-(?:cover|contain)|overflow-(?:hidden|auto|scroll)|font-(?:medium|bold|semibold)|leading-|\[&|(?:sm|md|lg|xl):)/;

const TAILWIND_AT_RULE = /@(?:tailwind|theme|apply|plugin|source|utility|variant)\b/;

const files = sourceFiles(srcDir);
const rel = (file: string) => relative(packageDir, file);

describe('puck-css styles itself without the consumer’s Tailwind build', () => {
  it('finds the source tree to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('declares no Tailwind-related dependency', () => {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(all.filter((name) => /tailwind/.test(name))).toEqual([]);
  });

  it('uses no Tailwind at-rules in any stylesheet', () => {
    for (const file of files.filter((f) => f.endsWith('.css'))) {
      const match = TAILWIND_AT_RULE.exec(readFileSync(file, 'utf8'));
      expect(match?.[0], `${rel(file)} uses ${match?.[0]}`).toBeUndefined();
    }
  });

  it('uses no utility class names in any component', () => {
    const components = files.filter(
      (f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f),
    );

    for (const file of components) {
      const match = UTILITY_CLASS.exec(readFileSync(file, 'utf8'));
      expect(
        match?.[0],
        `${rel(file)} styles itself with a Tailwind class: ${match?.[0]}`,
      ).toBeUndefined();
    }
  });
});
