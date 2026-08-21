import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const registryDir = import.meta.dirname;
const packageDir = join(registryDir, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Utility prefixes and bare utilities that only exist because of Tailwind.
 * Uses (?<![a-z\d-]) instead of \b so that our semantic classes like
 * "p1-block" do not false-positive on the bare "block" alternative.
 */
const UTILITY_CLASS = /className=(?:"|{`)[^"`]*(?<![a-z\d_-])(?:flex|grid|hidden|block|mx-auto|max-w-[\w[]|[mp][trblxy]?-\d|gap-\d|text-(?:xs|sm|base|lg|xl|\dxl|white|black|gray)|bg-(?:white|black|gray|indigo|slate|zinc)|border-(?:gray|slate|dashed|\d)|rounded-(?:sm|md|lg|xl|full)|shadow-(?:sm|md|lg)|items-|justify-|font-(?:medium|bold|semibold)|leading-|(?:sm|md|lg|xl):)/;
const TAILWIND_AT_RULE = /@(?:tailwind|theme|apply|plugin|source|utility|variant)\b/;

describe('installed blocks do not require Tailwind', () => {
  it('declares no Tailwind-related dependency', () => {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(all.filter((name) => /tailwind|autoprefixer|^postcss$/.test(name))).toEqual([]);
  });

  it('uses no Tailwind at-rules in any stylesheet', () => {
    for (const file of sourceFiles(registryDir).filter((f) => f.endsWith('.css'))) {
      const match = readFileSync(file, 'utf8').match(TAILWIND_AT_RULE);
      expect(match?.[0], `${file} uses ${match?.[0]}`).toBeUndefined();
    }
  });

  it('uses no utility class names in any component', () => {
    for (const file of sourceFiles(registryDir).filter(
      (f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'),
    )) {
      const match = readFileSync(file, 'utf8').match(UTILITY_CLASS);
      expect(match?.[0], `${file} still has a Tailwind class: ${match?.[0]}`).toBeUndefined();
    }
  });
});
