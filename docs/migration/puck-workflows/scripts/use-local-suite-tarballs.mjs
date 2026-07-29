#!/usr/bin/env node

// Points a scaffolded starter project at suite tarballs packed from this checkout rather
// than the public registry.
//
// The check exists to answer "would this set of changes scaffold a working app if a user
// pulled it off npm?" Installing published versions answered a weaker question — "is the
// already-published release installable?" — which is tautologically yes, and fails
// outright on a release PR, where build-template.js pins the template at versions npm
// won't have until publish.yml runs.

import fs from 'node:fs';
import path from 'node:path';

const SUITE = ['css-client', 'puck-css', 'p1-next-sdk'];

const projectDir = process.argv[2];
if (!projectDir) {
  console.error('usage: use-local-suite-tarballs.mjs <project-dir>');
  process.exit(1);
}

const vendorDir = path.join(projectDir, 'vendor');
const tarballs = fs.readdirSync(vendorDir).filter((f) => f.endsWith('.tgz'));

const overrides = {};
for (const name of SUITE) {
  const tarball = tarballs.find((f) => f.startsWith(`pantheon-systems-${name}-`));
  if (!tarball) {
    throw new Error(`No tarball for @pantheon-systems/${name} in ${vendorDir}`);
  }
  overrides[`@pantheon-systems/${name}`] = `file:./vendor/${tarball}`;
}

const pkgPath = path.join(projectDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

for (const [name, spec] of Object.entries(overrides)) {
  if (pkg.dependencies?.[name]) {
    pkg.dependencies[name] = spec;
  }
}

// The tarballs depend on each other by exact version, which is equally unpublished, so
// the transitive edges have to be redirected too. Each package manager reads a different
// field; setting all of them keeps this script matrix-agnostic.
pkg.overrides = { ...pkg.overrides, ...overrides };
pkg.resolutions = { ...pkg.resolutions, ...overrides };
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// pnpm 11 ignores package.json's `pnpm.overrides` once a pnpm-workspace.yaml exists,
// and build-template.js always generates one.
const workspacePath = path.join(projectDir, 'pnpm-workspace.yaml');
let existing = '';
try {
  existing = fs.readFileSync(workspacePath, 'utf-8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const entries = Object.entries(overrides).map(([name, spec]) => `  '${name}': ${spec}`);
fs.writeFileSync(
  workspacePath,
  `${existing.trim() ? existing.trimEnd() + '\n' : ''}overrides:\n${entries.join('\n')}\n`
);

for (const [name, spec] of Object.entries(overrides)) {
  console.log(`  ${name} → ${spec}`);
}
