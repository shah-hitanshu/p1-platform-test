/**
 * Repair: re-pin published version snapshots [PCC-3652].
 *
 * CLI wrapper around repairPublishedSnapshots — see
 * src/services/published-snapshot-repair.ts for what it does and why.
 *
 * Run it per environment, against that environment's database, after the
 * worker carrying the compaction guard is deployed there (otherwise the next
 * edit strips the repaired rows again). Safe to re-run: it only ever fills
 * NULL snapshots, never overwrites one.
 *
 * Usage:
 *   pnpm db:repair-published-snapshots                    # Dry run - report only
 *   pnpm db:repair-published-snapshots:execute            # Write the repairs
 *   pnpm db:repair-published-snapshots --site=<uuid>      # Limit to one site
 *   pnpm db:repair-published-snapshots --limit=<n>        # Cap rows per run (pilot)
 *
 * Exits 2 when unrecoverable rows remain, so ops can alert on them.
 */

import './node-esm-compat';
import type { RepairEntry } from '../services/published-snapshot-repair';

// Dynamic imports so nothing in the services graph resolves before
// node-esm-compat's hooks are registered.
const { runWithConnection } = await import('../db');
const { repairPublishedSnapshots } = await import('../services/published-snapshot-repair');

const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

function printEntries(label: string, entries: RepairEntry[]): void {
  console.log(`${label}: ${String(entries.length)}`);
  for (const entry of entries) {
    console.log(
      `  - site=${entry.siteId} path=${entry.path} v${String(entry.versionNumber)} `
      + `(document ${entry.documentId}, branch ${entry.branchId})`,
    );
  }
}

function parseFlag(argv: string[], name: string): string | undefined {
  const flag = argv.find((arg) => arg.startsWith(`--${name}=`));
  return flag?.slice(`--${name}=`.length);
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute;
  const siteId = parseFlag(process.argv, 'site');
  const limitFlag = parseFlag(process.argv, 'limit');
  const limit = limitFlag !== undefined ? Number.parseInt(limitFlag, 10) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit must be a positive integer, got "${limitFlag ?? ''}"`);
  }

  console.log('Published Snapshot Repair');
  console.log('=========================\n');
  if (dryRun) {
    console.log('Dry run (no snapshots will be written). Pass --execute to apply.\n');
  }
  if (siteId !== undefined) {
    console.log(`Limited to site ${siteId}.\n`);
  }
  if (limit !== undefined) {
    console.log(`Capped at ${String(limit)} row(s) this run.\n`);
  }

  const result = await runWithConnection(
    DATABASE_URL,
    { isHyperdrive: false },
    () => repairPublishedSnapshots({ dryRun, siteId, limit }),
  );

  printEntries(dryRun ? 'Would repair' : 'Repaired', result.repaired);
  if (result.unrecoverable.length > 0) {
    printEntries(
      '\nUnrecoverable — chain broken below the published version; the '
      + 'document needs a fresh publish from a healthy tip',
      result.unrecoverable,
    );
    process.exitCode = 2;
  }
}

// No process.exit(): stdout to a pipe is asynchronous, and exiting eagerly can
// truncate the unrecoverable list that exit code 2 points at. process.exitCode
// lets the process drain and end naturally with the same code.
main().catch((error: unknown) => {
  console.error('Repair failed:', error);
  process.exitCode = 1;
});
