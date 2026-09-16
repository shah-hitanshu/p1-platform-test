/**
 * A Drizzle handle that answers from stubs instead of a database.
 *
 * This is the database for unit tests: no process outside the test runner, so it
 * runs in the default tier. Tests needing a real Postgres take their connection
 * from `tests/helpers/database.ts` instead.
 *
 * `stubDatabase()` installs its handle as the scope fallback, so from then on the
 * code under test reaches it through `db()` with nothing wrapped. Calling it in
 * `beforeEach` gives every test a fresh one. The others in this directory replace
 * a module Node cannot resolve, and are wired by alias in the vitest config
 * rather than imported.
 *
 * Stubs are keyed by table and operation, so a test says what a query against a
 * table returns without restating the query. Adding an unrelated query to the
 * code under test does not disturb a test that never stubbed it: unstubbed
 * queries return no rows. Where one path asks the same table two different
 * questions, `whenBound` picks the answer by the parameters the query carries,
 * and `whenAsking` by a fragment of the question itself for the reads that
 * carry the same values; there is no way to answer by call order, and none
 * should be added.
 *
 * Rows are the shape the schema declares, in the property names Drizzle maps to.
 * A raw statement reading from a CTE or derived table is keyed by that name
 * instead, since no schema table describes what it selects.
 * The stub is what the query returns, so a test asserts on what the code did with
 * it. Whether the SQL was right is not answerable here — that belongs in
 * `tests/db` against a real Postgres.
 *
 * A query can also fail. `rejects` takes the error the driver would raise and
 * wraps it the way Drizzle does, so code reading a SQLSTATE off `cause` is
 * exercised through the same path it takes in production.
 *
 * `transaction` reports the transaction scope: how many were opened, how many
 * committed, and a hook for work that must happen after a commit rather than
 * inside it.
 */

import { isDeepStrictEqual } from 'node:util';
import { DrizzleQueryError, getTableName, type InferSelectModel, type Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import * as schema from '../../src/db/schema';
import type { Database } from '../../src/db/executor';
import { installDatabase } from '../../src/db/scope';
import { describeQuery } from '../../src/db/describe-query';

export type Operation = 'select' | 'insert' | 'update' | 'delete' | 'other';

export interface RecordedCall {
  sql: string;
  params: unknown[];
}

interface OperationStub<T extends Table> {
  /** Rows every matching query returns, in the schema's property names. */
  returns: (rows: Partial<InferSelectModel<T>>[]) => void;
  /** For projections the schema cannot describe, such as aggregates and aliases. */
  returnsRaw: (rows: Record<string, unknown>[]) => void;
  /** The driver error every matching query fails with, as Drizzle surfaces it. */
  rejects: (error: Error) => void;
  /**
   * Rows for queries binding every one of `params`, compared by value. One code
   * path can ask the same table two different questions; this answers them by
   * what was asked rather than by the order they were asked in. A value bound
   * inside a list parameter counts as bound. `params` need not be the whole
   * binding, only enough to tell the query from the others: the stub naming the
   * most parameters wins, and a tie between two matching stubs raises rather
   * than resolving to one of them. Checked before the unconditional stub.
   */
  whenBound: (params: unknown[]) => Pick<OperationStub<T>, 'returns' | 'returnsRaw'>;
  /**
   * The answer for queries whose statement matches `pattern`. For the writes and
   * reads that differ only in what they ask — a row at a version number and the
   * nearest baseline at or below it carry identical values, and one of two
   * inserts into the same table can be the one that fails — where `whenBound`
   * cannot tell them apart. Checked after `whenBound`, which is the narrower of
   * the two, and before the unconditional stub.
   */
  whenAsking: (pattern: RegExp) => Pick<OperationStub<T>, 'returns' | 'returnsRaw' | 'rejects'>;
}

/** The transaction scope, for tests about whether and when work commits. */
export interface TransactionScope {
  /** How many transactions were opened. A nested one is a savepoint and counts. */
  opened: number;
  /** How many committed. A body that threw never does. */
  committed: number;
  /**
   * Runs on each commit. Post-commit work is ordered against this: a purge that
   * runs before the commit is a different behaviour from one that runs after.
   */
  onCommit: (listener: () => void) => void;
}

export interface DatabaseStub {
  db: Database;
  on: {
    <T extends Table>(table: T): Record<Operation, OperationStub<T>>;
    /**
     * A raw statement whose outer relation is a CTE or derived table is keyed
     * by that name, because that is what the statement reads from.
     */
    (relation: string): Record<Operation, OperationStub<Table>>;
  };
  calls: (table: Table | string) => Record<Operation, RecordedCall[]>;
  /** Every statement in order, including ones no stub matched. */
  statements: RecordedCall[];
  transaction: TransactionScope;
}

const OPERATIONS: Operation[] = ['select', 'insert', 'update', 'delete', 'other'];

/**
 * Whether a query carries `value`. A list bound as one parameter counts as
 * binding each of its entries, so a test names the value it cares about rather
 * than the array it happens to travel in.
 */
function isBound(value: unknown, params: unknown[]): boolean {
  return params.some(
    (param) => isDeepStrictEqual(param, value)
      || (Array.isArray(param) && param.some((entry) => isDeepStrictEqual(entry, value))),
  );
}

export function stubDatabase(): DatabaseStub {
  const stubs = new Map<string, Record<string, unknown>[]>();
  const boundStubs = new Map<string, { params: unknown[]; rows: Record<string, unknown>[] }[]>();
  const askingStubs = new Map<string, { pattern: RegExp; rows: Record<string, unknown>[] }[]>();
  const failures = new Map<string, Error>();
  const askingFailures = new Map<string, { pattern: RegExp; error: Error }[]>();
  const recorded = new Map<string, RecordedCall[]>();
  const statements: RecordedCall[] = [];

  // Drizzle reads serializers and parsers off the client and nothing else until
  // a query runs, and no query reaches the driver here.
  const client = { options: { parsers: {}, serializers: {} } } as unknown as postgres.Sql;
  const db = drizzle(client, { schema }) as Database;
  installDatabase(db);

  const session = (db as unknown as { _: { session: Record<string, unknown> } })._.session;

  session.prepareQuery = (query: { sql: string; params: unknown[] }): Record<string, unknown> => {
    const answer = (): Promise<unknown> => {
      const { 'db.operation.name': operation, 'db.collection.name': table } = describeQuery(query.sql);
      const key = `${table ?? ''}.${operation}`;
      const call: RecordedCall = { sql: query.sql, params: query.params };
      statements.push(call);
      recorded.set(key, [...(recorded.get(key) ?? []), call]);
      const failure = askingFailures.get(key)?.find(
        (candidate) => candidate.pattern.test(query.sql),
      )?.error ?? failures.get(key);
      if (failure !== undefined) {
        return Promise.reject(new DrizzleQueryError(query.sql, query.params, failure));
      }
      const asking = askingStubs.get(key)?.find(
        (candidate) => candidate.pattern.test(query.sql),
      );
      const matched = (boundStubs.get(key) ?? []).filter(
        (candidate) => candidate.params.every((param) => isBound(param, query.params)),
      );
      const widest = Math.max(...matched.map((candidate) => candidate.params.length));
      const bound = matched.filter((candidate) => candidate.params.length === widest);
      if (bound.length > 1) {
        throw new Error(
          `${String(bound.length)} whenBound stubs for ${key} match the same query. Give them `
          + `parameters that tell the queries apart.\n${query.sql}\n`
          + `bound: ${JSON.stringify(query.params)}`,
        );
      }
      return Promise.resolve(bound[0]?.rows ?? asking?.rows ?? stubs.get(key) ?? []);
    };

    const prepared: Record<string, unknown> = { execute: answer, all: answer, values: answer };
    prepared.setToken = (): Record<string, unknown> => prepared;
    return prepared;
  };

  // Nothing is written, so there is nothing to roll back; the callback runs
  // against the same handle. Commit and rollback semantics are `tests/db` work;
  // what is answerable here is whether a transaction was opened, and what ran
  // after it committed.
  const commitListeners: (() => void)[] = [];
  const transaction: TransactionScope = {
    opened: 0,
    committed: 0,
    onCommit: (listener: () => void) => {
      commitListeners.push(listener);
    },
  };

  session.transaction = async <T>(fn: (tx: Database) => Promise<T>): Promise<T> => {
    transaction.opened += 1;
    const result = await fn(db);
    transaction.committed += 1;
    for (const listener of commitListeners) {
      listener();
    }
    return result;
  };

  const keyFor = (table: Table | string, operation: Operation): string =>
    `${typeof table === 'string' ? table : getTableName(table)}.${operation}`;

  return {
    db,
    on: (table: Table | string) =>
      byOperation(table, (key) => ({
        returns: (rows: Record<string, unknown>[]) => {
          stubs.set(key, rows);
        },
        returnsRaw: (rows: Record<string, unknown>[]) => {
          stubs.set(key, rows);
        },
        rejects: (error: Error) => {
          failures.set(key, error);
        },
        whenBound: (params: unknown[]) => {
          const record = (rows: Record<string, unknown>[]): void => {
            boundStubs.set(key, [...(boundStubs.get(key) ?? []), { params, rows }]);
          };
          return { returns: record, returnsRaw: record };
        },
        whenAsking: (pattern: RegExp) => {
          const record = (rows: Record<string, unknown>[]): void => {
            askingStubs.set(key, [...(askingStubs.get(key) ?? []), { pattern, rows }]);
          };
          return {
            returns: record,
            returnsRaw: record,
            rejects: (error: Error) => {
              askingFailures.set(key, [...(askingFailures.get(key) ?? []), { pattern, error }]);
            },
          };
        },
      })),
    calls: (table: Table | string) => byOperation(table, (key) => recorded.get(key) ?? []),
    statements,
    transaction,
  };

  function byOperation<V>(table: Table | string, build: (key: string) => V): Record<Operation, V> {
    return Object.fromEntries(
      OPERATIONS.map((operation) => [operation, build(keyFor(table, operation))]),
    ) as Record<Operation, V>;
  }
}
