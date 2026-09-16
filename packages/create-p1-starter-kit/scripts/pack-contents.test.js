import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `files` in package.json is the only thing keeping the repo's own tooling out of the
// published package, and it is edited by hand. This asks npm what it would actually
// ship rather than trusting the allowlist to have stayed correct.
const PUBLISHED_TOP_LEVEL = ['README.md', 'index.js', 'lib', 'package.json', 'template'];

function packedFiles() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: pkgRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].files.map((file) => file.path);
}

describe('published tarball contents', () => {
  const files = packedFiles();

  it('ships only the allowlisted paths', () => {
    const topLevel = [...new Set(files.map((file) => file.split('/')[0]))].sort();
    expect(topLevel).toEqual(PUBLISHED_TOP_LEVEL);
  });

  // The package's own scripts/ holds repo tooling — the template build, the scaffolders,
  // the CI validation. template/scripts/ is different: those are the scaffolded site's
  // scripts and are meant to ship.
  it('ships no repo tooling from the package root', () => {
    expect(files.filter((file) => file.startsWith('scripts/'))).toEqual([]);
  });
}, 30_000);
