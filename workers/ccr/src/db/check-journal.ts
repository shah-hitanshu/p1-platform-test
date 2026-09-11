/**
 * Guards the ordering the Drizzle migrator relies on.
 *
 * The migrator picks up where it left off by comparing `when` against the newest
 * timestamp in the database, never by tag or hash. A migration whose `when` is
 * older than one already applied is therefore skipped in silence, and the
 * databases built after it diverge permanently. Two branches that each generate
 * a migration collide on the same number, and renumbering the one that merges
 * second is exactly how a journal ends up out of order.
 *
 * Usage:
 *   pnpm db:check-journal
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOURNAL_PATH = join(__dirname, '..', '..', 'drizzle', 'meta', '_journal.json');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8')) as { entries: JournalEntry[] };
const problems: string[] = [];

journal.entries.forEach((entry, position) => {
  if (entry.idx !== position) {
    problems.push(`${entry.tag}: idx is ${String(entry.idx)} but it sits at position ${String(position)}`);
  }
  const previous = journal.entries[position - 1];
  if (previous !== undefined && entry.when <= previous.when) {
    problems.push(
      `${entry.tag}: when (${String(entry.when)}) is not after ${previous.tag} (${String(previous.when)}), ` +
        'so the migrator will skip it on any database that already applied ' +
        `${previous.tag}. Regenerate it so it carries a newer timestamp.`,
    );
  }
});

if (problems.length > 0) {
  console.error('Migration journal is out of order:');
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}

console.log(`✓ Migration journal is ordered (${String(journal.entries.length)} entries).`);
