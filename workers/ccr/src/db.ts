/**
 * Phase 2.2: Database Query Interface
 *
 * Provides a lightweight abstraction over PostgreSQL queries.
 * This module is designed to work with Cloudflare Workers and the postgres package.
 *
 * IMPORTANT: Cloudflare Workers cannot share I/O objects (like database connections)
 * across request contexts. This module supports two connection modes:
 *
 * 1. **Hyperdrive (recommended for production)**: Uses Cloudflare Hyperdrive for
 *    connection pooling. Hyperdrive handles connection lifecycle management properly
 *    within Workers, avoiding cross-request I/O errors.
 *    See: https://developers.cloudflare.com/hyperdrive/
 *
 * 2. **Direct connection (local development)**: Creates a fresh connection for each
 *    request. Works for local development but may produce benign warnings about
 *    cross-request I/O in some scenarios.
 *
 * @see collaborative-state-system-architecture-v2.2.md
 */

import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/postgres-js';
import { resolveConnection } from './db/resolve-connection';
import { CLIENT_TIMEOUT_MESSAGE, classifyQueryFailure } from './db/query-failure';
import { getLogger } from '@pantheon-systems/p1-telemetry';
import * as schema from './db/schema';
import { describeQuery } from './db/describe-query';
import { STATEMENT_TIMEOUT_MS, withQueryGuard } from './db/query-guard';
import type { Database } from './db/executor';
import { withDatabase, inTransaction } from './db/scope';

export { describeQuery };
export type { Database, Executor, Transaction } from './db/executor';

/**
 * Result of a database query.
 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount?: number;
}

/**
 * Database connection configuration.
 */
export interface DatabaseConfig {
  connectionString: string;
}

/**
 * Database connection interface.
 */
export interface DatabaseConnection {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  close(): Promise<void>;
  /**
   * Run `fn` inside a single database transaction. Queries issued from within
   * `fn` (via the module-level `query`) run on the transaction's connection and
   * roll back together if `fn` throws.
   */
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Request-scoped database context using AsyncLocalStorage.
 * Each request gets its own isolated connection that cannot interfere with
 * concurrent requests in the same isolate.
 *
 * IMPORTANT: Always wrap request handlers with runWithConnection() to ensure
 * proper connection lifecycle management.
 */
const connectionStorage = new AsyncLocalStorage<DatabaseConnection>();

/**
 * Run a function with a request-scoped database connection.
 * This ensures each concurrent request has its own isolated connection.
 *
 * The request's Drizzle handle is entered into the scope in `./db/scope` for
 * the duration of `fn`, so query code reached from `fn` finds it through `db()`.
 * The legacy `query()` connection is entered into its own store alongside.
 *
 * @param connectionString - PostgreSQL connection string
 * @param options - Connection options
 * @param fn - Function to run with the connection
 * @returns Result of the function
 */
/**
 * Whether an error is a transport/connection failure (vs. a query/logic
 * error). One exported classifier so retry policies elsewhere (the merge job
 * runner's chunk steps, this module's own retry-once) agree on what counts.
 */
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (
    /connection (refused|terminated|reset|ended|closed)/i.test(error.message) ||
    /ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|57P01/.test(error.message)
  ) {
    return true;
  }
  return isConnectionError(error.cause);
}

export async function runWithConnection<T>(
  connectionString: string,
  options: ConnectionOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const scope = createRequestScope(connectionString, options);
  try {
    return await connectionStorage.run(scope.connection, () => withDatabase(scope.db, fn));
  } catch (error: unknown) {
    if (!isConnectionError(error)) throw error;

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    scope.close().catch(() => {});
    const retry = createRequestScope(connectionString, options);
    try {
      return await connectionStorage.run(retry.connection, () => withDatabase(retry.db, fn));
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      retry.close().catch(() => {});
    }
  } finally {
    // Fire-and-forget: do not await connection close. Awaiting sql.end() can
    // block for up to 5 seconds (its timeout) when Hyperdrive is slow to
    // acknowledge the disconnect under concurrent load. This delays response
    // delivery and starves Hyperdrive's pool — in-flight "shutting down"
    // postgres.js instances hold pool slots, causing 500s for new requests.
    //
    // For Hyperdrive connections, the pool automatically reclaims the slot
    // when the Worker invocation completes, so explicit close is not required
    // for correctness. For direct connections, the OS cleans up the socket.
    scope.close().catch(() => { /* ignore cleanup errors */ });
  }
}

/**
 * Bindings-driven variant of runWithConnection: picks Hyperdrive when bound,
 * else the direct connection string (local dev). One shared answer to "open a
 * request-scoped connection from `env`" for code running outside a request —
 * Workflows, queue consumers, crons [PCC-3737].
 */
export function runWithEnvConnection<T>(
  env: { HYPERDRIVE?: Hyperdrive; HYPERDRIVE_NOCACHE?: Hyperdrive; POSTGRES_CONNECTION_STRING?: string },
  fn: () => Promise<T>,
): Promise<T> {
  // Same resolver requests use; never the no-cache config.
  const { connectionString, isHyperdrive } = resolveConnection(env);
  return runWithConnection(connectionString, { isHyperdrive }, fn);
}

/**
 * Options for creating a database connection.
 */
export interface ConnectionOptions {
  /**
   * Whether this connection is via Hyperdrive.
   * Hyperdrive connections have different lifecycle management.
   */
  isHyperdrive?: boolean;
}

/**
 * Create a new database connection.
 * This should be called at the start of each request.
 *
 * @param connectionString - PostgreSQL connection string (from Hyperdrive or direct)
 * @param options - Connection options
 * @returns Database connection
 */
export function createDatabaseConnection(
  connectionString: string,
  options: ConnectionOptions = {},
): DatabaseConnection {
  return connectionFor(createPostgresClient(connectionString, options));
}

/**
 * The raw `query()` connection and the Drizzle handle for one request, each on
 * its own client.
 *
 * They cannot share one. `drizzle()` replaces its client's timestamp parsers and
 * its json serializers with identity functions so that it can map values itself,
 * which leaves anything else on that client reading timestamps as strings and
 * throwing on an object parameter.
 *
 * A request therefore opens two connections for as long as `query()` has callers,
 * and one once it has none.
 */
function createRequestScope(
  connectionString: string,
  options: ConnectionOptions,
): RequestScope {
  const drizzleClient = createPostgresClient(connectionString, options);
  const connection = connectionFor(createPostgresClient(connectionString, options));
  return {
    connection,
    db: drizzle(withQueryGuard(drizzleClient), { schema }),
    close: async (): Promise<void> => {
      await Promise.allSettled([connection.close(), drizzleClient.end({ timeout: 5 })]);
    },
  };
}

interface RequestScope {
  connection: DatabaseConnection;
  db: Database;
  /** Ends both clients. */
  close: () => Promise<void>;
}

function createPostgresClient(
  connectionString: string,
  options: ConnectionOptions,
): postgres.Sql {
  const { isHyperdrive = false } = options;

  // Create a new postgres connection for this request
  // Hyperdrive connections use different settings than direct connections
  return postgres(connectionString, {
    // Don't transform undefined to null - let postgres handle it
    transform: {
      undefined: null,
    },
    // Connection pool settings
    // Hyperdrive manages pooling, so we use minimal settings
    // Direct connections need more aggressive cleanup
    max: 1,
    idle_timeout: isHyperdrive ? 0 : 20, // Hyperdrive manages idle connections
    connect_timeout: 10,
    // Hyperdrive requires prepare: false for connection pooling compatibility
    // See: https://developers.cloudflare.com/hyperdrive/configuration/connect-to-postgres/
    prepare: isHyperdrive ? false : true,
    // Server-side half of the query guard; the client-side deadline is in
    // query-guard.ts. No statement can currently outlive this, so bounding it
    // server-side only adds cancellation of a backend the client stopped
    // waiting for.
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
  });
}

function connectionFor(sql: postgres.Sql): DatabaseConnection {
  return {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      return runSqlUnsafe<T>(sql, sqlQuery, params);
    },
    async close(): Promise<void> {
      // For Hyperdrive connections, closing is optional as Hyperdrive manages lifecycle
      // For direct connections, we still close but fire-and-forget to avoid cross-request issues
      // Use timeout to avoid hanging when the underlying connection has already been dropped
      // (e.g. CloudSQL closed the socket mid-query) — postgres.js end() can hang indefinitely
      // on a dead connection without a timeout.
      try {
        await sql.end({ timeout: 5 });
      } catch {
        // Ignore errors - connection may already be closed or in different request context
      }
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return sql.begin(async (txSql) => {
        const txConnection: DatabaseConnection = {
          query: <U = Record<string, unknown>>(q: string, p?: unknown[]) =>
            runSqlUnsafe<U>(txSql as unknown as postgres.Sql, q, p),
          close: async () => { /* the surrounding begin() owns this connection */ },
          // Already inside a transaction; a nested call reuses it rather than
          // opening a second one.
          transaction: (nested) => nested(),
        };
        return connectionStorage.run(txConnection, fn);
      }) as Promise<T>;
    },
  };
}

/**
 * Execute a query on a given postgres handle, failing fast on a hung connection.
 *
 * The 20-second race guards against a stuck Hyperdrive connection: without it a
 * hung query lets Cloudflare kill the Worker with a bare 500 that carries no CORS
 * headers, making the failure opaque to the client.
 */
async function runSqlUnsafe<T = Record<string, unknown>>(
  sqlHandle: postgres.Sql,
  sqlQuery: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const startedAt = Date.now();
  const QUERY_TIMEOUT_MS = 20_000;
  const queryPromise = sqlHandle.unsafe<T[]>(
    sqlQuery,
    params as unknown as postgres.ParameterOrJSON<never>[],
  );
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(CLIENT_TIMEOUT_MESSAGE));
    }, QUERY_TIMEOUT_MS);
  });
  let result: Awaited<typeof queryPromise>;
  try {
    result = await Promise.race([queryPromise, timeoutPromise]);
  } catch (error) {
    // Operation, table and a closed-vocabulary reason only — never the statement text,
    // parameters, or the error message, any of which can carry customer content.
    getLogger().warn('query failed', {
      ...describeQuery(sqlQuery),
      ...classifyQueryFailure(error),
      duration_ms: Date.now() - startedAt,
      timed_out: Date.now() - startedAt >= QUERY_TIMEOUT_MS,
      'error.type': error instanceof Error ? error.name : 'unknown',
    });
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  // The postgres package returns a Result object that extends Array
  const rows = [...result] as T[];

  // Get row count - for DELETE/UPDATE, use result.count; for SELECT, use rows.length
  const resultWithCount = result as unknown as { count?: number };
  const rowCount = resultWithCount.count ?? rows.length;

  getLogger().debug('query', () => ({
    ...describeQuery(sqlQuery),
    duration_ms: Date.now() - startedAt,
    'db.response.returned_rows': rowCount,
  }));

  return {
    rows,
    rowCount,
  };
}

/**
 * Test-only connection storage.
 * Used by setDatabaseInstance for test mocking.
 */
let testConnection: DatabaseConnection | null = null;

/**
 * Execute a SQL query with parameters.
 * Uses parameterized queries to prevent SQL injection.
 * Gets connection from AsyncLocalStorage (production) or test connection (testing).
 *
 * @param sql - SQL query string with $1, $2, etc. placeholders
 * @param params - Array of parameter values
 * @returns Query result with rows
 *
 * @example
 * ```typescript
 * const result = await query(
 *   'SELECT role FROM branch_grants WHERE branch_id = $1 AND actor_id = $2',
 *   [branchId, actorId]
 * );
 * ```
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  // Check test connection first (for unit tests)
  if (testConnection) {
    return testConnection.query<T>(sql, params);
  }

  // Get connection from AsyncLocalStorage (production)
  const connection = connectionStorage.getStore();
  if (!connection) {
    throw new Error('Database not initialized. Wrap request handler with runWithConnection().');
  }
  // The raw connection and the Drizzle handle are separate clients (see
  // createRequestScope), so a raw statement issued inside transaction() would
  // commit outside it.
  if (inTransaction()) {
    throw new Error('query() called inside a Drizzle transaction; its statement would run on a separate connection, outside the transaction.');
  }
  return connection.query<T>(sql, params);
}

/**
 * Run `fn` inside a database transaction, using the request-scoped connection.
 * Every `query` call made within `fn` runs on the transaction and commits or
 * rolls back atomically with it.
 *
 * A connection without transaction support (a test double exposing only
 * `query`) runs `fn` directly, so callers get atomicity in production while
 * staying testable against a plain query mock.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const connection = testConnection ?? connectionStorage.getStore();
  if (!connection) {
    throw new Error('Database not initialized. Wrap request handler with runWithConnection().');
  }
  if (typeof connection.transaction === 'function') {
    return connection.transaction(fn);
  }
  return fn();
}

/**
 * Set the database instance directly.
 * This is primarily for testing purposes.
 *
 * @param connection - Database connection to use
 */
export function setDatabaseInstance(connection: DatabaseConnection | null): void {
  testConnection = connection;
}

/**
 * Get the current database instance.
 * Returns connection from AsyncLocalStorage or test connection.
 */
export function getDatabaseInstance(): DatabaseConnection | null {
  return testConnection ?? connectionStorage.getStore() ?? null;
}

// =============================================================================
// Deprecated functions - kept for backward compatibility during migration
// These are no longer needed when using runWithConnection()
// =============================================================================

/**
 * @deprecated Use runWithConnection() instead. This function is a no-op.
 */
export async function initializeDatabaseFromConnectionString(
  _connectionString: string,
  _options: ConnectionOptions = {},
): Promise<void> {
  // No-op - connection is now managed by runWithConnection()
}

/**
 * @deprecated Use runWithConnection() instead. This function is a no-op.
 */
export async function initializeDatabaseFromHyperdrive(_hyperdrive: Hyperdrive): Promise<void> {
  // No-op - connection is now managed by runWithConnection()
}

/**
 * @deprecated Use runWithConnection() instead. This function is a no-op.
 */
export async function initializeDatabase(_config: DatabaseConfig): Promise<void> {
  // No-op - connection is now managed by runWithConnection()
}

/**
 * @deprecated Use runWithConnection() instead. This function is a no-op.
 */
export async function closeDatabaseConnection(): Promise<void> {
  // No-op - connection is now managed by runWithConnection()
}
