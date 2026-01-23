/**
 * Phase 2.2: Database Query Interface
 *
 * Provides a lightweight abstraction over PostgreSQL queries.
 * This module is designed to work with Cloudflare Workers and the postgres package.
 *
 * @see collaborative-state-system-architecture-v2.2.md
 */

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
 * Database connection interface.
 */
export interface DatabaseConnection {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
}

/**
 * Initialize the database connection.
 * Should be called once during worker startup.
 *
 * @param config - Database configuration
 */
export function initializeDatabase(config: DatabaseConfig): void {
  // In a real implementation, this would create a postgres connection
  // For now, we create a placeholder that will be mocked in tests
  dbInstance = createConnection(config);
}

/**
 * Create a database connection.
 * This is separated for easier testing/mocking.
 *
 * @param config - Database configuration
 * @returns Database connection
 */
function createConnection(_config: DatabaseConfig): DatabaseConnection {
  // This is a placeholder implementation
  // In production, this would use the postgres package
  return {
    query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      // This will be implemented when we add actual database integration
      // For now, it throws to indicate it needs to be mocked in tests
      return Promise.reject(
        new Error(
          `Database not initialized. SQL: ${sql}, Params: ${JSON.stringify(params)}`,
        ),
      );
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
