/**
 * Repair: rebuild version-history snapshots from the successor's patch [PCC-3719].
 *
 * CLI wrapper around repairVersionHistorySnapshots — see
 * src/services/version-history-repair.ts for what it does and why.
 *
 * Run it per environment, against that environment's database, after the
 * worker carrying the compaction guard is deployed there. Safe to re-run: it
 * only ever fills NULL snapshots, never overwrites one.
 *
 * Usage, from workers/ccr with POSTGRES_CONNECTION_STRING set:
 *   tsx scripts/maintenance/repair-version-history-snapshots.ts
 *     (no flags)          Dry run - report what it would rebuild
 *     --execute           Write the repairs
 *     --site=<uuid>       Limit to one site
 *     --limit=<n>         Cap rows per run (pilot)
 *     --skip-registry     Leave _registry/* documents alone
 *     --audit=<path>      Record the ids of every row written
 *
 * Exits 2 when rows remain that this repair cannot rebuild, so ops can alert
 * on them.
 */

import '../../src/db/node-esm-compat';
import { writeFileSync } from 'node:fs';
import type { RepairEntry, SkippedEntry } from '../../src/services/version-history-repair';

// Dynamic imports so nothing in the services graph resolves before
// node-esm-compat's hooks are registered.
const { runWithConnection } = await import('../../src/db');
const { repairVersionHistorySnapshots } = await import('../../src/services/version-history-repair');

const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

const SUMMARY_SITE_COUNT = 10;
const SAMPLE_ROW_COUNT = 25;

function describe(entry: RepairEntry): string {
  return `site=${entry.siteId} path=${entry.path} v${String(entry.versionNumber)} `
    + `(document ${entry.documentId}, branch ${entry.branchId})`;
}

function printCounts(label: string, entries: RepairEntry[]): void {
  console.log(`${label}: ${String(entries.length)}`);
  const bySite = new Map<string, number>();
  for (const entry of entries) {
    bySite.set(entry.siteId, (bySite.get(entry.siteId) ?? 0) + 1);
  }
  const ranked = [...bySite.entries()].sort((a, b) => b[1] - a[1]);
  for (const [siteId, count] of ranked.slice(0, SUMMARY_SITE_COUNT)) {
    console.log(`  ${siteId}: ${String(count)}`);
  }
  if (ranked.length > SUMMARY_SITE_COUNT) {
    console.log(`  ... and ${String(ranked.length - SUMMARY_SITE_COUNT)} more site(s)`);
  }
}

function printSkipped(label: string, entries: SkippedEntry[]): void {
  console.log(`\n${label}: ${String(entries.length)}`);
  const byReason = new Map<string, SkippedEntry[]>();
  for (const entry of entries) {
    const bucket = byReason.get(entry.reason) ?? [];
    bucket.push(entry);
    byReason.set(entry.reason, bucket);
  }
  for (const [reason, bucket] of byReason) {
    console.log(`  ${reason}: ${String(bucket.length)}`);
    for (const entry of bucket.slice(0, SAMPLE_ROW_COUNT)) {
      console.log(`    - ${describe(entry)}`);
    }
    if (bucket.length > SAMPLE_ROW_COUNT) {
      console.log(
        `    ... and ${String(bucket.length - SAMPLE_ROW_COUNT)} more; `
        + 'pass --site to inventory one site in full',
      );
    }
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
  const skipRegistry = process.argv.includes('--skip-registry');
  const auditPath = parseFlag(process.argv, 'audit');

  console.log('Version History Snapshot Repair');
  console.log('==============================\n');
  if (dryRun) {
    console.log('Dry run (no snapshots will be written). Pass --execute to apply.\n');
  }
  if (siteId !== undefined) {
    console.log(`Limited to site ${siteId}.\n`);
  }
  if (limit !== undefined) {
    console.log(`Capped at ${String(limit)} row(s) this run.\n`);
  }
  if (skipRegistry) {
    console.log('Skipping _registry/* documents.\n');
  }

  const result = await runWithConnection(
    DATABASE_URL,
    { isHyperdrive: false },
    () => repairVersionHistorySnapshots({ dryRun, siteId, limit, skipRegistry }),
  );

  printCounts(dryRun ? 'Would repair' : 'Repaired', result.repaired);

  if (result.fallbackRows > 0) {
    console.log(
      `\n${String(result.fallbackRows)} row(s) fell back to a statement each after a `
      + 'batch was rejected — expect the run to be much slower than usual.',
    );
  }

  if (auditPath !== undefined && !dryRun) {
    writeFileSync(auditPath, result.repaired.map((e) => e.versionId).join('\n') + '\n');
    console.log(`\nWrote ${String(result.repaired.length)} row id(s) to ${auditPath}`);
  }

  if (result.writeFailed.length > 0) {
    printSkipped('Write failed', result.writeFailed);
  }
  if (result.nonInvertible.length > 0) {
    printSkipped('Not rebuildable from the version above', result.nonInvertible);
  }
  if (result.chainBlocked.length > 0) {
    printSkipped('Blocked by a damaged version above', result.chainBlocked);
  }
  if (
    result.writeFailed.length > 0
    || result.nonInvertible.length > 0
    || result.chainBlocked.length > 0
  ) {
    process.exitCode = 2;
  }
}

// No process.exit(): stdout to a pipe is asynchronous, and exiting eagerly can
// truncate the inventory that exit code 2 points at.
main().catch((error: unknown) => {
  console.error('Repair failed:', error);
  process.exitCode = 1;
});
