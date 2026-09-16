// Scaffold a starter site from this working tree into a directory you keep, so
// unreleased template and package code can be exercised in a real app. CI's
// scripts/validate-scaffold.js runs the same steps into a temp dir it deletes.
//
//   node scripts/scaffold-local.js ~/pantheon/assorted-repos/my-site
//
// Options:
//   --published        install the released @pantheon-systems packages instead of
//                      packing this checkout's (template-only changes)
//   --pm <pnpm|npm|yarn>   package manager recorded in the scaffold (default pnpm)
//   --no-verify        skip the typecheck / test / build pass
//   --force            replace an existing target directory
//
// Packed tarballs are vendored into <target>/local-tarballs and referenced
// relatively, so the site still installs after /tmp is swept.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  assertTarballsInstalled,
  fail,
  installIgnoringWorkspaceStateCache,
  packWorkspacePackages,
  pointScaffoldAtTarballs,
  run,
} from './lib/packed-overrides.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');

const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn'];

function parseArgs(argv) {
  const parsed = { target: '', pm: 'pnpm', published: false, verify: true, force: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--published') parsed.published = true;
    else if (arg === '--no-verify') parsed.verify = false;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--pm' || arg.startsWith('--pm=')) {
      parsed.pm = arg === '--pm' ? argv[++i] : arg.slice('--pm='.length);
      if (!PACKAGE_MANAGERS.includes(parsed.pm)) {
        fail(`--pm must be one of ${PACKAGE_MANAGERS.join(', ')}`);
      }
    } else if (arg.startsWith('-')) fail(`Unknown option: ${arg}`);
    else if (parsed.target) fail(`Unexpected argument: ${arg}`);
    else parsed.target = arg;
  }

  if (!parsed.target) fail('Usage: node scripts/scaffold-local.js <target-directory> [options]');
  return parsed;
}

function resolveTarget({ target, force }) {
  const dir = path.resolve(target.startsWith('~') ? target.replace('~', os.homedir()) : target);

  if (fs.existsSync(dir)) {
    if (!force) fail(`${dir} already exists — pass --force to replace it`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (!fs.existsSync(path.dirname(dir))) fail(`${path.dirname(dir)} does not exist`);

  return dir;
}

function scaffold(options) {
  const scaffoldDir = resolveTarget(options);
  const projectName = path.basename(scaffoldDir);

  run(process.execPath, [path.join(pkgRoot, 'scripts/build-template.js')]);
  run(process.execPath, [path.join(pkgRoot, 'scripts/lint-template.js')]);

  // The CLI creates the directory itself, so it runs from the parent.
  run(
    process.execPath,
    [path.join(pkgRoot, 'index.js'), projectName, '--yes', '--pm', options.pm, '--git', '--no-install'],
    { cwd: path.dirname(scaffoldDir) }
  );

  if (options.published) {
    console.log('\n→ --published: installing the released packages, not this checkout');
    installIgnoringWorkspaceStateCache(scaffoldDir);
  } else {
    const overrides = packWorkspacePackages(repoRoot, path.join(scaffoldDir, 'local-tarballs'), {
      specPrefix: './local-tarballs/',
    });
    pointScaffoldAtTarballs(scaffoldDir, overrides);
    installIgnoringWorkspaceStateCache(scaffoldDir);
    assertTarballsInstalled(scaffoldDir, overrides);
  }

  if (options.verify) {
    for (const script of ['typecheck', 'test', 'build']) {
      run('pnpm', ['run', script], { cwd: scaffoldDir });
    }
  }

  console.log(`\n✓ Scaffolded ${projectName} at ${scaffoldDir}`);
  console.log('  Next: cp .env.example .env.local and fill in the site ID, API key and base URLs —');
  console.log('  the site renders no content until it points at a P1 site.');
}

try {
  scaffold(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}
