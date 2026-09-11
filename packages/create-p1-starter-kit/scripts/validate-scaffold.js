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
// The same count the CLI shows the user, so CI cannot assert a different number.
import { installedBlockNames } from '../lib/install-p1-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');

// The template's @pantheon-systems workspace dependencies, direct and transitive
// (puck-css is a dependency of p1-next-sdk, p1-ai-chat, p1-media; p1-ai-chat now
// arrives only through p1-next-sdk).
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

const BARREL = 'components/puck/blocks/index.ts';
const STARTER_KIT_CATEGORIES = ['typography', 'media', 'data', 'layout', 'actions', 'pages'];
// The eight names the starter kit already owns. @p1/base excludes them so a
// customer keeps the P1-wired versions rather than a standalone duplicate.
const COLLIDERS = ['heading', 'paragraph', 'image', 'quote', 'list', 'button', 'divider', 'spacer'];

/** Nothing the scaffolder uses may reach the generated project (spec D10). */
function assertNoScaffolderArtefacts(dir, label) {
  for (const leak of ['lib/generated-registry.json', 'lib/registry-config.js', 'lib/install-p1-blocks.js']) {
    if (fs.existsSync(path.join(dir, leak))) fail(`${label}: ${leak} leaked into the generated project`);
  }
  for (const agentFile of ['AGENTS.md', '.claude', 'P1-BLOCKS.md']) {
    if (fs.existsSync(path.join(dir, agentFile))) fail(`${label}: ${agentFile} reached a generated tree`);
  }
  console.log(`✓ ${label}: no scaffolder artefacts`);
}

/**
 * components.json and tsconfig.json are edited independently and nothing else
 * notices when they disagree — a customer finds out on their first build.
 */
function assertRegistryWiring(dir, label) {
  const components = JSON.parse(fs.readFileSync(path.join(dir, 'components.json'), 'utf-8'));
  const registry = components.registries?.['@p1'];
  if (!registry) fail(`${label}: @p1 is not registered in components.json`);
  if (!registry.includes('{name}')) fail(`${label}: the @p1 url template has no {name}`);
  if (!registry.startsWith('https://')) fail(`${label}: the @p1 url is not https`);
  if (components.tailwind?.css !== 'app/styles.css') fail(`${label}: tailwind.css does not name app/styles.css`);

  const tsconfig = JSON.parse(
    fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf-8').replace(/^\s*\/\/.*$/gm, '')
  );
  if (!tsconfig.compilerOptions?.paths?.['@/*']) fail(`${label}: tsconfig declares no @/* alias`);

  // Only the two that installed files land in. ui, hooks and utils are shadcn
  // convention entries no @p1 item targets, and shadcn creates those on demand —
  // requiring them up front would assert a convention, not a contract.
  for (const key of ['components', 'lib']) {
    const target = components.aliases?.[key];
    if (!target) fail(`${label}: components.json declares no aliases.${key}`);
    if (!fs.existsSync(path.join(dir, String(target).slice(2)))) {
      fail(`${label}: aliases.${key} points at ${target}, which does not exist`);
    }
  }

  // vitest does not read tsconfig paths, so a test touching an installed block
  // fails to resolve rather than to assert without this.
  const vitestConfig = fs.readFileSync(path.join(dir, 'vitest.config.ts'), 'utf-8');
  if (!/alias:\s*\{[^}]*['"]@\//.test(vitestConfig)) {
    fail(`${label}: vitest.config.ts does not alias @/`);
  }

  assertMergeOrder(dir, label);
  console.log(`✓ ${label}: @p1 registered, @/ alias resolves for tsc and vitest, spreads merge first`);
}

/**
 * Both spreads must come first. Later keys win in an object literal, so a spread
 * placed last lets a registry category overwrite one the project owns — its
 * blocks then stay registered and vanish from the drawer, with no error.
 */
function assertMergeOrder(dir, label) {
  const config = fs.readFileSync(path.join(dir, 'puck.config.tsx'), 'utf-8');

  for (const spread of ['...p1Categories,', '...p1Blocks,']) {
    if (!config.includes(spread)) fail(`${label}: puck.config.tsx does not spread ${spread}`);
  }
  if (!config.includes("from \"./components/puck/blocks\"")) {
    fail(`${label}: puck.config.tsx does not import the blocks barrel`);
  }

  // Inside each block, the spread has to precede the project's own first key.
  for (const [key, spread] of [['categories', '...p1Categories,'], ['components', '...p1Blocks,']]) {
    const blockAt = config.search(new RegExp(`^\\s*${key}:\\s*\\{`, 'm'));
    if (blockAt === -1) fail(`${label}: puck.config.tsx has no ${key} block`);
    const spreadAt = config.indexOf(spread, blockAt);
    const ownAt = config.slice(blockAt).search(/^\s{4}[A-Za-z][A-Za-z0-9]*:/m);
    if (spreadAt === -1) fail(`${label}: ${spread} is not inside ${key}`);
    if (ownAt !== -1 && spreadAt > blockAt + ownAt) {
      fail(`${label}: ${spread} comes after the project's own ${key}, so a collision would hide blocks`);
    }
  }

  // The template must not name the registry itself — blocks arrive by install.
  if (config.includes('@p1/')) fail(`${label}: puck.config.tsx references the code registry directly`);
}

function assertOptInBlocks(dir, label) {
  const installed = installedBlockNames(dir);
  if (installed.length !== 29) fail(`${label}: expected 29 block directories, got ${installed.length}`);

  for (const collider of COLLIDERS) {
    if (installed.includes(collider)) fail(`${label}: collider "${collider}" was installed`);
  }

  // Exactly one @import, and it must precede every rule or the browser drops it.
  const styles = fs.readFileSync(path.join(dir, 'app/styles.css'), 'utf-8');
  const imports = styles.match(/p1-tokens/g) ?? [];
  if (imports.length !== 1) fail(`${label}: expected exactly 1 tokens @import, got ${imports.length}`);
  const firstRuleAt = styles.search(/^[.#a-zA-Z[:][^\n]*\{/m);
  if (firstRuleAt !== -1 && styles.indexOf('p1-tokens') > firstRuleAt) {
    fail(`${label}: the tokens @import comes after a rule, so it will be dropped`);
  }

  // Registration is copy/paste now, so the served lines are the thing that can
  // be wrong. Each block's docs must import a value its file really exports —
  // the export does not always match the directory name.
  const served = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'packages/p1-starter-components/registry/p1/blocks/registry.json'), 'utf-8')
  ).items;
  const config = fs.readFileSync(path.join(dir, 'puck.config.tsx'), 'utf-8');
  const own = [...config.matchAll(/^\s+([A-Za-z0-9]+Block): /gm)].map((match) => match[1]);

  for (const name of installed) {
    const item = served.find((candidate) => candidate.name === name);
    if (!item) fail(`${label}: ${name} was installed but is not in the served registry`);
    if (!item.docs) fail(`${label}: ${name} serves no registration lines`);

    const [, exportName, source] = item.docs.match(/import \{ (\w+) \} from "\.\/[^/]+\/([^"]+)";/) ?? [];
    if (!exportName) fail(`${label}: ${name}'s docs have no import line to paste`);
    const file = fs.readFileSync(path.join(dir, 'components/puck/blocks', name, `${source}.tsx`), 'utf-8');
    if (!file.includes(`export const ${exportName}`)) {
      fail(`${label}: ${name}'s docs import ${exportName}, which ${source}.tsx does not export`);
    }

    const [, puckKey] = item.docs.match(/^ {2}(P1\w+): /m) ?? [];
    if (!puckKey) fail(`${label}: ${name}'s docs have no component key to paste`);
    if (own.includes(puckKey)) fail(`${label}: ${name}'s key ${puckKey} collides with a starter kit block`);

    // A colliding category key is the silent failure: the block stays registered
    // and disappears from the drawer.
    const [, categoryKey] = item.docs.match(/^ {2}(\w+): \{ title:/m) ?? [];
    if (!categoryKey) fail(`${label}: ${name}'s docs have no category line to paste`);
    if (!categoryKey.startsWith('p1')) fail(`${label}: ${name}'s category "${categoryKey}" is not namespaced`);
    if (STARTER_KIT_CATEGORIES.includes(categoryKey)) {
      fail(`${label}: ${name}'s category "${categoryKey}" collides with a starter kit category`);
    }
  }

  // The check that would have caught a missing tsconfig alias before a
  // customer's first build did.
  const resolvable = ['', '.ts', '.tsx', '.js', '.jsx', '.css', '/index.ts', '/index.tsx'];
  const sourceFiles = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) sourceFiles.push(full);
    }
  })(path.join(dir, 'components/puck/blocks'));

  const unresolved = [];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf-8');
    for (const match of source.matchAll(/from ['"]@\/([^'"]+)['"]/g)) {
      const target = path.join(dir, match[1]);
      if (!resolvable.some((extension) => fs.existsSync(target + extension))) {
        unresolved.push(`${path.relative(dir, file)} -> @/${match[1]}`);
      }
    }
  }
  if (unresolved.length) fail(`${label}: unresolved @/ imports:\n  ${unresolved.join('\n  ')}`);

  console.log(
    `✓ ${label}: ${installed.length} blocks installed, every served import/key/category line valid, ` +
      `${sourceFiles.length} files' @/ imports resolve`
  );
}

function assertOptOut(dir, label) {
  const installed = installedBlockNames(dir);
  if (installed.length) fail(`${label}: block directories were installed on the opt-out path`);

  const barrel = fs.readFileSync(path.join(dir, BARREL), 'utf-8');
  if (!barrel.includes('p1Blocks = {} satisfies')) {
    fail(`${label}: the barrel is not empty`);
  }
  if (/^\s*\/\/\s*(import|\.\.\.)/m.test(barrel)) {
    fail(`${label}: commented-out wiring was left in the barrel`);
  }
  const styles = fs.readFileSync(path.join(dir, 'app/styles.css'), 'utf-8');
  if (styles.includes('p1-tokens')) fail(`${label}: a tokens @import was added on the opt-out path`);

  console.log(`✓ ${label}: no blocks, empty barrel, untouched stylesheet`);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-scaffold-validation-'));
const scaffoldDir = path.join(workDir, PROJECT_NAME);
const optOutDir = path.join(workDir, `${PROJECT_NAME}-no-blocks`);
const tarballDir = path.join(workDir, 'tarballs');
fs.mkdirSync(tarballDir);
console.log(`Working directory: ${workDir}`);

try {
  run(process.execPath, [path.join(pkgRoot, 'scripts/build-template.js')]);

  // Before the scaffold is even generated: the install below would surface a
  // workspace specifier, but a monorepo-relative path or an undeclared internal
  // import only fails later, on a customer's machine.
  run(process.execPath, [path.join(pkgRoot, 'scripts/lint-template.js')]);

  // --blocks/--no-blocks explicitly rather than relying on --yes taking the
  // default: this job asserts both outcomes, so neither may drift with the default.
  run(
    process.execPath,
    [path.join(pkgRoot, 'index.js'), PROJECT_NAME, '--yes', '--pm', 'pnpm', '--no-git', '--no-install', '--blocks'],
    { cwd: workDir }
  );
  run(
    process.execPath,
    [path.join(pkgRoot, 'index.js'), `${PROJECT_NAME}-no-blocks`, '--yes', '--pm', 'pnpm', '--no-git', '--no-install', '--no-blocks'],
    { cwd: workDir }
  );

  assertScaffoldStructure(scaffoldDir);

  // Both paths must be able to add blocks later, and neither may carry a
  // scaffolder file into the customer's tree.
  for (const [dir, label] of [[scaffoldDir, 'opt-in'], [optOutDir, 'opt-out']]) {
    assertNoScaffolderArtefacts(dir, label);
    assertRegistryWiring(dir, label);
  }

  assertOptOut(optOutDir, 'opt-out');

  // The install needs the network. Zero blocks means something went wrong —
  // a genuine registry outage is worth knowing about, not silently skipping.
  assertOptInBlocks(scaffoldDir, 'opt-in');

  const overrides = packWorkspacePackages(tarballDir);
  pointScaffoldAtTarballs(scaffoldDir, overrides);

  // --no-frozen-lockfile because the step above deliberately diverges from the
  // lockfile: it repoints five dependencies at packed tarballs. The scaffold now
  // has a lockfile at all only because installing the block library resolves npm
  // dependencies, so under CI's default frozen install pnpm refuses the very
  // override this job exists to apply.
  run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: scaffoldDir });
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
