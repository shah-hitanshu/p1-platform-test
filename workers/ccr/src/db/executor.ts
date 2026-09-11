/**
 * The database handle types that query code accepts.
 *
 * `db()` in `./scope` returns an `Executor`: the request's `Database`, or the
 * `Transaction` while inside `transaction()`. Query code never holds one of
 * these directly; it reaches the current one through the scope.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

/** Derived from `transaction`'s callback so it tracks the driver's own type. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type Executor = Database | Transaction;
