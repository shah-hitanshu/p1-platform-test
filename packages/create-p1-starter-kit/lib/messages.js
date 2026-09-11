import pc from 'picocolors';
import { dlxCommand } from './install-deps.js';

/**
 * One worked example of registering a block, shown after the library installs.
 * Exported so a test can hold it against what the registry actually serves for
 * this block — a stale example teaches a broken import.
 */
export const EXAMPLE_BLOCK = 'pricing';
export const EXAMPLE_REGISTRATION = [
  'import { PricingBlock } from "./pricing/pricing.block";',
  '',
  'P1Pricing: PricingBlock,  // add to p1Blocks',
  '',
  '// in p1Categories — create the entry if it does not exist yet:',
  'p1Convert: { title: "P1 Convert", components: ["P1Pricing"] },',
  '// or, if p1Convert already exists, add to its components array (no duplicate key):',
  '// p1Convert: { title: "P1 Convert", components: ["P1Pricing", "P1CTA"] },',
];

export function showWelcome() {
  console.log(pc.bold(pc.cyan('\n┌─────────────────────────────────────────┐')));
  console.log(pc.bold(pc.cyan('│  Create P1 Starter Kit                  │')));
  console.log(pc.bold(pc.cyan('└─────────────────────────────────────────┘\n')));
}

export function showSuccess(projectName, _projectPath, packageManager, options = {}) {
  // The namespace is stamped at build time, so the command printed here has to
  // come from the same source as the components.json it was written into.
  const libraryItem = `${options.registryNamespace ?? '@p1'}/base`;
  console.log(pc.green('\n✔ Project created successfully!\n'));
  console.log(`${pc.bold('Next steps:')}\n`);
  console.log(`  ${pc.cyan('cd')} ${projectName}`);
  console.log(`  ${pc.dim('# Copy .env.example to .env and fill in your credentials:')}`);
  console.log(`  ${pc.cyan('cp')} .env.example .env`);
  console.log(`  ${pc.dim('# Edit .env with your NEXT_PUBLIC_CSS_SITE_ID and CSS_API_KEY')}\n`);
  const devCmd = packageManager === 'npm' ? 'npm run dev' : `${packageManager} dev`;
  console.log(`  ${pc.dim('# Start the dev server:')}`);
  console.log(`  ${pc.cyan(devCmd)}\n`);

  if (options.p1Blocks > 0) {
    if (options.p1BlocksPartial) {
      // Reached only when the install died with blocks already on disk. Without
      // it the next lines read as though the whole library were there.
      console.log(`  ${pc.dim('# The install did not finish. Re-run it for the rest:')}`);
      console.log(`  ${pc.cyan(dlxCommand(packageManager, `shadcn@latest add ${libraryItem}`))}\n`);
    }
    console.log(
      `  ${pc.dim(`# ${options.p1Blocks} P1 blocks are in components/puck/blocks — yours to edit.`)}\n`,
    );
    console.log(`  ${pc.dim('# Using one takes three lines in components/puck/blocks/index.ts.')}`);
    console.log(`  ${pc.dim(`# For example, to use the ${EXAMPLE_BLOCK} block:`)}\n`);
    for (const line of EXAMPLE_REGISTRATION) console.log(line ? `    ${pc.cyan(line)}` : '');
    console.log('');
    console.log(`  ${pc.dim('# Repeat for each block you want. A block\'s export name is at the top of')}`);
    console.log(`  ${pc.dim('# components/puck/blocks/<name>/<name>.block.tsx — it does not always match')}`);
    console.log(`  ${pc.dim('# the directory. Blocks you never register cost nothing.')}\n`);
  } else {
    const addCmd = dlxCommand(packageManager, `shadcn@latest add ${libraryItem}`);
    console.log(`  ${pc.dim('# Add the P1 block library any time:')}`);
    console.log(`  ${pc.cyan(addCmd)}`);
    console.log(
      `  ${pc.dim('# Installing a block prints the lines to paste into components/puck/blocks/index.ts.')}\n`,
    );
  }

  console.log(pc.bold('Happy building! 🚀\n'));
}

export function showInstallHelp(packageManager) {
  console.log(pc.yellow('\n⚠️  Dependency installation failed.\n'));
  console.log(`Try running ${pc.cyan(`${packageManager} install`)} manually.\n`);
}

export function showError(message) {
  console.error(pc.red(`\n✖ Error: ${message}\n`));
}
