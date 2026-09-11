/**
 * The request scope against a real Postgres: what `db()` resolves to inside and
 * outside `transaction()`, and that a transaction's writes commit or roll back
 * as one.
 */

import { describe, it, expect, afterEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { organizations } from '../../src/db/schema';
import { db, withDatabase, inTransaction, transaction } from '../../src/db/scope';
import { runWithConnection, query } from '../../src/db';
import { TEST_CONNECTION_STRING } from '../helpers/database';

const clients: postgres.Sql[] = [];
const created: string[] = [];

function connect(): ReturnType<typeof drizzle<typeof schema>> {
  const client = postgres(TEST_CONNECTION_STRING, { max: 1, idle_timeout: 5, onnotice: () => undefined });
  clients.push(client);
  return drizzle(client, { schema });
}

async function insertOrganization(name: string): Promise<string> {
  const [row] = await db().insert(organizations).values({ name }).returning({ id: organizations.id });
  created.push(row.id);
  return row.id;
}

afterEach(async () => {
  const cleanup = connect();
  for (const id of created.splice(0)) {
    await cleanup.delete(organizations).where(eq(organizations.id, id));
  }
  await Promise.all(clients.splice(0).map((client) => client.end({ timeout: 5 }).catch(() => undefined)));
});

describe('withDatabase', () => {
  it('makes the handle it is given the one db() returns', async () => {
    const handle = connect();
    await withDatabase(handle, async () => {
      expect(db()).toBe(handle);
      expect(inTransaction()).toBe(false);
    });
  });
});

describe('transaction', () => {
  it('hands every db() inside it the transaction and commits their writes together', async () => {
    const handle = connect();
    await withDatabase(handle, async () => {
      const id = await transaction(async () => {
        expect(inTransaction()).toBe(true);
        expect(db()).not.toBe(handle);
        const inserted = await insertOrganization('scope-commit');
        // A participant two calls deep sees the same transaction.
        await (async () => {
          expect(db()).not.toBe(handle);
        })();
        return inserted;
      });
      expect(db()).toBe(handle);
      const rows = await handle.select().from(organizations).where(eq(organizations.id, id));
      expect(rows).toHaveLength(1);
    });
  });

  it('rolls back every write made inside it when the callback throws', async () => {
    const handle = connect();
    await withDatabase(handle, async () => {
      let id = '';
      await expect(
        transaction(async () => {
          id = await insertOrganization('scope-rollback');
          throw new Error('abandon');
        }),
      ).rejects.toThrow('abandon');
      const rows = await handle.select().from(organizations).where(eq(organizations.id, id));
      expect(rows).toHaveLength(0);
    });
  });

  it('rolls a nested transaction back to its savepoint without losing the outer writes', async () => {
    const handle = connect();
    await withDatabase(handle, async () => {
      const outerId = await transaction(async () => {
        const kept = await insertOrganization('scope-outer');
        await expect(
          transaction(async () => {
            await insertOrganization('scope-inner');
            throw new Error('inner only');
          }),
        ).rejects.toThrow('inner only');
        return kept;
      });
      const names = (await handle.select({ name: organizations.name }).from(organizations)
        .where(eq(organizations.id, outerId))).map((row) => row.name);
      expect(names).toEqual(['scope-outer']);
      const inner = await handle.select().from(organizations).where(eq(organizations.name, 'scope-inner'));
      expect(inner).toHaveLength(0);
    });
  });
});

describe('runWithConnection', () => {
  it('opens a scope for its callback', async () => {
    await runWithConnection(TEST_CONNECTION_STRING, { isHyperdrive: false }, async () => {
      const [row] = await db().select({ one: organizations.id }).from(organizations).limit(1);
      expect(row === undefined || typeof row.one === 'string').toBe(true);
    });
  });

  it('refuses a legacy query() inside a Drizzle transaction', async () => {
    await runWithConnection(TEST_CONNECTION_STRING, { isHyperdrive: false }, async () => {
      await expect(transaction(() => query('SELECT 1'))).rejects.toThrow(/inside a Drizzle transaction/);
    });
  });
});
