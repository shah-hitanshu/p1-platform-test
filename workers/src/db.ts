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
 * Request-scoped database context.
 * Stores the current request's database connection.
 *
 * IMPORTANT: In Cloudflare Workers, each request should create and close its own
 * connection. The global variable here is per-isolate, and concurrent requests
 * may share the same isolate. Always call closeDatabaseConnection() at the end
 * of each request to prevent connection leaks.
 */
let currentConnection: DatabaseConnection | null = null;

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
      try {
        await sql.end();
      } catch {
        // Ignore errors - connection may already be closed or in different request context
      }
    },
  };
}

/**
 * Initialize the database connection for the current request.
 * Creates a fresh connection that will be used for all queries in this request.
 *
 * IMPORTANT: Always call closeDatabaseConnection() at the end of each request
 * to prevent connection leaks.
 *
 * @param connectionString - PostgreSQL connection string
 * @param options - Connection options
 */
export async function initializeDatabaseFromConnectionString(
  connectionString: string,
  options: ConnectionOptions = {},
): Promise<void> {
  // Close any existing connection before creating a new one
  // Use fire-and-forget to avoid blocking on slow closes
  if (currentConnection) {
    const oldConnection = currentConnection;
    currentConnection = null;
    oldConnection.close().catch(() => {
      // Ignore errors closing stale connection
    });
  }

  // Create a fresh connection for this request
  currentConnection = createDatabaseConnection(connectionString, options);
}

/**
 * Initialize the database from Hyperdrive binding.
 * Hyperdrive provides managed connection pooling for Cloudflare Workers.
 *
 * @param hyperdrive - Hyperdrive binding from env
 */
export async function initializeDatabaseFromHyperdrive(hyperdrive: Hyperdrive): Promise<void> {
  await initializeDatabaseFromConnectionString(hyperdrive.connectionString, { isHyperdrive: true });
}

/**
 * Initialize the database connection.
 * Should be called once at the start of each request.
 *
 * @param config - Database configuration
 */
export async function initializeDatabase(config: DatabaseConfig): Promise<void> {
  await initializeDatabaseFromConnectionString(config.connectionString);
}

/**
 * Execute a SQL query with parameters.
 * Uses parameterized queries to prevent SQL injection.
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
  if (!currentConnection) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return currentConnection.query<T>(sql, params);
}

/**
 * Close the current database connection.
 * Should be called at the end of each request for cleanup to prevent connection leaks.
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (currentConnection) {
    const connectionToClose = currentConnection;
    currentConnection = null;
    try {
      await connectionToClose.close();
    } catch {
      // Ignore close errors - connection may already be closed
    }
  }
}

/**
 * Set the database instance directly.
 * This is primarily for testing purposes.
 *
 * @param connection - Database connection to use
 */
export function setDatabaseInstance(connection: DatabaseConnection | null): void {
  currentConnection = connection;
}

/**
 * Get the current database instance.
 * Returns null if not initialized.
 */
export function getDatabaseInstance(): DatabaseConnection | null {
  return currentConnection;
}
