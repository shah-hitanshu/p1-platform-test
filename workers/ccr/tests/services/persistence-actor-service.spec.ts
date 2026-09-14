/**
 * PCC-3457 review fix S3: app.users doubles as the login allowlist (activates
 * once the first row exists, migration 017). JIT provisioning must never
 * create that first row, or an incidental OAuth edit in a fresh environment
 * locks everyone out at login.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { users } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { createActorResolver } from '../../src/services/persistence-actor-service';

const SUBJECT = 'auth0|pn-11111111-2222-3333-4444-555555555555';

let database: DatabaseStub;

beforeEach(() => {
  database = stubDatabase();
});

describe('PCC-3457 S3: allowlist bootstrap guard', () => {
  it('refuses to JIT-provision into an empty users table and attempts no insert', async () => {
    database.on(users).select.returns([]);

    const resolve = createActorResolver();
    const result = await resolve({
      actorId: SUBJECT,
      actorType: 'user',
      actorEmail: 'first-user@example.test',
      actorName: 'First User',
    });

    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toContain('allowlist');
    }
    expect(database.calls(users).insert).toHaveLength(0);
  });
});
