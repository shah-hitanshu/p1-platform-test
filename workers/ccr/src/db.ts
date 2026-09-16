/**
 * Request-scoped database connections.
 *
 * Opens one Drizzle handle per request and enters it into the scope in
 * `./db/scope`, where query code finds it through `db()`.
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
import { drizzle } from 'drizzle-orm/postgres-js';
import { resolveConnection } from './db/resolve-connection';
import * as schema from './db/schema';
import { describeQuery } from './db/describe-query';
import { STATEMENT_TIMEOUT_MS, withQueryGuard } from './db/query-guard';
import type { Database } from './db/executor';
import { withDatabase } from './db/scope';

export { describeQuery };
export type { Database, Executor, Transaction } from './db/executor';

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

/**
 * Run a function with a request-scoped database connection, so concurrent
 * requests in one isolate cannot interfere with each other.
 *
 * The request's Drizzle handle is entered into the scope in `./db/scope` for
 * the duration of `fn`, so query code reached from `fn` finds it through `db()`.
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
  const scope = createRequestScope(connectionString, options);
  try {
    return await withDatabase(scope.db, fn);
  } catch (error: unknown) {
    if (!isConnectionError(error)) throw error;

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    scope.close().catch(() => {});
    const retry = createRequestScope(connectionString, options);
    try {
      return await withDatabase(retry.db, fn);
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

/** The Drizzle handle for one request, on a client of its own. */
function createRequestScope(
  connectionString: string,
  options: ConnectionOptions,
): RequestScope {
  const client = createPostgresClient(connectionString, options);
  return {
    db: drizzle(withQueryGuard(client), { schema }),
    close: async (): Promise<void> => {
      await client.end({ timeout: 5 });
    },
  };
}

interface RequestScope {
  db: Database;
  /** Ends the client. */
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
