/**
 * All console output for the codemod, kept in one place. Plain text — no color
 * dependency — so the SDK's runtime deps stay unchanged.
 */

import { MIN_SUITE_VERSION } from "./detect.js";

const TAG = "[p1-migrate]";

export function help() {
  console.log(
    [
      "p1-migrate — migrate a P1 app to the persistent (editor) layout",
      "",
      "Usage: npx @pantheon-systems/p1-next-sdk p1-migrate [options]",
      "",
      "Options:",
      "  --dir=<path>   Project directory to migrate (default: current directory)",
      "  --dry-run      Show what would change without writing anything",
      "  --force, -f    Skip the clean-git-tree check",
      "  --help, -h     Show this help",
    ].join("\n"),
  );
}

export function alreadyMigrated() {
  console.log(`${TAG} Already on the (editor) layout — nothing to do.`);
}

export function noGitRepo() {
  console.log(
    `${TAG} Not a git repository — skipping the clean-tree check. This rewrites and ` +
      "removes files with no way to roll them back.",
  );
}

export function versionsUnverified() {
  console.log(
    `${TAG} Could not read installed @pantheon-systems/* versions — skipping the version check.`,
  );
  console.log(
    `${TAG} Make sure your dependencies are installed and on ${MIN_SUITE_VERSION} or newer.`,
  );
}

export function dryRunPlan(writePaths, oldDir) {
  console.log(`${TAG} Dry run — no files written. Planned changes:`);
  for (const p of writePaths) console.log(`  write   ${p}`);
  console.log(`  remove  ${oldDir}`);
}

export function success(writePaths, oldDir) {
  console.log(`${TAG} Migrated to the persistent (editor) layout:`);
  for (const p of writePaths) console.log(`  wrote   ${p}`);
  console.log(`  removed ${oldDir}`);
  console.log(`${TAG} Review the diff and commit when it looks right.`);
}

export function bail(message) {
  console.error(`${TAG} Could not migrate automatically: ${message}`);
}

export function unexpected(err) {
  console.error(`${TAG} Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
}
