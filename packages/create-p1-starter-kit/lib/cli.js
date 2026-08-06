import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as clack from '@clack/prompts';
import pc from 'picocolors';
import { copyTemplate } from './copy-template.js';
import { detectPackageManager, isPackageManagerAvailable, installDependencies } from './install-deps.js';
import { showWelcome, showSuccess, showInstallHelp, showError } from './messages.js';

export async function runCLI() {
  showWelcome();

  const args = process.argv.slice(2);
  const targetDirArg = args[0];

  clack.intro(pc.bgCyan(pc.black(' P1 Starter Kit Setup ')));

  // Get project name
  const projectName = await clack.text({
    message: 'What is your project named?',
    placeholder: 'my-p1-app',
    initialValue: targetDirArg || 'my-p1-app',
    validate: (value) => {
      if (!value) return 'Please enter a project name';
      if (!/^[a-z0-9-_]+$/.test(value)) {
        return 'Project name must be lowercase and can only contain letters, numbers, hyphens, and underscores';
      }
      return undefined;
    },
  });

  if (clack.isCancel(projectName)) {
    clack.cancel('Operation cancelled');
    process.exit(0);
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  // Check if directory already exists before prompting further
  if (fs.existsSync(targetDir)) {
    showError(`Directory "${projectName}" already exists. Please choose a different name or remove the existing directory.`);
    process.exit(1);
  }

  // Detect package manager
  const detectedPM = detectPackageManager();
  const packageManager = await clack.select({
    message: 'Which package manager do you want to use?',
    options: [
      { value: 'pnpm', label: 'pnpm', hint: detectedPM === 'pnpm' ? 'detected' : '' },
      { value: 'npm', label: 'npm', hint: detectedPM === 'npm' ? 'detected' : '' },
      { value: 'yarn', label: 'yarn', hint: detectedPM === 'yarn' ? 'detected' : '' },
    ],
    initialValue: detectedPM,
  });

  if (clack.isCancel(packageManager)) {
    clack.cancel('Operation cancelled');
    process.exit(0);
  }

  // Check if package manager is available
  if (!isPackageManagerAvailable(packageManager)) {
    showError(`${packageManager} is not installed. Please install it first or choose a different package manager.`);
    process.exit(1);
  }

  // Git init?
  const shouldInitGit = await clack.confirm({
    message: 'Initialize a git repository?',
    initialValue: true,
  });

  if (clack.isCancel(shouldInitGit)) {
    clack.cancel('Operation cancelled');
    process.exit(0);
  }

  // Install deps?
  const shouldInstall = await clack.confirm({
    message: 'Install dependencies now?',
    initialValue: true,
  });

  if (clack.isCancel(shouldInstall)) {
    clack.cancel('Operation cancelled');
    process.exit(0);
  }

  const s = clack.spinner();

  // Create directory and copy template
  s.start('Copying template files...');
  try {
    fs.mkdirSync(targetDir, { recursive: false });
    copyTemplate(targetDir, projectName);
    s.stop('Template files copied');
  } catch (error) {
    s.stop('Failed to copy template');
    if (error.code === 'EEXIST') {
      showError(`Directory "${projectName}" already exists. Please choose a different name or remove the existing directory.`);
    } else {
      showError(error.message);
    }
    // Clean up on failure (skip if dir already existed)
    if (error.code !== 'EEXIST') {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    process.exit(1);
  }

  // Git init
  if (shouldInitGit) {
    s.start('Initializing git repository...');
    try {
      execSync('git init', { cwd: targetDir, stdio: 'ignore' });
      execSync('git add -A', { cwd: targetDir, stdio: 'ignore' });
      execSync('git commit -m "Initial commit from create-p1-starter-kit"', {
        cwd: targetDir,
        stdio: 'ignore',
      });
      s.stop('Git repository initialized');
    } catch (error) {
      s.stop('Failed to initialize git');
      showError(`Git initialization failed: ${error.message}`);
    }
  }

  // Install dependencies
  if (shouldInstall) {
    s.start('Installing dependencies (this may take a while)...');
    const result = installDependencies(targetDir, packageManager);

    if (result.success) {
      s.stop('Dependencies installed');
    } else {
      s.stop('Dependency installation failed');
      showInstallHelp(packageManager);
      // Note: We don't clean up on install failure as user may want to retry manually
    }
  }

  clack.outro(pc.green('All done!'));
  showSuccess(projectName, targetDir, packageManager);
}
