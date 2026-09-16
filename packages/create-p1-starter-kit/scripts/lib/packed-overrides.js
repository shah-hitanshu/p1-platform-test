// Shared by scripts/validate-scaffold.js (CI, throwaway scaffold) and
// scripts/scaffold-local.js (a scaffold someone keeps): pack the in-repo packages a
// scaffold depends on and make pnpm install those instead of the published ones.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// The template's @pantheon-systems workspace dependencies, direct and transitive
// (puck-css is a dependency of p1-next-sdk, p1-ai-chat, p1-media; p1-ai-chat now
// arrives only through p1-next-sdk).
export const PACKED_PACKAGE_DIRS = [
  'packages/css-client',
  'packages/puck-css',
  'packages/p1-next-sdk',
  'packages/p1-ai-chat',
  'packages/p1-media-r2',
];

export function run(command, args, opts = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}${opts.cwd ? `  (in ${opts.cwd})` : ''}`);
  execFileSync(command, args, { stdio: 'inherit', ...opts });
}

// Throws rather than exiting so callers keep their cleanup decision.
export function fail(message) {
  throw new Error(message);
}

function countEmittedJs(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countEmittedJs(path.join(dir, entry.name));
    else if (entry.name.endsWith('.js')) total += 1;
  }
  return total;
}

// The build runs tsc twice, declarations first. When the emit pass fails, the build
// can still exit 0 with a dist/ full of .d.ts and no .js — which packs, installs and
// type-checks, then throws on the first subpath import at runtime.
function assertEmittedJavaScript(packageDir, name) {
  const dist = path.join(packageDir, 'dist');
  if (!fs.existsSync(dist)) fail(`${name} has no dist/ — build the workspace first`);
  if (countEmittedJs(dist) === 0) {
    fail(`${name} emitted no .js into dist/ — its build's emit pass failed silently; rebuild it`);
  }
}

// `specPrefix` decides how the override points at the tarball: absolute for a
// throwaway scaffold, relative (./local-tarballs/) for one that outlives /tmp.
export function packWorkspacePackages(repoRoot, tarballDir, { specPrefix } = {}) {
  fs.mkdirSync(tarballDir, { recursive: true });

  const overrides = {};
  for (const dir of PACKED_PACKAGE_DIRS) {
    const packageDir = path.join(repoRoot, dir);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
    assertEmittedJavaScript(packageDir, manifest.name);

    run('pnpm', ['pack', '--pack-destination', tarballDir], { cwd: packageDir });
    const filename = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
    if (!fs.existsSync(path.join(tarballDir, filename))) {
      fail(`pnpm pack did not produce ${filename}`);
    }
    overrides[manifest.name] = specPrefix
      ? `file:${specPrefix}${filename}`
      : `file:${path.join(tarballDir, filename)}`;
  }
  return overrides;
}

// pnpm 10+ reads settings from pnpm-workspace.yaml; a `pnpm` field in
// package.json is silently ignored, so the overrides go into the yaml the
// template already ships.
//
// A missing file is fatal rather than something to create: without the overrides
// landing somewhere pnpm reads, the install would quietly resolve the published
// packages and validate the registry instead of this working tree.
export function pointScaffoldAtTarballs(scaffoldDir, overrides) {
  const workspaceYamlPath = path.join(scaffoldDir, 'pnpm-workspace.yaml');

  let existing;
  try {
    existing = fs.readFileSync(workspaceYamlPath, 'utf-8').replace(/\n?$/, '\n');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fail(
      'scaffold has no pnpm-workspace.yaml, so tarball overrides would be ignored ' +
      'and the install would silently resolve published packages'
    );
  }

  const lines = Object.entries(overrides).map(([name, spec]) => `  "${name}": "${spec}"`);
  fs.writeFileSync(workspaceYamlPath, `${existing}overrides:\n${lines.join('\n')}\n`);
  console.log(`✓ Overrode ${Object.keys(overrides).join(', ')} with packed tarballs`);
}

// pnpm caches workspace state and revalidates it against package.json mtimes only, so
// an install run after the yaml edit above reports "Already up to date" and resolves
// nothing — no lockfile written, overrides never applied.
//
// --no-frozen-lockfile because the overrides deliberately diverge from the lockfile the
// scaffold ships with (installing the block library resolves npm dependencies, so there
// is one), and under CI's default frozen install pnpm refuses the very override the
// caller is applying.
export function installIgnoringWorkspaceStateCache(scaffoldDir) {
  fs.rmSync(path.join(scaffoldDir, 'node_modules/.pnpm-workspace-state.json'), { force: true });
  const manifest = path.join(scaffoldDir, 'package.json');
  const now = new Date();
  fs.utimesSync(manifest, now, now);

  run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: scaffoldDir });
}

// An ignored override resolves the registry copy instead, which can still install and
// build — leaving the caller green while it validates the registry, not this working tree.
// pnpm records each tarball's basename in the lockfile when it honours the override.
export function assertTarballsInstalled(scaffoldDir, overrides) {
  const lock = fs.readFileSync(path.join(scaffoldDir, 'pnpm-lock.yaml'), 'utf-8');

  for (const [name, spec] of Object.entries(overrides)) {
    if (!lock.includes(path.basename(spec))) {
      fail(`${name} did not resolve to its packed tarball — pnpm ignored the override`);
    }
  }

  console.log(`✓ All ${Object.keys(overrides).length} packed tarballs are what got installed`);
}
