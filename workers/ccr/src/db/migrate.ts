/**
 * Database Migration Runner
 *
 * Applies the drizzle-kit migration journal in `drizzle/` using Drizzle's
 * programmatic migrator. The journal is tracked in `drizzle.__drizzle_migrations`;
 * the application's own tables live in the `app` schema.
 *
 * Usage:
 *   pnpm db:migrate         # Apply all pending migrations
 *   pnpm db:migrate:reset   # Drop the app schema, then re-apply
 *
 * IMPORTANT: A database that predates the Drizzle cut-over must be baselined
 * (its already-applied migrations recorded in the journal) before this runs,
 * or the baseline migration will fail trying to create objects that exist.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBaselined } from './baseline';
import { createSqlConnection, type Sql } from './connection';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');
const MIGRATIONS_SCHEMA = 'drizzle';

async function runMigrations(sql: Sql): Promise<void> {
  const status = await ensureBaselined(sql);
  if (status === 'baselined') {
    console.log('Existing pre-Drizzle database detected; recorded the cut-over baseline.');
  }

  console.log('Applying pending migrations...');
  await migrate(drizzle(sql), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: MIGRATIONS_SCHEMA,
  });
  console.log('✓ Migrations applied.');
}

async function resetDatabase(sql: Sql): Promise<void> {
  console.log('Resetting database (dropping app schema and migration journal)...');
  await sql`DROP SCHEMA IF EXISTS app CASCADE`;
  await sql`DROP SCHEMA IF EXISTS ${sql(MIGRATIONS_SCHEMA)} CASCADE`;
  console.log('Schemas dropped. Re-applying migrations...');
  await runMigrations(sql);
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const sql = createSqlConnection();

  try {
    await (reset ? resetDatabase(sql) : runMigrations(sql));
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

void main();
