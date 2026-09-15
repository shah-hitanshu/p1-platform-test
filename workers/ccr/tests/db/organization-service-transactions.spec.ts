/**
 * The organization service's transaction owners against a real Postgres: what
 * survives when a statement inside one of them fails.
 *
 * A stubbed handle runs the callback and nothing else, so whether the writes
 * inside it land together is only answerable here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { organizations, users } from '../../src/db/schema';
import { db, withDatabase } from '../../src/db/scope';
import { createOrgForUser, getOrganizationRole } from '../../src/services/organization-service';
import { TEST_CONNECTION_STRING } from '../helpers/database';

const ABSENT_USER = '99999999-9999-9999-9999-999999999999';

const clients: postgres.Sql[] = [];
const createdOrgs: string[] = [];
const createdUsers: string[] = [];

function connect(): ReturnType<typeof drizzle<typeof schema>> {
  const client = postgres(TEST_CONNECTION_STRING, { max: 1, idle_timeout: 5, onnotice: () => undefined });
  clients.push(client);
  return drizzle(client, { schema });
}

afterEach(async () => {
  const cleanup = connect();
  for (const id of createdOrgs.splice(0)) {
    await cleanup.delete(organizations).where(eq(organizations.id, id));
  }
  for (const id of createdUsers.splice(0)) {
    await cleanup.delete(users).where(eq(users.id, id));
  }
  await Promise.all(clients.splice(0).map((client) => client.end({ timeout: 5 }).catch(() => undefined)));
});

describe('createOrgForUser', () => {
  it('makes the creator the owner of the organization it creates', async () => {
    await withDatabase(connect(), async () => {
      const [user] = await db()
        .insert(users)
        .values({ email: `owner-${String(Date.now())}@example.test`, systemRole: 'member' })
        .returning({ id: users.id });
      createdUsers.push(user.id);

      const org = await createOrgForUser(user.id, `owner-${String(Date.now())}@example.test`, 'Transaction Owner');
      createdOrgs.push(org.id);

      expect(await getOrganizationRole(org.id, user.id)).toBe('owner');
    });
  });

  // The organization and its owner are one write. An account nobody can
  // administer is worse than no account at all: nothing can add the first
  // member to it.
  it('leaves no organization behind when the membership cannot be written', async () => {
    await withDatabase(connect(), async () => {
      const name = `orphan-check-${String(Date.now())}`;

      await expect(createOrgForUser(ABSENT_USER, 'nobody@example.test', name)).rejects.toThrow();

      const left = await db().select({ id: organizations.id }).from(organizations).where(eq(organizations.name, name));
      expect(left).toEqual([]);
    });
  });
});

