import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ALLOWED_PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn']);

function assertAllowedPM(pm) {
  if (!ALLOWED_PACKAGE_MANAGERS.has(pm)) {
    throw new Error(`Unknown package manager: ${pm}`);
  }
}

let cachedYarnMajor;

/**
 * `dlx` arrived in Yarn 2. Probed once, and treated as Classic when yarn cannot
 * be asked at all — npx ships with Node, so it is always the safe fallback.
 */
function detectYarnMajor() {
  if (cachedYarnMajor === undefined) {
    try {
      // stderr ignored: under corepack, yarn writes a notice about the project's
      // configured manager, and that would land in the middle of our own output.
      const version = execFileSync('yarn', ['--version'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const major = Number.parseInt(version.split('.')[0], 10);
      cachedYarnMajor = Number.isInteger(major) ? major : 1;
    } catch {
      cachedYarnMajor = 1;
    }
  }
  return cachedYarnMajor;
}

/**
 * Which runner can execute a one-off package for this manager. Takes the yarn
 * major rather than probing, so both branches are assertable without depending
 * on whichever yarn happens to be installed where the tests run.
 *
 * On Yarn Classic `dlx` does not exist, so the spawn fails and the caller blames
 * the registry for what is really an uninvokable command.
 */
export function dlxRunnerFor(packageManager, yarnMajor) {
  if (packageManager === 'pnpm') return 'pnpm';
  if (packageManager === 'yarn' && yarnMajor >= 2) return 'yarn';
  return 'npx';
}

function dlxRunner(packageManager) {
  // Only yarn's major matters, and probing for it spawns a process — npm and
  // pnpm users should not pay for a yarn lookup that cannot change the answer.
  if (packageManager !== 'yarn') return dlxRunnerFor(packageManager, 1);
  return dlxRunnerFor(packageManager, detectYarnMajor());
}

/**
 * The one-off runner as a string, for user-facing output. npm has no `dlx`, and
 * neither does Yarn Classic. Derived here rather than rebuilt at each call site
 * so the command we print is always the command we would run.
 */
export function dlxCommand(packageManager, spec) {
  const runner = dlxRunner(packageManager);
  return runner === 'npx' ? `npx ${spec}` : `${runner} dlx ${spec}`;
}

/** The same decision, shaped for spawnSync. */
export function dlxInvocation(packageManager, spec) {
  const runner = dlxRunner(packageManager);
  const args = spec.split(' ');
  return runner === 'npx' ? { command: 'npx', args } : { command: runner, args: ['dlx', ...args] };
}

export function detectPackageManager() {
  // Check if pnpm-lock.yaml exists in parent directories
  if (findFileInParents('pnpm-lock.yaml')) {
    return 'pnpm';
  }

  // Check if yarn.lock exists
  if (findFileInParents('yarn.lock')) {
    return 'yarn';
  }

  // Default to npm
  return 'npm';
}

function findFileInParents(filename) {
  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    if (fs.existsSync(path.join(currentDir, filename))) {
      return true;
    }
    currentDir = path.dirname(currentDir);
  }

  return false;
}

export function isPackageManagerAvailable(pm) {
  assertAllowedPM(pm);
  try {
    execSync(`${pm} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function installDependencies(targetDir, packageManager) {
  assertAllowedPM(packageManager);
  const installCmd = packageManager === 'yarn' ? 'yarn' : `${packageManager} install`;

  try {
    execSync(installCmd, {
      cwd: targetDir,
      stdio: 'inherit',
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}
