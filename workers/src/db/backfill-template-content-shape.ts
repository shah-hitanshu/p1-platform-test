/**
 * Backfill: converts template documents' latest snapshots from the legacy
 * `{ components }` manifest shape to the content shape (PROPOSAL-014 §7).
 *
 * The API reads and writes both shapes during the legacy compatibility window,
 * so this backfill is not required for correctness. It is cleanup: once every
 * environment is backfilled, the dual-shape compatibility code can be removed.
 *
 * Run it per environment, against that environment's database, and only after
 * the worker that understands the content shape is deployed there. A worker on
 * older code cannot read content-shaped template rows. The conversion skips
 * snapshots already in the content shape, so re-runs are safe.
 *
 * Usage:
 *   pnpm db:backfill-template-content-shape            # Dry run - show what would convert
 *   pnpm db:backfill-template-content-shape:execute    # Write the new versions
 */

import { runWithConnection } from '../db';
import { backfillTemplateContentShape } from '../services/template-content-backfill';

const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

function printEntries(label: string, entries: { path: string; branchId: string }[]): void {
  console.log(`${label}: ${String(entries.length)}`);
  for (const entry of entries) {
    console.log(`  - ${entry.path} (branch ${entry.branchId})`);
  }
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute;

  console.log('Template Content Shape Backfill');
  console.log('================================\n');
  if (dryRun) {
    console.log('Dry run (no versions will be written). Pass --execute to apply.\n');
  }

  const result = await runWithConnection(
    DATABASE_URL,
    { isHyperdrive: false },
    () => backfillTemplateContentShape({ dryRun }),
  );

  printEntries(dryRun ? 'Would convert' : 'Converted', result.converted);
  printEntries('Skipped (already content-shaped)', result.skipped);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
