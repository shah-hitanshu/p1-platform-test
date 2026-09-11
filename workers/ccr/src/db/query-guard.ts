/**
 * Bounds every statement a request can issue, in two layers.
 *
 * Postgres enforces the first: `statement_timeout` is a connection option, so the
 * server cancels a long statement itself and rejects with SQLSTATE 57014, leaving
 * the connection usable. The second is a client-side deadline, and it is not
 * redundant — a connection whose socket is accepted but never answers has no
 * server-side statement to time out, which is the Hyperdrive failure that would
 * otherwise let Cloudflare kill the Worker with a bare 500 carrying no CORS
 * headers.
 *
 * The deadline cancels the backend rather than abandoning it, so a query the
 * client has stopped waiting for stops consuming server resources too.
 */

import type postgres from 'postgres';
import { getLogger } from '@pantheon-systems/p1-telemetry';
import { describeQuery } from './describe-query';

// Matches the 30s the cssuser role sets server-side (migration 056), so the cap
// is the same whether or not the pooler forwards this session parameter, and the
// client deadline below always outlasts the effective server timeout.
export const STATEMENT_TIMEOUT_MS = 30_000;

/** Reached only when the server never answers, so it sits past `statement_timeout`. */
export const QUERY_DEADLINE_MS = STATEMENT_TIMEOUT_MS + 2_000;

export interface QueryGuardOptions {
  deadlineMs?: number;
  /**
   * Drizzle reads `options` off the handle it is constructed over, and a
   * transaction handle has none. This supplies the pool's.
   */
  optionsSource?: postgres.Sql;
}

/** The slice of a postgres.js pending query this module drives. */
interface PendingQuery extends PromiseLike<unknown> {
  values: () => PromiseLike<unknown>;
  cancel: () => unknown;
}

/**
 * Wrap a postgres.js handle so every statement Drizzle executes through it is
 * bounded and logged. Transaction and savepoint scopes are re-wrapped, keeping
 * the guard in force for statements issued inside them.
 */
export function withQueryGuard(client: postgres.Sql, options: QueryGuardOptions = {}): postgres.Sql {
  const { deadlineMs = QUERY_DEADLINE_MS, optionsSource } = options;
  return new Proxy(client, {
    get(target, prop, receiver): unknown {
      if (prop === 'unsafe') {
        return guardedUnsafe(target, deadlineMs);
      }
      if (prop === 'begin' || prop === 'savepoint') {
        return guardedScope(target, prop, { deadlineMs, optionsSource: optionsSource ?? client });
      }
      if (prop === 'options' && (target as { options?: unknown }).options === undefined) {
        return optionsSource?.options;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Defer execution until the caller commits to a row format. postgres.js decides
 * that when the query is awaited, and `.values()` has to be applied first, so
 * touching the query eagerly would fix the format before Drizzle chose it.
 */
function guardedUnsafe(
  target: postgres.Sql,
  deadlineMs: number,
): (statement: string, params?: unknown[]) => PromiseLike<unknown> {
  return (statement, params) => {
    const query = target.unsafe(
      statement,
      params as unknown as postgres.ParameterOrJSON<never>[],
    ) as unknown as PendingQuery;

    let started: Promise<unknown> | undefined;
    const start = (source: PromiseLike<unknown>): Promise<unknown> =>
      (started ??= bound(source, query, statement, deadlineMs));

    return {
      then: (onFulfilled, onRejected) => start(query).then(onFulfilled, onRejected),
      catch: (onRejected: (reason: unknown) => unknown) => start(query).catch(onRejected),
      finally: (onFinally: () => void) => start(query).finally(onFinally),
      values: () => start(query.values()),
    } as PromiseLike<unknown>;
  };
}

/** `begin` and `savepoint` hand a fresh handle to their callback. */
function guardedScope(
  target: postgres.Sql,
  prop: 'begin' | 'savepoint',
  options: QueryGuardOptions,
): (...args: unknown[]) => unknown {
  const original = Reflect.get(target, prop) as (...args: unknown[]) => unknown;
  return (...args: unknown[]) => {
    const callback = args.at(-1) as (sql: postgres.Sql) => unknown;
    const leading = args.slice(0, -1);
    return original.call(target, ...leading, (inner: postgres.Sql) =>
      callback(withQueryGuard(inner, options)),
    );
  };
}

async function bound(
  source: PromiseLike<unknown>,
  query: PendingQuery,
  statement: string,
  deadlineMs: number,
): Promise<unknown> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void query.cancel();
      reject(new Error(`Database query exceeded ${String(deadlineMs)}ms`));
    }, deadlineMs);
  });

  let result: unknown;
  try {
    result = await Promise.race([source, deadline]);
  } catch (error) {
    // Operation and table only — never the statement text or parameters, either of
    // which can carry customer content.
    getLogger().warn('query failed', {
      ...describeQuery(statement),
      duration_ms: Date.now() - startedAt,
      timed_out: Date.now() - startedAt >= deadlineMs,
      'error.type': error instanceof Error ? error.name : 'unknown',
      ...sqlState(error),
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }

  getLogger().debug('query', () => ({
    ...describeQuery(statement),
    duration_ms: Date.now() - startedAt,
    'db.response.returned_rows': returnedRows(result),
  }));

  return result;
}

/** 57014 distinguishes a statement the server cancelled from one the client gave up on. */
function sqlState(error: unknown): { 'db.response.status_code'?: string } {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? { 'db.response.status_code': code } : {};
}

function returnedRows(result: unknown): number | undefined {
  const count = (result as { count?: unknown } | null)?.count;
  if (typeof count === 'number') return count;
  return Array.isArray(result) ? result.length : undefined;
}
