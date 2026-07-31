/**
 * One-time slot-id adoption pass for documents created before durable slot ids.
 *
 * Rewrites each template-bound document's component ids to its template's slot
 * ids so future id-keyed migrations correspond. The pass writes new document
 * versions directly, so live editing sessions on affected documents should be
 * quiescent while it runs.
 *
 * Usage:
 *   pnpm db:adopt-slot-ids                 # Dry run - report what would change
 *   pnpm db:adopt-slot-ids:execute         # Write migration versions
 *   pnpm db:adopt-slot-ids --site <siteId> # Scope the run to one site
 *
 * The connection string defaults to the local database and can be overridden
 * with POSTGRES_CONNECTION_STRING.
 */

import { createRequire } from 'node:module';
import type { SlotAdoptionRunSummary } from '../services/slot-id-adoption';

// fast-json-patch, reached transitively through the runner, exposes its CJS
// entry via Object.assign(exports, ...), which Node's ESM loader cannot bind by
// name. Loading the runner through require() routes it via tsx's CJS interop so
// the named import resolves. Both bindings come from one require so they share a
// single db module instance, keeping the connection scope consistent.
const cjsRequire = createRequire(import.meta.url);
const { runWithConnection, query } = cjsRequire('../db') as typeof import('../db');
const { runSlotIdAdoption } = cjsRequire(
  '../services/slot-id-adoption',
) as typeof import('../services/slot-id-adoption');

// Advisory-lock name so two execute passes can't rewrite the same documents
// at once. hashtext turns it into the bigint key the lock functions take.
const ADOPTION_LOCK_NAME = 'slot-id-adoption';

const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

/**
 * Reads the site id following a `--site` flag, if present.
 */
function parseSiteId(args: string[]): string | undefined {
  const index = args.indexOf('--site');
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

/**
 * Prints the adoption summary as adopted paths with rewrite counts, skipped
 * paths with reasons, and the already-adopted count.
 */
function printSummary(summary: SlotAdoptionRunSummary, dryRun: boolean): void {
  const action = dryRun ? 'Would adopt' : 'Adopted';

  console.log(`\nExamined ${String(summary.examined)} (document, branch) pair(s).\n`);

  console.log(`${action} (${String(summary.adopted.length)}):`);
  for (const entry of summary.adopted) {
    console.log(
      `  ${entry.path} [branch ${entry.branchId}] - ${String(entry.rewrites)} rewrite(s)`,
    );
  }

  console.log(`\nSkipped (${String(summary.skipped.length)}):`);
  for (const entry of summary.skipped) {
    console.log(`  ${entry.path} [branch ${entry.branchId}] - ${entry.reason}`);
  }

  console.log(`\nAlready adopted: ${String(summary.alreadyAdopted)}`);
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const dryRun = !execute;
  const siteId = parseSiteId(args);

  console.log('Slot-id Adoption Pass');
  console.log('=====================');
  if (siteId !== undefined) {
    console.log(`Site scope: ${siteId}`);
  }
  if (dryRun) {
    console.log('Dry run - no versions will be written. Run with --execute to persist.');
  }

  const summary = await runWithConnection(DATABASE_URL, { isHyperdrive: false }, async () => {
    if (!dryRun) {
      const lock = await query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [ADOPTION_LOCK_NAME],
      );
      if (lock.rows[0]?.locked !== true) {
        throw new Error(
          'Another slot-id adoption pass holds the advisory lock; aborting to avoid concurrent writes.',
        );
      }
    }
    try {
      return await runSlotIdAdoption({ dryRun, siteId });
    } finally {
      if (!dryRun) {
        await query('SELECT pg_advisory_unlock(hashtext($1))', [ADOPTION_LOCK_NAME]);
      }
    }
  });

  printSummary(summary, dryRun);

  if (dryRun) {
    console.log('\nThis was a dry run. Run with --execute to write the migration versions.');
  } else {
    console.log('\nAdoption pass complete.');
  }
}

main().catch((error: unknown) => {
  console.error('Adoption error:', error);
  process.exit(1);
});
