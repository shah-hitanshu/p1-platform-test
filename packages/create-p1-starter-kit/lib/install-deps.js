import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ALLOWED_PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn']);

function assertAllowedPM(pm) {
  if (!ALLOWED_PACKAGE_MANAGERS.has(pm)) {
    throw new Error(`Unknown package manager: ${pm}`);
  }
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
