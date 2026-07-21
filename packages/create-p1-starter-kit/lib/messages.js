import pc from 'picocolors';

export function showWelcome() {
  console.log(pc.bold(pc.cyan('\n┌─────────────────────────────────────────┐')));
  console.log(pc.bold(pc.cyan('│  Create P1 Starter Kit                  │')));
  console.log(pc.bold(pc.cyan('└─────────────────────────────────────────┘\n')));
}

export function showSuccess(projectName, projectPath, packageManager) {
  console.log(pc.green('\n✔ Project created successfully!\n'));
  console.log(`${pc.bold('Next steps:')}\n`);
  console.log(`  ${pc.cyan('cd')} ${projectName}`);
  console.log(`  ${pc.dim('# Copy .env.example to .env and fill in your credentials:')}`);
  console.log(`  ${pc.cyan('cp')} .env.example .env`);
  console.log(`  ${pc.dim('# Edit .env with your PCC_SITE_ID and PCC_TOKEN')}\n`);
  const devCmd = packageManager === 'npm' ? 'npm run dev' : `${packageManager} dev`;
  console.log(`  ${pc.dim('# Start the dev server:')}`);
  console.log(`  ${pc.cyan(devCmd)}\n`);
  console.log(pc.bold('Happy building! 🚀\n'));
}

export function showInstallHelp(packageManager) {
  console.log(pc.yellow('\n⚠️  Dependency installation failed.\n'));
  console.log(`Try running ${pc.cyan(`${packageManager} install`)} manually.\n`);
}

export function showError(message) {
  console.error(pc.red(`\n✖ Error: ${message}\n`));
}
