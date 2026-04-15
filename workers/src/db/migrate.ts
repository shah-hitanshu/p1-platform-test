/**
 * Database Migration Runner
 *
 * A lightweight migration system for PostgreSQL that:
 * - Reads numbered SQL files from the migrations directory
 * - Tracks applied migrations in a schema_migrations table
 * - Applies pending migrations in order
 * - Supports running from CLI or programmatically
 *
 * Usage:
 *   npx tsx src/db/migrate.ts           # Run all pending migrations
 *   npx tsx src/db/migrate.ts --status  # Show migration status
 *   npx tsx src/db/migrate.ts --reset   # Reset and re-run all migrations
 */

import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, 'migrations');

// Database connection
const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

interface Migration {
  id: number;
  name: string;
  filename: string;
}

interface AppliedMigration {
  id: number;
  name: string;
  applied_at: Date;
}

/**
 * Parse migration filename to extract id and name
 * Expected format: 001_migration_name.sql
 */
function parseMigrationFilename(filename: string): Migration | null {
  const match = /^(\d+)_(.+)\.sql$/.exec(filename);
  if (match?.[1] === undefined || match[2] === undefined) {
    return null;
  }

  return {
    id: parseInt(match[1], 10),
    name: match[2],
    filename,
  };
}

/**
 * Get all migration files from the migrations directory
 */
async function getMigrationFiles(): Promise<Migration[]> {
  const files = await readdir(MIGRATIONS_DIR);

  const migrations = files
    .map(parseMigrationFilename)
    .filter((m): m is Migration => m !== null)
    .sort((a, b) => a.id - b.id);

  return migrations;
}

/**
 * Ensure the schema_migrations table exists
 */
async function ensureMigrationsTable(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS app`;
  await sql`
    CREATE TABLE IF NOT EXISTS app.schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

/**
 * Get list of already applied migrations
 */
async function getAppliedMigrations(
  sql: ReturnType<typeof postgres>,
): Promise<AppliedMigration[]> {
  const result = await sql<AppliedMigration[]>`
    SELECT id, name, applied_at
    FROM app.schema_migrations
    ORDER BY id
  `;
  return result;
}

/**
 * Apply a single migration
 */
async function applyMigration(
  sql: ReturnType<typeof postgres>,
  migration: Migration,
): Promise<void> {
  const filePath = join(MIGRATIONS_DIR, migration.filename);
  const content = await readFile(filePath, 'utf-8');

  console.log(`  Applying migration ${String(migration.id)}: ${migration.name}...`);

  // Execute the migration SQL
  await sql.unsafe(content);

  // Record the migration
  await sql`
    INSERT INTO app.schema_migrations (id, name)
    VALUES (${migration.id}, ${migration.name})
  `;

  console.log(`  ✓ Migration ${String(migration.id)} applied successfully`);
}

/**
 * Run all pending migrations
 */
async function runMigrations(
  sql: ReturnType<typeof postgres>,
): Promise<{ applied: number; total: number }> {
  await ensureMigrationsTable(sql);

  const allMigrations = await getMigrationFiles();
  const appliedMigrations = await getAppliedMigrations(sql);
  const appliedIds = new Set(appliedMigrations.map((m) => m.id));

  const pendingMigrations = allMigrations.filter((m) => !appliedIds.has(m.id));

  if (pendingMigrations.length === 0) {
    console.log('No pending migrations.');
    return { applied: 0, total: allMigrations.length };
  }

  console.log(`Found ${String(pendingMigrations.length)} pending migration(s):\n`);

  for (const migration of pendingMigrations) {
    await applyMigration(sql, migration);
  }

  console.log(
    `\n✓ Applied ${String(pendingMigrations.length)} migration(s) successfully.`,
  );
  return { applied: pendingMigrations.length, total: allMigrations.length };
}

/**
 * Show migration status
 */
async function showStatus(sql: ReturnType<typeof postgres>): Promise<void> {
  await ensureMigrationsTable(sql);

  const allMigrations = await getMigrationFiles();
  const appliedMigrations = await getAppliedMigrations(sql);
  const appliedIds = new Set(appliedMigrations.map((m) => m.id));

  console.log('Migration Status:\n');
  console.log('ID   | Status  | Name');
  console.log('-----|---------|---------------------------');

  for (const migration of allMigrations) {
    const status = appliedIds.has(migration.id) ? '✓ Done' : '○ Pending';
    console.log(
      `${String(migration.id).padStart(4)} | ${status.padEnd(7)} | ${migration.name}`,
    );
  }

  const pending = allMigrations.length - appliedMigrations.length;
  const total = String(allMigrations.length);
  const applied = String(appliedMigrations.length);
  console.log(`\nTotal: ${total} | Applied: ${applied} | Pending: ${String(pending)}`);
}

/**
 * Reset database and re-run all migrations
 */
async function resetMigrations(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  console.log('Resetting database...\n');

  // Drop all tables in app schema
  await sql`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'app') LOOP
        EXECUTE 'DROP TABLE IF EXISTS app.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `;

  console.log('All tables dropped. Running migrations...\n');
  await runMigrations(sql);
}

/**
 * Main entry point for CLI usage
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'run';

  const sql = postgres(DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    switch (command) {
      case '--status':
      case 'status':
        await showStatus(sql);
        break;

      case '--reset':
      case 'reset':
        await resetMigrations(sql);
        break;

      case '--run':
      case 'run':
      default:
        await runMigrations(sql);
        break;
    }
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

// Export for programmatic use
export {
  runMigrations,
  showStatus,
  resetMigrations,
  getMigrationFiles,
  getAppliedMigrations,
};

// Run if called directly
void main();
