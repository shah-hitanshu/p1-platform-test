#!/usr/bin/env node

const cmd = process.argv[2];
// Both runners default to process.argv.slice(2), which still holds the
// subcommand — pass the rest explicitly or each one parses its own name as a
// user argument.
const args = process.argv.slice(3);
if (cmd === 'migrate') {
  const { runCLI } = await import('./lib/cli.js');
  runCLI(args);
} else if (cmd === 'enable-registry') {
  const { runEnableCLI } = await import('./lib/enable-cli.js');
  runEnableCLI(args);
} else {
  console.error('Usage: p1-next-sdk <migrate|enable-registry>');
  process.exit(1);
}
