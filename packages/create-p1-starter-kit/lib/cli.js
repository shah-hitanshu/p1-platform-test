import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as clack from '@clack/prompts';
import pc from 'picocolors';
import { copyTemplate } from './copy-template.js';
import { detectPackageManager, isPackageManagerAvailable, installDependencies } from './install-deps.js';
import { installP1Blocks, installedBlockNames, writeComponentsJson } from './install-p1-blocks.js';
import { readNamespaceForDisplay } from './registry-config.js';
import { showWelcome, showSuccess, showInstallHelp, showError } from './messages.js';

const PROJECT_NAME_RULE =
  'Project name must be lowercase and can only contain letters, numbers, hyphens, and underscores';

function validateProjectName(value) {
  if (!value) return 'Please enter a project name';
  if (!/^[a-z0-9-_]+$/.test(value)) return PROJECT_NAME_RULE;
  return undefined;
}

const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn']);

export function parseArgs(args) {
  const parsed = { projectName: undefined, yes: false, pm: undefined, git: undefined, install: undefined };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--yes' || arg === '-y') {
      parsed.yes = true;
    } else if (arg === '--pm' || arg.startsWith('--pm=')) {
      const value = arg === '--pm' ? args[++i] : arg.slice('--pm='.length);
      if (!PACKAGE_MANAGERS.has(value)) {
        throw new Error(`--pm must be one of: ${[...PACKAGE_MANAGERS].join(', ')}`);
      }
      parsed.pm = value;
    } else if (arg === '--git' || arg === '--no-git') {
      parsed.git = arg === '--git';
    } else if (arg === '--install' || arg === '--no-install') {
      parsed.install = arg === '--install';
    } else if (arg === '--blocks' || arg === '--no-blocks') {
      parsed.blocks = arg === '--blocks';
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (parsed.projectName === undefined) {
      parsed.projectName = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

export async function runCLI() {
  showWelcome();

  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    showError(error.message);
    process.exit(1);
  }

  clack.intro(pc.bgCyan(pc.black(' P1 Starter Kit Setup ')));

  // Get project name
  let projectName;
  if (parsed.yes) {
    projectName = parsed.projectName || 'my-p1-app';
    const problem = validateProjectName(projectName);
    if (problem) {
      showError(problem);
      process.exit(1);
    }
  } else {
    projectName = await clack.text({
      message: 'What is your project named?',
      placeholder: 'my-p1-app',
      initialValue: parsed.projectName || 'my-p1-app',
      validate: validateProjectName,
    });

    if (clack.isCancel(projectName)) {
      clack.cancel('Operation cancelled');
      process.exit(0);
    }
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  // Check if directory already exists before prompting further
  if (fs.existsSync(targetDir)) {
    showError(`Directory "${projectName}" already exists. Please choose a different name or remove the existing directory.`);
    process.exit(1);
  }

  // Detect package manager
  const detectedPM = detectPackageManager();
  let packageManager;
  if (parsed.pm) {
    packageManager = parsed.pm;
  } else if (parsed.yes) {
    packageManager = detectedPM;
  } else {
    packageManager = await clack.select({
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
  }

  // Git init?
  let shouldInitGit;
  if (parsed.git !== undefined) {
    shouldInitGit = parsed.git;
  } else if (parsed.yes) {
    shouldInitGit = true;
  } else {
    shouldInitGit = await clack.confirm({
      message: 'Initialize a git repository?',
      initialValue: true,
    });

    if (clack.isCancel(shouldInitGit)) {
      clack.cancel('Operation cancelled');
      process.exit(0);
    }
  }

  // P1 component library?
  let shouldAddP1Blocks;
  if (parsed.blocks !== undefined) {
    shouldAddP1Blocks = parsed.blocks;
  } else if (parsed.yes) {
    shouldAddP1Blocks = true;
  } else {
    shouldAddP1Blocks = await clack.confirm({
      message: 'Include the P1 starter component library?',
      initialValue: true,
    });

    if (clack.isCancel(shouldAddP1Blocks)) {
      clack.cancel('Operation cancelled');
      process.exit(0);
    }
  }

  // Install deps?
  let shouldInstall;
  if (parsed.install !== undefined) {
    shouldInstall = parsed.install;
  } else if (parsed.yes) {
    shouldInstall = true;
  } else {
    shouldInstall = await clack.confirm({
      message: 'Install dependencies now?',
      initialValue: true,
    });

    if (clack.isCancel(shouldInstall)) {
      clack.cancel('Operation cancelled');
      process.exit(0);
    }
  }

  if (shouldInstall && !isPackageManagerAvailable(packageManager)) {
    showError(`${packageManager} is not installed. Please install it first or choose a different package manager.`);
    process.exit(1);
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

  // Deliberately outside the try above, which deletes targetDir on failure: a
  // network problem should warn and leave a usable project, not destroy one.
  let installedBlockCount = 0;
  let p1BlocksPartial = false;
  if (shouldAddP1Blocks) {
    s.start('Installing the P1 component library...');
    try {
      installedBlockCount = installP1Blocks(targetDir, { packageManager }).length;
      s.stop(`Installed ${installedBlockCount} P1 blocks`);
    } catch (error) {
      s.stop('Could not install the P1 component library');
      clack.log.warn(error.message);
      // Blocks can land before the failure. Counting them keeps the closing
      // message from offering the library as though nothing were installed.
      installedBlockCount = installedBlockNames(targetDir).length;
      p1BlocksPartial = installedBlockCount > 0;
      // installP1Blocks resolves the registry manifest while binding its
      // arguments, so a manifest problem throws before it writes anything,
      // leaving a project that cannot add blocks later. Only written when it is
      // genuinely absent: a spawn that failed midway has already written it,
      // and shadcn may have edited it since.
      if (!fs.existsSync(path.join(targetDir, 'components.json'))) {
        try {
          writeComponentsJson(targetDir);
        } catch (writeError) {
          clack.log.warn(`Could not write components.json: ${writeError.message}`);
        }
      }
    }
  } else {
    // components.json is written either way, so declining today does not mean
    // looking up a registry URL tomorrow.
    try {
      writeComponentsJson(targetDir);
    } catch (error) {
      clack.log.warn(`Could not write components.json: ${error.message}`);
    }
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
  showSuccess(projectName, targetDir, packageManager, {
    p1Blocks: installedBlockCount,
    p1BlocksPartial,
    registryNamespace: readNamespaceForDisplay(),
  });
}
