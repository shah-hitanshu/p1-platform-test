/**
 * Phase 2.2: Database Query Interface
 *
 * Provides a lightweight abstraction over PostgreSQL queries.
 * This module is designed to work with Cloudflare Workers and the postgres package.
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
 * Global database instance holder.
 * In production, this would be initialized with the connection string from environment.
 */
let dbInstance: DatabaseConnection | null = null;

/**
 * Cached postgres SQL instance for connection reuse.
 */
let sqlInstance: postgres.Sql | null = null;

/**
 * Database connection interface.
 */
export interface DatabaseConnection {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
}

/**
 * Initialize the database connection from a connection string.
 * Creates a real postgres connection using the postgres package.
 * Safe to call multiple times - reuses existing connection.
 *
 * @param connectionString - PostgreSQL connection string
 */
export function initializeDatabaseFromConnectionString(connectionString: string): void {
  // Skip if already initialized with same connection string
  if (dbInstance && sqlInstance) {
    return;
  }

  // Create postgres connection
  sqlInstance = postgres(connectionString, {
    // Don't transform undefined to null - let postgres handle it
    transform: {
      undefined: null,
    },
    // Connection pool settings for Workers
    max: 1, // Workers are single-threaded
    idle_timeout: 20,
    connect_timeout: 10,
  });

  // Create the database connection adapter
  dbInstance = createConnectionFromSql(sqlInstance);
}

/**
 * Initialize the database connection.
 * Should be called once during worker startup.
 *
 * @param config - Database configuration
 */
export function initializeDatabase(config: DatabaseConfig): void {
  initializeDatabaseFromConnectionString(config.connectionString);
}

/**
 * Create a database connection adapter from a postgres SQL instance.
 *
 * @param sql - Postgres SQL instance
 * @returns Database connection adapter
 */
function createConnectionFromSql(sql: postgres.Sql): DatabaseConnection {
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
  };
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
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return dbInstance.query<T>(sql, params);
}

/**
 * Set the database instance directly.
 * This is primarily for testing purposes.
 *
 * @param connection - Database connection to use
 */
export function setDatabaseInstance(connection: DatabaseConnection | null): void {
  dbInstance = connection;
}

/**
 * Get the current database instance.
 * Returns null if not initialized.
 */
export function getDatabaseInstance(): DatabaseConnection | null {
  return dbInstance;
}
