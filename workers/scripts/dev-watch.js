#!/usr/bin/env node
/**
 * Development Watch Script
 *
 * Watches for changes to Durable Object files and restarts wrangler
 * to ensure DO instances pick up code changes.
 *
 * Usage: node scripts/dev-watch.js
 * Or:    pnpm dev:watch
 */

import { spawn } from 'child_process';
import { watch } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// Directories to watch for DO-related changes
const WATCH_DIRS = [
  'src/durable-objects',
  'src/services',  // Services used by DOs
];

// Debounce delay (ms) to batch rapid changes
const DEBOUNCE_DELAY = 500;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, prefix, message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${color}[${timestamp}] [${prefix}]${colors.reset} ${message}`);
}

let wranglerProcess = null;
let restartTimer = null;
let isRestarting = false;

/**
 * Start the wrangler dev server
 */
function startWrangler() {
  log(colors.green, 'WRANGLER', 'Starting wrangler dev server...');

  wranglerProcess = spawn('pnpm', ['exec', 'wrangler', 'dev', '--local'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  });

  wranglerProcess.on('error', (err) => {
    log(colors.red, 'ERROR', `Failed to start wrangler: ${err.message}`);
  });

  wranglerProcess.on('exit', (code, signal) => {
    if (!isRestarting) {
      log(colors.yellow, 'WRANGLER', `Exited with code ${code}, signal ${signal}`);
    }
    wranglerProcess = null;
  });
}

/**
 * Stop the wrangler dev server
 */
async function stopWrangler() {
  if (!wranglerProcess) return;

  return new Promise((resolve) => {
    log(colors.yellow, 'WRANGLER', 'Stopping wrangler dev server...');

    // Kill the process group to ensure workerd is also killed
    try {
      process.kill(-wranglerProcess.pid, 'SIGTERM');
    } catch {
      // Process might already be dead
      wranglerProcess.kill('SIGTERM');
    }

    const timeout = setTimeout(() => {
      if (wranglerProcess) {
        log(colors.red, 'WRANGLER', 'Force killing...');
        try {
          process.kill(-wranglerProcess.pid, 'SIGKILL');
        } catch {
          wranglerProcess.kill('SIGKILL');
        }
      }
      resolve();
    }, 3000);

    wranglerProcess.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/**
 * Restart wrangler (debounced)
 */
function scheduleRestart(changedFile) {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(async () => {
    restartTimer = null;
    isRestarting = true;

    log(colors.cyan, 'WATCH', `Detected change: ${changedFile}`);
    log(colors.cyan, 'WATCH', 'Restarting wrangler to reload Durable Objects...');

    await stopWrangler();

    // Small delay to ensure port is released
    await new Promise((r) => setTimeout(r, 500));

    isRestarting = false;
    startWrangler();
  }, DEBOUNCE_DELAY);
}

/**
 * Set up file watchers
 */
function setupWatchers() {
  log(colors.blue, 'WATCH', 'Setting up file watchers...');

  for (const dir of WATCH_DIRS) {
    const fullPath = resolve(rootDir, dir);

    try {
      watch(fullPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Only watch TypeScript files
        if (!filename.endsWith('.ts')) return;

        // Ignore test files
        if (filename.includes('.spec.') || filename.includes('.test.')) return;

        scheduleRestart(`${dir}/${filename}`);
      });

      log(colors.blue, 'WATCH', `Watching: ${dir}`);
    } catch (err) {
      log(colors.red, 'ERROR', `Failed to watch ${dir}: ${err.message}`);
    }
  }
}

/**
 * Handle process termination
 */
function setupCleanup() {
  const cleanup = async () => {
    log(colors.yellow, 'CLEANUP', 'Shutting down...');
    if (restartTimer) clearTimeout(restartTimer);
    await stopWrangler();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// Main
console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════╗
║  Collaborative State System - Development Watch Mode        ║
║                                                              ║
║  Watching for Durable Object changes...                     ║
║  Wrangler will restart automatically when DO files change.  ║
║                                                              ║
║  Press Ctrl+C to stop.                                       ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

setupCleanup();
setupWatchers();
startWrangler();
