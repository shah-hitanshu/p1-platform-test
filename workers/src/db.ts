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
export async function runWithConnection<T>(
  connectionString: string,
  options: ConnectionOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const connection = createDatabaseConnection(connectionString, options);
  try {
    return await connectionStorage.run(connection, fn);
  } finally {
    await connection.close();
  }
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
