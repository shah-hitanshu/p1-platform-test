import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { indexWorkspacePackages, resolveWorkspaceDeps } from './workspace-deps.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// A null manifest writes the directory without a package.json.
function writePackages(packages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-deps-'));
  for (const [dirName, manifest] of Object.entries(packages)) {
    fs.mkdirSync(path.join(dir, dirName));
    if (manifest === null) continue;
    fs.writeFileSync(path.join(dir, dirName, 'package.json'), JSON.stringify(manifest));
  }
  return dir;
}

const index = (packages) => indexWorkspacePackages(writePackages(packages));

describe('indexWorkspacePackages', () => {
  it('keys packages by published name, not directory name', () => {
    const packages = index({
      'p1-media-r2': { name: '@scope/p1-media', version: '0.4.3' },
    });

    expect(packages.get('@scope/p1-media').version).toBe('0.4.3');
    expect(packages.has('@scope/p1-media-r2')).toBe(false);
  });

  it('skips directories with no manifest', () => {
    const packages = index({ 'not-a-package': null });

    expect([...packages.keys()]).toEqual([]);
  });

  it('skips a manifest with no name rather than indexing it as undefined', () => {
    const packages = index({ 'nameless': { version: '1.0.0' } });

    expect(packages.has(undefined)).toBe(false);
  });
});

describe('resolveWorkspaceDeps', () => {
  const packages = index({
    'css-client': { name: '@scope/css-client', version: '0.10.0' },
    'p1-media-r2': { name: '@scope/p1-media', version: '0.4.3' },
    'eslint-config': { name: '@scope/eslint-config', version: '0.1.0', private: true },
  });

  it('rewrites every workspace: dependency, not a fixed subset', () => {
    const pkg = {
      dependencies: {
        '@scope/css-client': 'workspace:*',
        '@scope/p1-media': 'workspace:*',
      },
    };

    resolveWorkspaceDeps(pkg, packages);

    expect(pkg.dependencies).toEqual({
      '@scope/css-client': '^0.10.0',
      '@scope/p1-media': '^0.4.3',
    });
  });

  it('rewrites devDependencies too', () => {
    const pkg = { devDependencies: { '@scope/css-client': 'workspace:^' } };

    resolveWorkspaceDeps(pkg, packages);

    expect(pkg.devDependencies['@scope/css-client']).toBe('^0.10.0');
  });

  it.each([
    ['workspace:*', '^0.10.0'],
    ['workspace:^', '^0.10.0'],
    ['workspace:~', '~0.10.0'],
    ['workspace:>=0.9.0', '>=0.9.0'],
  ])('carries the range through %s', (specifier, expected) => {
    const pkg = { dependencies: { '@scope/css-client': specifier } };

    resolveWorkspaceDeps(pkg, packages);

    expect(pkg.dependencies['@scope/css-client']).toBe(expected);
  });

  it('leaves registry specifiers alone', () => {
    const pkg = { dependencies: { react: '^19.2.5', '@scope/css-client': '0.9.0' } };

    resolveWorkspaceDeps(pkg, packages);

    expect(pkg.dependencies).toEqual({ react: '^19.2.5', '@scope/css-client': '0.9.0' });
  });

  it('fails rather than emitting a specifier no consumer can install', () => {
    const pkg = { dependencies: { '@scope/unpublished': 'workspace:*' } };

    expect(() => resolveWorkspaceDeps(pkg, packages)).toThrow(/no package under packages\//);
  });

  it('fails on a private workspace dependency', () => {
    const pkg = { dependencies: { '@scope/eslint-config': 'workspace:*' } };

    expect(() => resolveWorkspaceDeps(pkg, packages)).toThrow(/private/);
  });
});

describe('the real starter app', () => {
  it('has no workspace dependency this script cannot resolve', () => {
    const starter = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'apps/p1-starter/package.json'), 'utf-8')
    );
    // eslint-config is inlined by transformPackageJson before the rewrite runs.
    delete starter.devDependencies['@pantheon-systems/eslint-config'];

    const resolved = resolveWorkspaceDeps(
      starter,
      indexWorkspacePackages(path.join(repoRoot, 'packages'))
    );

    const specifiers = Object.values({ ...resolved.dependencies, ...resolved.devDependencies });
    expect(specifiers.filter((s) => s.startsWith('workspace:'))).toEqual([]);
  });
});
