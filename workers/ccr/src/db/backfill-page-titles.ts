/**
 * Backfill: moves a legacy top-level snapshot `title` to `root.props.title` for
 * the latest version of each document.
 *
 * Listings COALESCE both locations, so this is not required for correctness — it
 * is cleanup. Once every environment has been backfilled, the legacy arm of that
 * COALESCE can be dropped.
 *
 * Run it per environment, against that environment's database, and only after
 * the worker that writes the canonical location is deployed there. It writes one
 * new version per converted document, skips anything already canonical, and is
 * safe to re-run.
 *
 * Usage:
 *   pnpm db:backfill-page-titles                    # Dry run - show what would convert
 *   pnpm db:backfill-page-titles:execute            # Write the new versions
 *   pnpm db:backfill-page-titles --site=<uuid>      # Limit to one site
 */

import { createRequire } from 'node:module';
import type {
  BackfillEntry,
  BackfillSkipReason,
  SkippedEntry,
} from '../services/page-title-backfill';

// fast-json-patch, reached transitively through the version service, exposes its
// CJS entry via Object.assign(exports, ...), which Node's ESM loader cannot bind
// by name. Loading through require() routes it via tsx's CJS interop so the named
// import resolves — the same workaround as adopt-slot-ids.ts. Both bindings come
// from one require so they share a single db module instance.
const cjsRequire = createRequire(import.meta.url);
const { runWithConnection } = cjsRequire('../db') as typeof import('../db');
const { backfillPageTitles } = cjsRequire(
  '../services/page-title-backfill',
) as typeof import('../services/page-title-backfill');

const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

function printEntries(label: string, entries: BackfillEntry[]): void {
  console.log(`${label}: ${String(entries.length)}`);
  for (const entry of entries) {
    console.log(`  - ${entry.path} (branch ${entry.branchId})`);
  }
}

function countBy(entries: SkippedEntry[], reason: BackfillSkipReason): number {
  return entries.filter((entry) => entry.reason === reason).length;
}

function parseSiteId(argv: string[]): string | undefined {
  const flag = argv.find((arg) => arg.startsWith('--site='));
  return flag?.slice('--site='.length);
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute;
  const siteId = parseSiteId(process.argv);

  console.log('Page Title Backfill');
  console.log('===================\n');
  if (dryRun) {
    console.log('Dry run (no versions will be written). Pass --execute to apply.\n');
  }
  if (siteId !== undefined) {
    console.log(`Limited to site ${siteId}.\n`);
  }

  const result = await runWithConnection(
    DATABASE_URL,
    { isHyperdrive: false },
    () => backfillPageTitles({ siteId, dryRun }),
  );

  printEntries(dryRun ? 'Would convert' : 'Converted', result.converted);
  console.log(`Skipped (already canonical): ${String(countBy(result.skipped, 'already-canonical'))}`);
  console.log(`Skipped (no title): ${String(countBy(result.skipped, 'no-title'))}`);

  // A latest version is always a baseline, so this should always be zero. If it
  // is not, that invariant has changed and these documents need a closer look.
  const unreadable = result.skipped.filter((entry) => entry.reason === 'unreadable');
  if (unreadable.length > 0) {
    printEntries('Unreadable — latest version has no readable object snapshot', unreadable);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
