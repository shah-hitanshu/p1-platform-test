import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { readRegistryConfig, buildComponentsJson } from './registry-config.js';
import { dlxCommand, dlxInvocation } from './install-deps.js';

/** Writes the components.json a generated project needs. Both prompt paths. */
export function writeComponentsJson(targetDir, registryConfig = readRegistryConfig()) {
  const config = buildComponentsJson(registryConfig);
  fs.writeFileSync(path.join(targetDir, 'components.json'), JSON.stringify(config, null, 2) + '\n');
}

/**
 * The block directories the registry install left behind, which is how many
 * blocks landed. Reading directory names is not reading the user's code — this
 * runs immediately after the install, before anyone has edited anything.
 *
 * `_`-prefixed entries are not blocks; a shared registry dependency can land
 * as one. Exported so the scaffold validator counts what the user is told.
 */
export function installedBlockNames(targetDir) {
  const dir = path.join(targetDir, 'components/puck/blocks');
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    // An install that died early may never have created the directory.
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// A registry that refuses the connection fails fast, but one that drops packets
// — or a hung DNS or TLS handshake — blocks for the OS-level TCP timeout with
// both streams piped, so the user watches a spinner with nothing to read.
const INSTALL_TIMEOUT_MS = 120_000;

/**
 * The command that finishes the job by hand. Exported so the string can be
 * asserted without spawning a package runner: it differs per manager, and a test
 * that has to reach the network to check a message is a test that times out in CI
 * rather than one that catches a wrong command.
 */
export function recoveryCommand(packageManager, item) {
  return dlxCommand(packageManager, `shadcn@latest add ${item}`);
}

/**
 * Installs @p1/base into an already-copied template and reports what landed.
 *
 * Needs the network. A failure must leave the project usable: components.json
 * stays, so the user can run the install later.
 */
export function installP1Blocks(
  targetDir,
  { registryConfig = readRegistryConfig(), packageManager = 'pnpm', spawn = spawnSync } = {},
) {
  writeComponentsJson(targetDir, registryConfig);

  const item = `${registryConfig.namespace}/base`;
  // Same decision as the failure message below, so we never print a command
  // that differs from the one we ran.
  const { command, args } = dlxInvocation(packageManager, `shadcn@latest add ${item} --yes`);
  const result = spawn(command, args, {
    cwd: targetDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: INSTALL_TIMEOUT_MS,
    // SIGTERM reaches the direct child (pnpm dlx) only; shadcn's own spawned
    // processes are not in the signal set. Use async spawn + process-group kill
    // if the partial-write window proves a real issue in practice.
    killSignal: 'SIGTERM',
  });

  if (result.status !== 0) {
    // result.error, not just the streams: when the child cannot be launched at
    // all — npx off PATH, a missing corepack shim — Node leaves status null and
    // both streams empty, and the user would get the graceful warning with
    // nothing saying why. A missing runner and a dead registry must not look
    // identical.
    // A timed-out child is killed, so it looks exactly like a runner that could
    // not launch: status null, both streams empty. Say which it was.
    const detail =
      result.error?.code === 'ETIMEDOUT'
        ? `No response after ${INSTALL_TIMEOUT_MS / 1000}s, so the install was stopped.`
        : (result.stderr || result.stdout || result.error?.message || '')
            .trim()
            .split('\n')
            .slice(-5)
            .join('\n');
    // Directories can already be on disk when the install dies partway. Naming
    // them is the difference between a recoverable project and one that reports
    // itself clean while the barrel registers none of what is there.
    const landed = installedBlockNames(targetDir);
    const partial = landed.length
      ? `\n${landed.length} block ${landed.length === 1 ? 'directory' : 'directories'} already landed and ` +
        `${landed.length === 1 ? 'is' : 'are'} not registered: ${landed.join(', ')}.\n` +
        `Re-running the command below installs the rest.\n`
      : '';
    throw new Error(
      `Could not install the P1 component library from ${registryConfig.url}.\n${detail}\n${partial}\n` +
        `Your project is fine and components.json is configured — run this when you are ready:\n` +
        `  ${recoveryCommand(packageManager, item)}`,
    );
  }

  return installedBlockNames(targetDir);
}
