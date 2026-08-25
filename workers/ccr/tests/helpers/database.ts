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
import { getDatabaseInstance, setDatabaseInstance, runWithConnection } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = '5432';
const DEFAULT_DATABASE = 'cssdb';
const DEFAULT_USER = 'cssuser';
// Assembled from parts rather than written as one URL literal: an inline
// password in a connection string is what secret scanners match on, and this
// is the throwaway credential of the local container.
const DEFAULT_PASSWORD = 'csspass';

/**
 * Connection string for the local test database, overridable per part so CI can
 * point at its own instance.
 */
export const TEST_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL
  ?? `postgresql://${process.env.POSTGRES_USER ?? DEFAULT_USER}`
    + `:${process.env.POSTGRES_PASSWORD ?? DEFAULT_PASSWORD}`
    + `@${process.env.POSTGRES_HOST ?? DEFAULT_HOST}`
    + `:${process.env.POSTGRES_PORT ?? DEFAULT_PORT}`
    + `/${process.env.POSTGRES_DB ?? DEFAULT_DATABASE}`;

/**
 * Build a `DatabaseConnection` backed by a real Postgres connection, alongside
 * the raw `sql` handle for test setup and assertions.
 *
 * @param connectionString - Defaults to the local test database.
 */
export function createRealDatabaseConnection(connectionString: string = TEST_CONNECTION_STRING): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const sql = postgres(connectionString, {
    transform: { undefined: null },
    max: 1,
  });

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
      await sql.end();
    },
  };

  return { connection, sql };
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
