import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = join(import.meta.dirname);
const registryBuilt = existsSync(join(root, 'public', 'r', 'registry.json'));

// Pantheon serves this app by running `next start`, which throws outright if
// output: 'export' is set. These guard the hosting contract, not a style choice.
describe('hosting configuration', () => {
  it('next.config does not set output: export', () => {
    const cfg = readFileSync(join(root, 'next.config.ts'), 'utf8');
    expect(cfg).not.toContain("output: 'export'");
  });

  it('declares the start script the host runs to serve the app', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.start).toBeTruthy();
  });

  it('next.config disables image optimization', () => {
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

// Preview pages are prerendered block markup shown in the catalog's iframes. The
// block CSS must arrive as a <link> in that HTML; if it only rides the dynamic
// import chunk, the markup paints unstyled until JS injects it.
const previewHeroPath = join(root, 'out', 'preview', 'hero.html');
describe.skipIf(!existsSync(previewHeroPath))('preview CSS is not runtime-injected', () => {
  const html = existsSync(previewHeroPath) ? readFileSync(previewHeroPath, 'utf8') : '';

  it('preview HTML links a stylesheet', () => {
    expect(html).toMatch(/<link[^>]+rel="stylesheet"/);
  });

  it('block styles are reachable without running JS', () => {
    const linked = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
    const inlined = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    const css =
      inlined +
      linked
        .map((href) => {
          const f = join(root, 'out', href.replace(/^\//, ''));
          return existsSync(f) ? readFileSync(f, 'utf8') : '';
        })
        .join('\n');

    expect(css, 'hero block rules missing from initial HTML').toContain('.p1-hero');
    expect(css, '.p1-block padding (base.css) missing from initial HTML').toContain('.p1-block');
  });
});
