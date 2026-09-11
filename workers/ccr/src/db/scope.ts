/**
 * The database handle for the current request, held in AsyncLocalStorage.
 *
 * `runWithConnection` opens a scope for each request, queue message, Durable
 * Object call or script, and everything reached from it queries through `db()`.
 * Inside `transaction()` the scope holds the transaction, so a participant
 * cannot run a statement outside it: there is no other handle to reach for.
 *
 * Outside any scope `db()` returns the fallback a test installed, and throws when
 * there is none. Vitest runs each test body in an async context detached from
 * the hooks before it, so a scope opened in `beforeEach` never reaches the test;
 * the fallback is how a spec makes its stub the handle without wrapping every
 * call. Nothing in `src` installs one, and ESLint keeps it that way.
 *
 * Import this module directly rather than through `src/db.ts`. A spec that
 * mocks `src/db` then still reaches the real scope and the stub installed in it.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Executor } from './executor';

export class NoDatabaseScopeError extends Error {
  constructor() {
    super(
      'No database scope on this call path. Open one with runWithConnection() or '
      + 'runWithEnvConnection(); work handed to ctx.waitUntil() needs its own.',
    );
    this.name = 'NoDatabaseScopeError';
  }
}

const executorStorage = new AsyncLocalStorage<Executor>();

let fallback: Executor | undefined;

/**
 * The current scope's handle: the transaction while inside `transaction()`,
 * otherwise the request's database, otherwise the installed fallback.
 */
export function db(): Executor {
  const executor = executorStorage.getStore() ?? fallback;
  if (executor === undefined) {
    throw new NoDatabaseScopeError();
  }
  return executor;
}

/**
 * Runs `fn` with `executor` as the scope's handle. `runWithConnection` calls
 * this once per request.
 */
export function withDatabase<T>(executor: Executor, fn: () => Promise<T>): Promise<T> {
  return executorStorage.run(executor, fn);
}

/**
 * Makes `executor` what `db()` returns outside any scope, for tests. An open
 * scope still wins. Pass `null` to remove it, after which `db()` throws again.
 */
export function installDatabase(executor: Executor | null): void {
  fallback = executor ?? undefined;
}

/**
 * Runs `fn` in a transaction on the current handle. Every `db()` inside `fn`, at
 * any depth, returns the transaction. A nested `transaction()` is a savepoint.
 */
export function transaction<T>(fn: () => Promise<T>): Promise<T> {
  return db().transaction((tx) => executorStorage.run(tx, fn));
}

/** Whether the current scope's handle is a transaction. */
export function inTransaction(): boolean {
  return executorStorage.getStore() instanceof PgTransaction;
}
