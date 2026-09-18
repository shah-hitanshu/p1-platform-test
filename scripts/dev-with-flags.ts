#!/usr/bin/env tsx
/**
 * Runs a dev command with browser feature flags forced on locally.
 *
 * Wraps the dev scripts so `pnpm dev:stack -- --flags=p1-collaboration` starts the stack with
 * that flag answered locally, instead of asking LaunchDarkly for a flag that may not exist in
 * the dashboard yet. Every argument that is not a `--flags=` value is passed through untouched.
 *
 * The spelling is checked here because nothing downstream can complain about it: a published
 * package must not log, so the SDK ignores a key it does not recognise, and a typo would look
 * exactly like a flag that is switched off.
 */
import { spawn } from 'node:child_process';

import { P1_EXPERIMENTAL_FEATURE_FLAGS } from '../packages/p1-next-sdk/src/experimental-features/features.js';
import { FLAG_OVERRIDES_VAR } from '../packages/p1-next-sdk/src/experimental-features/local-overrides.js';

const FLAG_PREFIX = '--flags=';

const GATED_KEYS: string[] = Object.values(P1_EXPERIMENTAL_FEATURE_FLAGS);

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main(): void {
  const requested: string[] = [];
  const command: string[] = [];

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(FLAG_PREFIX)) {
      requested.push(...arg.slice(FLAG_PREFIX.length).split(',').map((key) => key.trim()).filter(Boolean));
    } else {
      command.push(arg);
    }
  }

  if (command.length === 0) {
    fail(`Usage: tsx scripts/dev-with-flags.ts [${FLAG_PREFIX}<key>,<key>] <command> [args...]`);
  }

  const unknown = requested.filter((key) => !GATED_KEYS.includes(key));
  if (unknown.length > 0) {
    fail(
      `Unknown flag key(s): ${unknown.join(', ')}\n` +
        `  Overridable in the browser: ${GATED_KEYS.join(', ')}\n` +
        '  A flag read anywhere else — a worker, or a provider of its own — is not reachable from here.',
    );
  }

  const env = { ...process.env };
  if (requested.length > 0) {
    env[FLAG_OVERRIDES_VAR] = requested.join(',');
    process.stdout.write(`${FLAG_OVERRIDES_VAR}=${env[FLAG_OVERRIDES_VAR]}\n`);
  }

  const [bin, ...args] = command;
  const child = spawn(bin, args, { stdio: 'inherit', env });

  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
  });
  child.on('error', (error) => {
    fail(`Could not run ${bin}: ${error.message}`);
  });
}

main();
