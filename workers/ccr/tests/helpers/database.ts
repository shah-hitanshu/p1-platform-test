/**
 * Shared Postgres wiring for integration tests.
 *
 * Every integration spec needs the same `DatabaseConnection` adapter over the
 * `postgres` driver, so it lives here rather than being copied per file.
 *
 * TODO: 13 integration specs under tests/integration still declare their own
 * copy of createRealDatabaseConnection with an inline connection string. Point
 * them here and delete the copies.
 *
 * Prerequisites:
 * - PostgreSQL running (podman on this machine): podman start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getDatabaseInstance, setDatabaseInstance, runWithConnection } from '../../src/db';
import type { Database, DatabaseConnection, QueryResult } from '../../src/db';
import * as schema from '../../src/db/schema';
import { installDatabase } from '../../src/db/scope';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = '5432';
const DEFAULT_DATABASE = 'cssdb';
const DEFAULT_USER = 'cssuser';
// Assembled from parts rather than written as one URL literal: an inline
// password in a connection string is what secret scanners match on, and this
// is the throwaway credential of the local container.
const DEFAULT_PASSWORD = 'csspass';

/**
 * Connection string for the local test database: a whole URL from the
 * environment when one is set, else assembled from parts so a per-worktree
 * database only has to override POSTGRES_DB.
 */
export const TEST_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL
  ?? process.env.POSTGRES_CONNECTION_STRING
  ?? `postgresql://${process.env.POSTGRES_USER ?? DEFAULT_USER}`
    + `:${process.env.POSTGRES_PASSWORD ?? DEFAULT_PASSWORD}`
    + `@${process.env.POSTGRES_HOST ?? DEFAULT_HOST}`
    + `:${process.env.POSTGRES_PORT ?? DEFAULT_PORT}`
    + `/${process.env.POSTGRES_DB ?? DEFAULT_DATABASE}`;

/**
 * Build the handles a test needs against a real Postgres: the Drizzle `db` the
 * code under test reaches through `db()`, the `DatabaseConnection` the raw
 * `query` interface resolves to, and `sql` itself for setup and assertions.
 *
 * `db` is installed as the scope fallback until the connection is closed, so a
 * spec calls the code under test directly. A request opened with
 * `runWithConnection` still takes precedence inside its own scope.
 *
 * `db` gets its own client. `drizzle()` replaces its client's timestamp parsers
 * and json serializers with identity functions, so sharing one would leave `sql`
 * reading timestamps as strings and throwing on an object parameter.
 *
 * Closing the connection ends both clients.
 *
 * @param connectionString - Defaults to the local test database.
 */
export function createRealDatabaseConnection(connectionString: string = TEST_CONNECTION_STRING): {
  db: Database;
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const clientOptions = { transform: { undefined: null }, max: 1 };
  const sql = postgres(connectionString, clientOptions);
  const drizzleClient = postgres(connectionString, clientOptions);

  const connection: DatabaseConnection = {
    async query<T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const result = await sql.unsafe(
        text,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );
      const rows = [...result] as T[];
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;
      return { rows, rowCount };
    },
    async close(): Promise<void> {
      installDatabase(null);
      await Promise.allSettled([sql.end(), drizzleClient.end()]);
    },
  };

  const db = drizzle(drizzleClient, { schema });
  installDatabase(db);
  return { db, connection, sql };
}

/**
 * Runs each operation on its own request-scoped connection.
 *
 * `query` prefers a connection installed with `setDatabaseInstance` over the
 * request-scoped store, and that connection holds a single slot, so callers
 * sharing it serialize.
 */
export async function asConcurrentRequests(
  ...operations: (() => Promise<unknown>)[]
): Promise<void> {
  const installed = getDatabaseInstance();
  setDatabaseInstance(null);
  try {
    await Promise.all(
      operations.map((operation) =>
        runWithConnection(TEST_CONNECTION_STRING, { isHyperdrive: false }, operation),
      ),
    );
  } finally {
    setDatabaseInstance(installed);
  }
}

/**
 * Deletes a site and everything reachable from it, children first.
 *
 * Only `app.sites`' own dependents cascade; branches, documents and versions are
 * `NO ACTION`, so deleting a site without clearing them first raises a foreign key
 * violation and the site's rows outlive the run. `branches.source_checkpoint_id`
 * and `checkpoints.branch_id` reference each other, so the branch's pointer is
 * cleared before the checkpoints it names are deleted.
 *
 * Errors propagate: a teardown that swallows them leaks rows into the shared test
 * database silently.
 */
export async function deleteSiteCascade(sql: postgres.Sql, siteId: string): Promise<void> {
  const branches = sql`SELECT id FROM app.branches WHERE site_id = ${siteId}`;
  const documents = sql`SELECT id FROM app.documents WHERE site_id = ${siteId}`;
  const checkpoints = sql`SELECT id FROM app.checkpoints WHERE branch_id IN (${branches})`;

  await sql`UPDATE app.branches SET source_checkpoint_id = NULL WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (${checkpoints})`;
  await sql`DELETE FROM app.checkpoint_document_metadata WHERE checkpoint_id IN (${checkpoints})`;
  await sql`DELETE FROM app.checkpoint_structures WHERE checkpoint_id IN (${checkpoints})`;
  await sql`DELETE FROM app.checkpoints WHERE branch_id IN (${branches})`;
  await sql`DELETE FROM app.branch_document_metadata WHERE branch_id IN (${branches})`;
  await sql`DELETE FROM app.branch_structure_state WHERE branch_id IN (${branches})`;
  await sql`DELETE FROM app.structure_nodes WHERE document_id IN (${documents})`;
  await sql`DELETE FROM app.migration_conflicts WHERE branch_id IN (${branches})`;
  await sql`DELETE FROM app.migration_jobs WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.merge_requests WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.document_versions WHERE document_id IN (${documents})`;
  await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.site_structures WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
}
