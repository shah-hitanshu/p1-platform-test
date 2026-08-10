#!/usr/bin/env node
// Applies ESLint's autofixes to staged files.
//
// Each package owns an eslint.config.js, and ESLint 9 resolves flat config from
// cwd rather than from the file being linted, so files are grouped by their
// nearest config and one ESLint run is spawned per group with that dir as cwd.
//
// Fixing is the whole job: problems ESLint can't fix are left alone and the
// commit proceeds (exit 1). CI is the gate that fails on them. A blocking hook
// would make packages with known pre-existing lint failures uncommittable.
//
// ESLint failing to *run* at all (exit 2 — broken config, unresolvable plugin)
// is a different thing and does block: it means the group's files were never
// examined, which would otherwise pass silently as if they'd been checked.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const LINT_PROBLEMS_FOUND = 1;

const repoRoot = process.cwd();

function nearestConfigDir(file) {
  let dir = dirname(resolve(repoRoot, file));
  while (dir.startsWith(repoRoot)) {
    if (existsSync(join(dir, 'eslint.config.js'))) return dir;
    if (dir === repoRoot) break;
    dir = dirname(dir);
  }
  return null;
}

function eslintBin(configDir) {
  const local = join(configDir, 'node_modules', '.bin', 'eslint');
  return existsSync(local) ? local : join(repoRoot, 'node_modules', '.bin', 'eslint');
}

const groups = new Map();
for (const file of process.argv.slice(2)) {
  const configDir = nearestConfigDir(file);
  if (!configDir) continue;
  if (!groups.has(configDir)) groups.set(configDir, []);
  groups.get(configDir).push(relative(configDir, resolve(repoRoot, file)));
}

// Concurrently: ESLint startup dominates each run, so a commit spanning N
// packages would otherwise cost N times a single-package commit.
const outcomes = await Promise.all(
  [...groups].map(([configDir, files]) => {
    const bin = eslintBin(configDir);
    if (!existsSync(bin)) return { configDir, ran: false };
    const child = spawn(bin, ['--fix', '--no-warn-ignored', ...files], {
      cwd: configDir,
      stdio: 'inherit',
      // Node's own chatter (MODULE_TYPELESS_PACKAGE_JSON for the configs,
      // FORCE_COLOR vs NO_COLOR from lint-staged) would otherwise bury the
      // lint report that `--verbose` exists to surface.
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return new Promise((done) => {
      child.on('error', () => done({ configDir, ran: false }));
      child.on('close', (code) => {
        done({ configDir, ran: code === 0 || code === LINT_PROBLEMS_FOUND });
      });
    });
  })
);

const neverRan = outcomes
  .filter((outcome) => !outcome.ran)
  .map((outcome) => relative(repoRoot, outcome.configDir) || '.');
if (neverRan.length) {
  console.error(
    `\npre-commit: ESLint could not run in ${neverRan.join(', ')}. ` +
      'Staged files there were NOT autofixed or checked.\n' +
      'Fix the ESLint setup, or bypass with `git commit --no-verify`.'
  );
  process.exit(1);
}
