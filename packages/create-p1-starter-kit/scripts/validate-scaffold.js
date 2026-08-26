// End-to-end scaffold validation: build the template, run the CLI
// non-interactively, then install / build / typecheck / test the generated
// project against packed tarballs of the in-repo packages it depends on —
// proving unpublished code, not whatever is on the registry.
//
// Expects the five packed packages below to be built already. The scaffolder's own
// dependency graph reaches only css-client and puck-css, so each must be filtered
// explicitly — see the `scaffold` job in .github/workflows/ci.yml for the command.

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');

// The template's @pantheon-systems workspace dependencies, direct and
// transitive (puck-css is a dependency of p1-next-sdk, p1-ai-chat, p1-media).
const PACKED_PACKAGE_DIRS = [
  'packages/css-client',
  'packages/puck-css',
  'packages/p1-next-sdk',
  'packages/p1-ai-chat',
  'packages/p1-media-r2',
];

const PROJECT_NAME = 'scaffold-validation';

const EXPECTED_FILES = [
  'package.json',
  'next.config.mjs',
  'puck.config.tsx',
  '.env.example',
  'tsconfig.json',
  '.gitignore',
];
const EXPECTED_DIRS = ['app', 'components', 'lib', '__tests__'];

function run(command, args, opts = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}${opts.cwd ? `  (in ${opts.cwd})` : ''}`);
  execFileSync(command, args, { stdio: 'inherit', ...opts });
}

// Throws rather than exiting: process.exit would skip the catch below, losing both
// the cleanup decision and the line telling you where the scaffold was left.
function fail(message) {
  throw new Error(message);
}

function assertScaffoldStructure(scaffoldDir) {
  for (const file of EXPECTED_FILES) {
    if (!fs.existsSync(path.join(scaffoldDir, file))) fail(`${file} missing from scaffold`);
  }
  for (const dir of EXPECTED_DIRS) {
    if (!fs.statSync(path.join(scaffoldDir, dir), { throwIfNoEntry: false })?.isDirectory()) {
      fail(`${dir}/ missing from scaffold`);
    }
  }

  const raw = fs.readFileSync(path.join(scaffoldDir, 'package.json'), 'utf-8');
  if (raw.includes('workspace:')) {
    fail('workspace: specifiers survived in the scaffolded package.json');
  }

  const pkg = JSON.parse(raw);
  if (pkg.name !== PROJECT_NAME) {
    fail(`scaffolded package.json name is ${pkg.name}, expected ${PROJECT_NAME}`);
  }

  console.log('✓ Scaffold structure checks passed');
}

function packWorkspacePackages(tarballDir) {
  const overrides = {};
  for (const dir of PACKED_PACKAGE_DIRS) {
    const packageDir = path.join(repoRoot, dir);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
    if (!fs.existsSync(path.join(packageDir, 'dist'))) {
      fail(`${manifest.name} has no dist/ — build the workspace first (see header comment)`);
    }
    run('pnpm', ['pack', '--pack-destination', tarballDir], { cwd: packageDir });
    const tarball = path.join(
      tarballDir,
      `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`
    );
    if (!fs.existsSync(tarball)) fail(`pnpm pack did not produce ${tarball}`);
    overrides[manifest.name] = `file:${tarball}`;
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
function pointScaffoldAtTarballs(scaffoldDir, overrides) {
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

// An ignored override resolves the registry copy instead, which can still install and
// build — leaving the job green while it validates the registry, not this working tree.
// pnpm records each tarball's basename in the lockfile when it honours the override.
function assertTarballsInstalled(scaffoldDir, overrides) {
  const lock = fs.readFileSync(path.join(scaffoldDir, 'pnpm-lock.yaml'), 'utf-8');

  for (const [name, spec] of Object.entries(overrides)) {
    if (!lock.includes(path.basename(spec))) {
      fail(`${name} did not resolve to its packed tarball — pnpm ignored the override`);
    }
  }

  console.log(`✓ All ${Object.keys(overrides).length} packed tarballs are what got installed`);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-scaffold-validation-'));
const scaffoldDir = path.join(workDir, PROJECT_NAME);
const tarballDir = path.join(workDir, 'tarballs');
fs.mkdirSync(tarballDir);
console.log(`Working directory: ${workDir}`);

try {
  run(process.execPath, [path.join(pkgRoot, 'scripts/build-template.js')]);

  run(
    process.execPath,
    [path.join(pkgRoot, 'index.js'), PROJECT_NAME, '--yes', '--pm', 'pnpm', '--no-git', '--no-install'],
    { cwd: workDir }
  );

  assertScaffoldStructure(scaffoldDir);

  const overrides = packWorkspacePackages(tarballDir);
  pointScaffoldAtTarballs(scaffoldDir, overrides);

  run('pnpm', ['install'], { cwd: scaffoldDir });
  assertTarballsInstalled(scaffoldDir, overrides);

  run('pnpm', ['run', 'build'], { cwd: scaffoldDir });
  run('pnpm', ['run', 'typecheck'], { cwd: scaffoldDir });
  run('pnpm', ['run', 'test'], { cwd: scaffoldDir });

  console.log('\n✓ Scaffolded project installs, builds, type-checks, and tests cleanly');
  fs.rmSync(workDir, { recursive: true, force: true });
} catch (error) {
  console.error(`\n✗ Scaffold validation failed: ${error.message}`);
  console.error(`Scaffold left in place for inspection: ${workDir}`);
  process.exit(1);
}
