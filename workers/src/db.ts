/**
 * Phase 2.2: Database Query Interface
 *
 * Provides a lightweight abstraction over PostgreSQL queries.
 * This module is designed to work with Cloudflare Workers and the postgres package.
 *
 * IMPORTANT: Cloudflare Workers cannot share I/O objects (like database connections)
 * across request contexts. This module creates a fresh connection for each request
 * and provides a request-scoped database context.
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
 */
let currentConnection: DatabaseConnection | null = null;

/**
 * Create a new database connection.
 * This should be called at the start of each request.
 *
 * @param connectionString - PostgreSQL connection string
 * @returns Database connection
 */
export function createDatabaseConnection(connectionString: string): DatabaseConnection {
  // Create a new postgres connection for this request
  const sql = postgres(connectionString, {
    // Don't transform undefined to null - let postgres handle it
    transform: {
      undefined: null,
    },
    // Connection pool settings for Workers - single connection per request
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
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
      await sql.end();
    },
  };
}

/**
 * Initialize the database connection for the current request.
 * Creates a fresh connection that will be used for all queries in this request.
 *
 * @param connectionString - PostgreSQL connection string
 */
export function initializeDatabaseFromConnectionString(connectionString: string): void {
  // Close any existing connection (shouldn't happen in normal flow)
  if (currentConnection) {
    // Fire and forget - we're replacing it anyway
    currentConnection.close().catch(() => {
      // Ignore errors closing stale connection
    });
  }

  // Create a fresh connection for this request
  currentConnection = createDatabaseConnection(connectionString);
}

/**
 * Initialize the database connection.
 * Should be called once at the start of each request.
 *
 * @param config - Database configuration
 */
export function initializeDatabase(config: DatabaseConfig): void {
  initializeDatabaseFromConnectionString(config.connectionString);
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
 * Should be called at the end of each request for cleanup.
 * Optional - connections will be cleaned up by the runtime eventually.
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (currentConnection) {
    await currentConnection.close();
    currentConnection = null;
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
