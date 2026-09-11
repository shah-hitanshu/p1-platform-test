/**
 * Query guard behaviour against a real Postgres.
 *
 * Both layers need a server to demonstrate: `statement_timeout` is enforced by
 * Postgres, and the client-side deadline is defined by what it does to the
 * backend. Neither is observable against a fake driver.
 */

import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { withQueryGuard, STATEMENT_TIMEOUT_MS, QUERY_DEADLINE_MS } from '../../src/db/query-guard';
import { TEST_CONNECTION_STRING } from '../helpers/database';

/**
 * Drizzle rejects with a `DrizzleQueryError` carrying the driver's error as
 * `cause`, so the postgres error code and the guard's own message are one level
 * down from what a caller catches.
 */
function driverError(error: unknown): { code?: string; message: string } {
  const cause = (error as { cause?: unknown }).cause;
  return (cause ?? error) as { code?: string; message: string };
}

const clients: postgres.Sql[] = [];

function connect(options: postgres.Options<Record<string, never>> = {}): postgres.Sql {
  const client = postgres(TEST_CONNECTION_STRING, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
    ...options,
  });
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end({ timeout: 5 }).catch(() => undefined)));
});

describe('statement_timeout', () => {
  it('cancels a statement that outlives it and leaves the connection usable', async () => {
    const client = connect({ connection: { statement_timeout: 250 } });
    const db = drizzle(withQueryGuard(client));

    const failure = await db.execute(sql`select pg_sleep(2)`).catch((error: unknown) => error);

    expect(driverError(failure).code).toBe('57014');

    const after = await db.execute(sql`select 1 as ok`);
    expect(after).toEqual([{ ok: 1 }]);
  });

  it('is set to the same budget the client-side deadline waits past', () => {
    expect(QUERY_DEADLINE_MS).toBeGreaterThan(STATEMENT_TIMEOUT_MS);
  });
});

describe('the client-side deadline', () => {
  it('rejects when the server accepts the socket and never answers', async () => {
    // statement_timeout cannot fire here: no server ever receives the statement.
    const server = net.createServer(() => undefined);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;

    const client = postgres(`postgresql://cssuser:csspass@127.0.0.1:${String(port)}/cssdb`, {
      max: 1,
      connect_timeout: 30,
      onnotice: () => undefined,
      connection: { statement_timeout: 250 },
    });
    const db = drizzle(withQueryGuard(client, { deadlineMs: 300 }));

    const failure = await db.execute(sql`select 1`).catch((error: unknown) => error);

    expect(driverError(failure).message).toContain('exceeded 300ms');

    await client.end({ timeout: 1 }).catch(() => undefined);
    server.close();
  });

  it('cancels the backend rather than abandoning it', async () => {
    const client = connect({ connection: { statement_timeout: 30_000 } });
    const db = drizzle(withQueryGuard(client, { deadlineMs: 250 }));

    const failure = await db.execute(sql`select pg_sleep(5)`).catch((error: unknown) => error);
    expect(driverError(failure).message).toContain('exceeded 250ms');

    const observer = connect();
    const [{ running }] = await observer<{ running: number }[]>`
      select count(*)::int as running
      from pg_stat_activity
      where query like '%pg_sleep(5)%'
        and state = 'active'
        and pid <> pg_backend_pid()
    `;
    expect(running).toBe(0);
  });
});

describe('statements inside a transaction', () => {
  it('are guarded', async () => {
    const client = connect({ connection: { statement_timeout: 30_000 } });
    const db = drizzle(withQueryGuard(client, { deadlineMs: 250 }));

    const failure = await db
      .transaction(async (tx) => tx.execute(sql`select pg_sleep(5)`))
      .catch((error: unknown) => error);

    expect(driverError(failure).message).toContain('exceeded 250ms');
  });

  it('commit and roll back through the guarded handle', async () => {
    const client = connect();
    const db = drizzle(withQueryGuard(client));

    await db.execute(sql`create temp table guard_probe (id int primary key)`);

    await db.transaction(async (tx) => {
      await tx.execute(sql`insert into guard_probe values (1)`);
    });

    await db
      .transaction(async (tx) => {
        await tx.execute(sql`insert into guard_probe values (2)`);
        throw new Error('force rollback');
      })
      .catch(() => undefined);

    const rows = await db.execute(sql`select id from guard_probe order by id`);
    expect(rows).toEqual([{ id: 1 }]);
  });
});
