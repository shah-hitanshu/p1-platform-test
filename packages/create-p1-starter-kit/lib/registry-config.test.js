import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import {
  readRegistryConfig,
  readNamespaceForDisplay,
  buildComponentsJson,
} from './registry-config.js';

const tempDirs = [];

function manifestIn(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'p1-registry-cfg-'));
  tempDirs.push(dir);
  if (contents !== null) {
    writeFileSync(join(dir, 'generated-registry.json'), JSON.stringify(contents));
  }
  return join(dir, 'generated-registry.json');
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

const VALID = { namespace: '@p1', url: 'https://example.test/r/{name}.json', release: 'v0.1.0' };

describe('readRegistryConfig', () => {
  it('reads the generated manifest', () => {
    expect(readRegistryConfig(manifestIn(VALID))).toEqual(VALID);
  });

  it('tells you to build when the manifest is missing', () => {
    expect(() => readRegistryConfig(manifestIn(null))).toThrow(/pnpm build/);
  });

  it('rejects a url template with no {name} placeholder', () => {
    // Without it the CLI cannot resolve @p1/hero to anything.
    expect(() =>
      readRegistryConfig(manifestIn({ ...VALID, url: 'https://example.test/r/hero.json' })),
    ).toThrow(/\{name\}/);
  });

  it('rejects a non-https url', () => {
    expect(() =>
      readRegistryConfig(manifestIn({ ...VALID, url: 'http://x.test/r/{name}.json' })),
    ).toThrow(/https/);
  });
});

describe('readNamespaceForDisplay', () => {
  it('reads the stamped namespace', () => {
    expect(readNamespaceForDisplay(manifestIn(VALID))).toBe('@p1');
  });

  // It feeds the closing message of a scaffold that has already succeeded, and
  // both callers that read the manifest earlier warn and carry on, so throwing
  // here would kill a finished scaffold on its last line.
  it.each([
    ['missing', null],
    ['unusable', { ...VALID, url: 'http://x.test/r/{name}.json' }],
  ])('returns undefined rather than throwing on a %s manifest', (_label, contents) => {
    expect(readNamespaceForDisplay(manifestIn(contents))).toBeUndefined();
  });
});

describe('buildComponentsJson', () => {
  const cfg = buildComponentsJson(VALID);

  it('registers the namespace so later adds need no setup', () => {
    expect(cfg.registries['@p1']).toBe(VALID.url);
  });

  it('points tailwind.css at the project stylesheet the CLI must edit', () => {
    // @p1/tokens injects its own @import into whatever this names.
    expect(cfg.tailwind.css).toBe('app/styles.css');
  });

  it('aliases components at the project root, matching where blocks are targeted', () => {
    expect(cfg.aliases.components).toBe('@/components');
    expect(cfg.aliases.lib).toBe('@/lib');
  });

  it('is valid JSON with a schema reference', () => {
    expect(cfg.$schema).toMatch(/^https:\/\//);
    expect(() => JSON.parse(JSON.stringify(cfg))).not.toThrow();
  });
});
