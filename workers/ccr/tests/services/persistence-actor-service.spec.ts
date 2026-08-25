/**
 * PCC-3457 review fixes S1 + S3: resolver-level guards that are hard to
 * exercise deterministically through the integration harness.
 *
 * S1 — the JIT upsert's WHERE guard must include the same-principal arm
 *      (`OR principal_id = EXCLUDED.principal_id`) so a concurrent batch that
 *      just linked this exact principal resolves instead of being skipped
 *      with a misleading "different principal" reason.
 * S3 — app.users doubles as the login allowlist (activates once the first
 *      row exists, migration 017). JIT provisioning must never create that
 *      first row, or an incidental OAuth edit in a fresh environment locks
 *      everyone out at login.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

import { query } from '../../src/db';
import { createActorResolver } from '../../src/services/persistence-actor-service';

const SUBJECT = 'auth0|pn-11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('PCC-3457 S3: allowlist bootstrap guard', () => {
  it('refuses to JIT-provision into an empty users table and attempts no insert', async () => {
    vi.mocked(query).mockImplementation((sql: string) => {
      if (sql.includes('WHERE principal_id')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes('SELECT EXISTS')) {
        return Promise.resolve({ rows: [{ exists: false }], rowCount: 1 });
      }
      throw new Error(`unexpected query in empty-table scenario: ${sql}`);
    });

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
    // No INSERT was ever attempted.
    const insertCalls = vi
      .mocked(query)
      .mock.calls.filter(([sql]) => (sql).includes('INSERT INTO app.users'));
    expect(insertCalls).toHaveLength(0);
  });
});

describe('PCC-3457 S1: same-principal race arm on the JIT upsert', () => {
  it('issues the upsert with the same-principal OR arm so a concurrent linker of the SAME principal resolves', async () => {
    const userId = '99999999-8888-4777-8666-555555555555';
    vi.mocked(query).mockImplementation((sql: string) => {
      if (sql.includes('WHERE principal_id')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes('SELECT EXISTS')) {
        return Promise.resolve({ rows: [{ exists: true }], rowCount: 1 });
      }
      if (sql.includes('INSERT INTO app.users')) {
        // The WHERE guard must permit BOTH the unclaimed row and the row a
        // concurrent batch just linked to this exact principal.
        expect(sql).toContain('principal_id IS NULL');
        expect(sql).toContain('OR app.users.principal_id = EXCLUDED.principal_id');
        return Promise.resolve({ rows: [{ id: userId }], rowCount: 1 });
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const resolve = createActorResolver();
    const result = await resolve({
      actorId: SUBJECT,
      actorType: 'user',
      actorEmail: 'racer@example.test',
      actorName: 'Racer',
    });

    expect(result).toEqual({ resolved: true, actorId: userId });
  });
});
