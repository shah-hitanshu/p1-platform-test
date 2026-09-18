/**
 * The threads service against a stubbed database: how inputs become SQL
 * parameters, and the branches that never touch a row. Real-row behaviour
 * (locking, collapse, paging) is under tests/db.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ThreadInputError,
  getThread,
  listThreads,
  postComment,
  toThreadActor,
} from '../../../src/services/threads/threads-service';
import { commentThreads, documents, users } from '../../../src/db/schema';
import { stubDatabase, type DatabaseStub, type RecordedCall } from '../../__stubs__/database';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const THREAD_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

let stub: DatabaseStub;

function lastStatement(): RecordedCall {
  const call = stub.statements.at(-1);
  if (call === undefined) throw new Error('no statement ran');
  return call;
}

beforeEach(() => {
  stub = stubDatabase();
});

describe('listThreads', () => {
  it('asks for one row past the limit so the cursor is only set when a next page exists', async () => {
    await listThreads(SITE_ID, { status: 'all', limit: 100 });

    const { sql, params } = lastStatement();
    expect(params).toEqual([SITE_ID, 101]);
    expect(sql).not.toContain('WHERE document_id');
    expect(sql).toContain('DISTINCT ON (t.context_type, t.context_id)');
  });

  it('filters by document and status after the per-context collapse', async () => {
    await listThreads(SITE_ID, { documentId: DOCUMENT_ID, status: 'open', limit: 10 });

    const { sql, params } = lastStatement();
    expect(params).toEqual([SITE_ID, DOCUMENT_ID, 'open', 11]);
    expect(sql).toMatch(/collapsed\s+WHERE document_id = \$2 AND status = \$3/);
  });

  it('turns a valid cursor into a keyset bound on (updated_at, id)', async () => {
    const cursor = btoa(`2026-09-12T10:00:00.000Z|${THREAD_ID}`);

    await listThreads(SITE_ID, { status: 'all', limit: 10, cursor });

    const { sql, params } = lastStatement();
    expect(params).toEqual([SITE_ID, '2026-09-12T10:00:00.000Z', THREAD_ID, 11]);
    expect(sql).toContain('(updated_at, id) < ($2, $3)');
  });

  it('ignores a cursor that is not base64, lacks a separator, or names a non-uuid', async () => {
    for (const cursor of ['%%%not-base64%%%', btoa('no-separator'), btoa('2026-09-12T10:00:00.000Z|nope')]) {
      await listThreads(SITE_ID, { status: 'all', limit: 10, cursor });
      expect(lastStatement().params).toEqual([SITE_ID, 11]);
    }
  });

  it('returns a cursor built from the last row only when a further row came back', async () => {
    const row = (id: string, updatedAt: string) => ({
      id,
      site_id: SITE_ID,
      context_type: 'block',
      context_id: `Hero-${id.slice(0, 4)}`,
      document_id: DOCUMENT_ID,
      status: 'open',
      comment_count: 1,
      last_comment_at: updatedAt,
      created_at: updatedAt,
      updated_at: updatedAt,
      resolved_at: null,
      resolved_by_type: null,
      resolved_by_id: null,
      resolved_by_name: null,
      resolved_by_avatar: null,
    });
    stub.on(commentThreads).select.returnsRaw([
      row('aaaaaaaa-0000-4000-8000-000000000001', '2026-09-12T12:00:00.000Z'),
      row('aaaaaaaa-0000-4000-8000-000000000002', '2026-09-12T11:00:00.000Z'),
      row('aaaaaaaa-0000-4000-8000-000000000003', '2026-09-12T10:00:00.000Z'),
    ]);

    const page = await listThreads(SITE_ID, { status: 'all', limit: 2 });

    expect(page.threads).toHaveLength(2);
    expect(page.nextCursor).toBe(btoa('2026-09-12T11:00:00.000Z|aaaaaaaa-0000-4000-8000-000000000002'));
  });
});

describe('getThread', () => {
  it('reads the overview and the comments in one transaction', async () => {
    await getThread(SITE_ID, THREAD_ID);

    expect(stub.transaction.opened).toBe(1);
    expect(stub.statements).toHaveLength(1);
  });
});

describe('postComment', () => {
  it('refuses a document that belongs to another site before opening a transaction', async () => {
    await expect(
      postComment({
        siteId: SITE_ID,
        context: { type: 'block', id: 'Hero-1' },
        documentId: DOCUMENT_ID,
        body: 'hi',
        actor: { type: 'user', id: USER_ID },
      }),
    ).rejects.toMatchObject({ field: 'documentId' } satisfies Partial<ThreadInputError>);

    expect(lastStatement().params).toEqual([DOCUMENT_ID, SITE_ID]);
    expect(stub.transaction.opened).toBe(0);
  });

  it('refuses a branch that belongs to another site', async () => {
    stub.on(documents).select.returns([{ id: DOCUMENT_ID }]);

    await expect(
      postComment({
        siteId: SITE_ID,
        context: { type: 'block', id: 'Hero-1' },
        documentId: DOCUMENT_ID,
        branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
        body: 'hi',
        actor: { type: 'user', id: USER_ID },
      }),
    ).rejects.toBeInstanceOf(ThreadInputError);
  });
});

describe('toThreadActor', () => {
  it('names a user by their database id, falling back to the principal id', async () => {
    await expect(toThreadActor({ type: 'user', id: 'principal', dbUserId: USER_ID })).resolves.toEqual({
      type: 'user',
      id: USER_ID,
    });
    await expect(toThreadActor({ type: 'user', id: USER_ID })).resolves.toEqual({
      type: 'user',
      id: USER_ID,
    });
    expect(stub.statements).toEqual([]);
  });

  it('records the user an agent acts for when their email matches an active account', async () => {
    stub.on(users).select.returns([{ id: USER_ID }]);

    const actor = await toThreadActor({
      type: 'agent',
      id: 'agent-1',
      actingUserEmail: '  Ada@Example.com ',
    });

    expect(actor).toEqual({ type: 'agent', id: 'agent-1', actingUserId: USER_ID });
    expect(lastStatement().params).toEqual(['ada@example.com']);
  });

  it('leaves the acting user unset when the agent names nobody or nobody matches', async () => {
    await expect(toThreadActor({ type: 'agent', id: 'agent-1' })).resolves.toEqual({
      type: 'agent',
      id: 'agent-1',
    });
    expect(stub.statements).toEqual([]);

    const unmatched = await toThreadActor({ type: 'agent', id: 'agent-1', actingUserEmail: 'x@y.z' });
    expect(unmatched).toEqual({ type: 'agent', id: 'agent-1', actingUserId: undefined });
  });

  it('gives a service principal no actor', async () => {
    await expect(toThreadActor({ type: 'service', id: 'sat_1' })).resolves.toBeNull();
  });
});
