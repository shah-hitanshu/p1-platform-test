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
import { resolveConnection } from './db/resolve-connection';
import { getLogger } from '@pantheon-systems/p1-telemetry';

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
  return (
    error instanceof Error &&
    (/connection (refused|terminated|reset|ended|closed)/i.test(error.message) ||
      /ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|57P01/.test(error.message))
  );
}

export async function runWithConnection<T>(
  connectionString: string,
  options: ConnectionOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const connection = createDatabaseConnection(connectionString, options);
  try {
    return await connectionStorage.run(connection, fn);
  } catch (error: unknown) {
    if (!isConnectionError(error)) throw error;

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    connection.close().catch(() => {});
    const retryConnection = createDatabaseConnection(connectionString, options);
    try {
      return await connectionStorage.run(retryConnection, fn);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      retryConnection.close().catch(() => {});
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
    connection.close().catch(() => { /* ignore cleanup errors */ });
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
  // Delegates the binding choice to the same resolver requests use ('' path:
  // never the admin no-cache config).
  const { connectionString, isHyperdrive } = resolveConnection(env, '');
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
  const { isHyperdrive = false } = options;

  // Create a new postgres connection for this request
  // Hyperdrive connections use different settings than direct connections
  const sql = postgres(connectionString, {
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
  });

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
      reject(new Error('Database query timed out after 20 seconds'));
    }, QUERY_TIMEOUT_MS);
  });
  let result: Awaited<typeof queryPromise>;
  try {
    result = await Promise.race([queryPromise, timeoutPromise]);
  } catch (error) {
    // Operation and table only — never the statement text or parameters, either of
    // which can carry customer content.
    getLogger().warn('query failed', {
      ...describeQuery(sqlQuery),
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
 * Low-cardinality description of a statement: the operation and the primary table.
 *
 * Deliberately not the statement text — it can embed customer content, and as a log
 * field it would be unbounded cardinality. This is also why sqlcommenter is not applied
 * per request: Hyperdrive caches by query text, so a unique comment per request would
 * drive its hit rate to zero.
 *
 * The schema qualifier is matched and discarded. Every table here is written
 * `app.<table>`, so a pattern that stops at the dot reports `app` for every statement
 * ever logged — a constant field that looks like data. `db.collection.name` is the
 * table in OTel's vocabulary; the schema would be `db.namespace`, and with exactly one
 * schema it carries no information worth a field.
 *
 * A leading CTE is stepped over so `WITH … INSERT INTO x` reports `insert` rather than
 * `with`, which is not an operation anyone queries by.
 */
export function describeQuery(sqlQuery: string): { 'db.operation.name': string; 'db.collection.name'?: string } {
  const outer = stripParenthesized(sqlQuery.trim().replace(/\s+/g, ' '));
  const operation = /\b(select|insert|update|delete)\b/i.exec(outer)?.[1]?.toLowerCase() ?? 'other';
  const table = /\b(?:from|into|update|join)\s+"?(?:[a-z_][a-z0-9_]*"?\."?)?([a-z_][a-z0-9_]*)"?/i
    .exec(outer)?.[1]
    ?.toLowerCase();
  return table === undefined
    ? { 'db.operation.name': operation }
    : { 'db.operation.name': operation, 'db.collection.name': table };
}

/**
 * Drop every parenthesized group, innermost first, leaving only what runs at the outer
 * level. That is what makes a CTE report the statement it performs rather than `with`,
 * and keeps a subquery's table from being mistaken for the statement's own.
 */
function stripParenthesized(sql: string): string {
  let out = sql;
  let previous: string;
  do {
    previous = out;
    out = out.replace(/\([^()]*\)/g, ' ');
  } while (out !== previous);
  return out;
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
