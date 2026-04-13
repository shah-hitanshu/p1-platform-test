/**
 * Phase 2.2: Database Query Interface
 *
 * Provides a lightweight abstraction over PostgreSQL queries.
 * This module is designed to work with Cloudflare Workers and the postgres package.
 *
 * IMPORTANT: Cloudflare Workers cannot share I/O objects (like database connections)
 * across request contexts. This module supports two connection modes:
 *
 * 1. **Hyperdrive (recommended for production)**: Uses a module-level singleton pool
 *    shared across all requests in the same Worker isolate. This is the pattern
 *    Cloudflare recommends for Hyperdrive — creating a new connection per request
 *    quickly exhausts Hyperdrive's connection capacity under concurrent load.
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
}

/**
 * Request-scoped database context using AsyncLocalStorage.
 * Each request gets its own isolated connection context.
 *
 * For Hyperdrive: stores a non-owning reference to the shared module-level pool.
 * For direct connections: stores an owned per-request connection.
 */
const connectionStorage = new AsyncLocalStorage<DatabaseConnection>();

// =============================================================================
// Hyperdrive module-level pool cache
//
// Cloudflare recommends sharing a postgres.js pool across requests when using
// Hyperdrive. Creating one connection per request (as we did before) causes
// CONNECTION_CLOSED errors under concurrent load because Hyperdrive drops
// excess connections.
//
// Key: connectionString (Hyperdrive generates a stable string per isolate)
// Value: shared postgres.Sql pool
// =============================================================================
const hyperdrivePools = new Map<string, postgres.Sql>();

/**
 * Get or create a shared postgres.js pool for a Hyperdrive connection string.
 * The pool is shared across all concurrent requests in this Worker isolate.
 *
 * Pool settings:
 * - max: 5 — allows parallelism while keeping connection count manageable.
 *   With 50 concurrent requests, postgres.js queues rather than opening 50 connections.
 * - idle_timeout: 20 — closes idle connections so Hyperdrive doesn't see stale ones.
 * - prepare: false — required for Hyperdrive (PgBouncer transaction-mode pooling).
 */
function getOrCreateHyperdrivePool(connectionString: string): postgres.Sql {
  let pool = hyperdrivePools.get(connectionString);
  if (!pool) {
    pool = postgres(connectionString, {
      transform: {
        undefined: null,
      },
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // Required for Hyperdrive (PgBouncer transaction-mode)
    });
    hyperdrivePools.set(connectionString, pool);
  }
  return pool;
}

/**
 * Wrap a shared postgres.Sql pool in the DatabaseConnection interface.
 * The close() method is a no-op — we do NOT close the shared pool between requests.
 */
function wrapHyperdrivePool(sql: postgres.Sql): DatabaseConnection {
  return {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await sql.unsafe<T[]>(
        sqlQuery,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );

      const rows = [...result] as T[];
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;

      return { rows, rowCount };
    },
    async close(): Promise<void> {
      // No-op: shared Hyperdrive pool lives for the isolate lifetime.
      // Do not close — that would break concurrent in-flight requests.
    },
  };
}

/**
 * Options for creating a database connection.
 */
export interface ConnectionOptions {
  /**
   * Whether this connection is via Hyperdrive.
   * Hyperdrive connections use a module-level shared pool.
   * Direct connections create a fresh connection per request.
   */
  isHyperdrive?: boolean;
}

/**
 * Run a function with a request-scoped database connection.
 *
 * For Hyperdrive: uses a shared module-level pool (no per-request connection overhead).
 * For direct connections: creates a fresh connection, ensures cleanup on completion.
 *
 * @param connectionString - PostgreSQL connection string
 * @param options - Connection options
 * @param fn - Function to run with the connection
 * @returns Result of the function
 */
export async function runWithConnection<T>(
  connectionString: string,
  options: ConnectionOptions,
  fn: () => Promise<T>,
): Promise<T> {
  if (options.isHyperdrive === true) {
    // Shared pool path: get or create the module-level pool for this connectionString.
    // Multiple concurrent requests share the same pool — postgres.js handles queuing.
    const sql = getOrCreateHyperdrivePool(connectionString);
    const connection = wrapHyperdrivePool(sql);
    return connectionStorage.run(connection, fn);
  } else {
    // Per-request connection path: create a fresh connection for local dev.
    const connection = createDatabaseConnection(connectionString, options);
    try {
      return await connectionStorage.run(connection, fn);
    } finally {
      await connection.close();
    }
  }
}

/**
 * Create a new per-request database connection (direct/local dev only).
 * Do not use this for Hyperdrive — use runWithConnection with isHyperdrive: true.
 *
 * @param connectionString - PostgreSQL connection string
 * @param options - Connection options
 * @returns Database connection
 */
export function createDatabaseConnection(
  connectionString: string,
  _options: ConnectionOptions = {},
): DatabaseConnection {
  const sql = postgres(connectionString, {
    transform: {
      undefined: null,
    },
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
  });

  return {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await sql.unsafe<T[]>(
        sqlQuery,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );

      // The postgres package returns a Result object that extends Array
      const rows = [...result] as T[];

      // Get row count - for DELETE/UPDATE, use result.count; for SELECT, use rows.length
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;

      return {
        rows,
        rowCount,
      };
    },
    async close(): Promise<void> {
      // For direct connections, close and fire-and-forget.
      // Use timeout to avoid hanging when the underlying connection has already been
      // dropped (e.g. CloudSQL closed the socket mid-query) — postgres.js end() can
      // hang indefinitely on a dead connection without a timeout.
      try {
        await sql.end({ timeout: 5 });
      } catch {
        // Ignore errors - connection may already be closed
      }
    },
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
  return connection.query<T>(sql, params);
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
