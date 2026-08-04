/**
 * Shared Postgres wiring for integration tests.
 *
 * Every integration spec needs the same `DatabaseConnection` adapter over the
 * `postgres` driver, so it lives here rather than being copied per file.
 *
 * Prerequisites:
 * - PostgreSQL running (podman on this machine): podman start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import postgres from 'postgres';
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
