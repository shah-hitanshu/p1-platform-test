/**
 * Baseline for databases that predate the Drizzle cut-over.
 *
 * An existing database already has the full `app` schema (built by the old
 * numbered migrations), so every Drizzle migration up to and including
 * `BASELINE_TAG` must be recorded as applied WITHOUT running it — otherwise the
 * migrator would try to CREATE objects that already exist and fail.
 *
 * `ensureBaselined` is idempotent and safe to call before every migrate:
 *   - already managed by Drizzle (journal has rows) → does nothing
 *   - fresh database (no app schema)                → does nothing, migrator builds it
 *   - pre-cut-over database at the full schema       → records the baseline journal
 *   - pre-cut-over database short of that schema     → throws
 *
 * It can also be run standalone:
 *   POSTGRES_CONNECTION_STRING=... pnpm db:baseline
 */

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSqlConnection, type Sql } from './connection';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');
const MIGRATIONS_SCHEMA = 'drizzle';

/**
 * Migrations at or before this tag describe the schema as it existed at the
 * cut-over. Anything after it is genuinely new and must run, so it is never
 * auto-baselined.
 */
const BASELINE_TAG = '0006_legacy_data_backfill_and_comments';

/**
 * The last numbered migration. The pre-Drizzle runner recorded every file it
 * applied in app.schema_migrations, in order, so this id being present means the
 * database carries the whole schema the baseline describes.
 */
const CUTOVER_MIGRATION_ID = 71;

export type BaselineStatus = 'fresh' | 'managed' | 'baselined';

async function journalHasRows(sql: Sql): Promise<boolean> {
  const table = await sql<{ reg: string | null }[]>`
    SELECT to_regclass(${`${MIGRATIONS_SCHEMA}.__drizzle_migrations`}) AS reg
  `;
  if (table[0]?.reg == null) {
    return false;
  }
  const count = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM ${sql(MIGRATIONS_SCHEMA)}.__drizzle_migrations
  `;
  return (count[0]?.c ?? 0) > 0;
}

async function appSchemaExists(sql: Sql): Promise<boolean> {
  const result = await sql<{ reg: string | null }[]>`
    SELECT to_regclass('app.sites') AS reg
  `;
  return result[0]?.reg != null;
}

async function atCutoverSchema(sql: Sql): Promise<boolean> {
  const table = await sql<{ reg: string | null }[]>`
    SELECT to_regclass('app.schema_migrations') AS reg
  `;
  if (table[0]?.reg == null) {
    return false;
  }
  const applied = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM app.schema_migrations
    WHERE id = ${CUTOVER_MIGRATION_ID}
  `;
  return (applied[0]?.n ?? 0) > 0;
}

async function baselineCutoffMillis(): Promise<number> {
  const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf-8')) as {
    entries: { tag: string; when: number }[];
  };
  const entry = journal.entries.find((e) => e.tag === BASELINE_TAG);
  if (entry === undefined) {
    throw new Error(`Baseline tag ${BASELINE_TAG} not found in migration journal.`);
  }
  return entry.when;
}

/**
 * Record the cut-over migrations as applied if the database predates Drizzle.
 * Returns what it did so callers can log appropriately.
 */
export async function ensureBaselined(sql: Sql): Promise<BaselineStatus> {
  if (await journalHasRows(sql)) {
    return 'managed';
  }
  if (!(await appSchemaExists(sql))) {
    return 'fresh';
  }

  if (!(await atCutoverSchema(sql))) {
    throw new Error(
      'Database has the app schema but app.schema_migrations does not record migration ' +
        `${String(CUTOVER_MIGRATION_ID)}, so it never reached the cut-over schema and cannot ` +
        'be baselined. Bring it up to that migration by applying the numbered migrations ' +
        'from a pre-cut-over checkout, then run this again. Discarding the database instead ' +
        '(pnpm db:migrate:reset && pnpm db:seed) is for local development only — it drops ' +
        'the app schema and everything in it.',
    );
  }

  const cutoff = await baselineCutoffMillis();
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });

  // A journal holding only some of the baseline rows reads as 'managed', which would
  // send the migrator at objects the database already has. It goes in whole or not at all.
  await sql.begin(async (tx) => {
    await tx`CREATE SCHEMA IF NOT EXISTS ${tx(MIGRATIONS_SCHEMA)}`;
    await tx`
      CREATE TABLE IF NOT EXISTS ${tx(MIGRATIONS_SCHEMA)}.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;

    for (const migration of migrations) {
      if (migration.folderMillis > cutoff) {
        continue;
      }
      await tx`
        INSERT INTO ${tx(MIGRATIONS_SCHEMA)}.__drizzle_migrations ("hash", "created_at")
        VALUES (${migration.hash}, ${migration.folderMillis})
      `;
    }
  });

  return 'baselined';
}

async function main(): Promise<void> {
  const sql = createSqlConnection();

  try {
    const status = await ensureBaselined(sql);
    if (status === 'baselined') {
      console.log('✓ Existing database baselined; db:migrate will now be a no-op.');
    } else if (status === 'managed') {
      console.log('Database already managed by Drizzle; nothing to baseline.');
    } else {
      console.log('Fresh database; nothing to baseline. Run db:migrate to build it.');
    }
  } catch (error) {
    console.error('Baseline error:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

const entrypoint = process.argv[1];
const invokedDirectly = entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
if (invokedDirectly) {
  void main();
}
