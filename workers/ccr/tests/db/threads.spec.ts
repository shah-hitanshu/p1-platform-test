/**
 * Thread threads against a real Postgres.
 *
 * The thread-per-context guarantee lives in a partial unique index plus a
 * transaction that re-selects after a lost insert race, and the overview list
 * collapses rows with DISTINCT ON. A stubbed query cannot exercise either.
 *
 * Prerequisites:
 * - PostgreSQL running: podman start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type postgres from 'postgres';
import type { Database } from '../../src/db';
import { branches, documents, sites, users } from '../../src/db/schema';
import { runWithConnection } from '../../src/db';
import * as service from '../../src/services/threads/threads-service';
import type { ThreadActor } from '../../src/types/threads';
import {
  TEST_CONNECTION_STRING,
  asConcurrentRequests,
  createRealDatabaseConnection,
  deleteSiteCascade,
} from '../helpers/database';

// The service reaches the database through the request scope, so each call
// runs as its own request: that is what gives it a real transaction.
function asRequest<F extends (...args: never[]) => Promise<unknown>>(fn: F): F {
  return ((...args: Parameters<F>) =>
    runWithConnection(TEST_CONNECTION_STRING, { isHyperdrive: false }, () => fn(...args))) as F;
}
const postComment = asRequest(service.postComment);
const replyToThread = asRequest(service.replyToThread);
const getThread = asRequest(service.getThread);
const listThreads = asRequest(service.listThreads);
const listThreadsForContext = asRequest(service.listThreadsForContext);
const setThreadStatus = asRequest(service.setThreadStatus);

let db: Database;
let sql: postgres.Sql;
let close: () => Promise<void>;
let siteIds: string[] = [];
let userIds: string[] = [];
let siteId: string;
let documentId: string;
let actor: ThreadActor;

async function createSite(): Promise<string> {
  const [row] = await db
    .insert(sites)
    .values({ name: `threads-${randomUUID()}` })
    .returning({ id: sites.id });
  siteIds.push(row.id);
  await db.insert(branches).values({
    siteId: row.id,
    name: 'main',
    isMain: true,
    createdById: randomUUID(),
    createdByType: 'user',
  });
  return row.id;
}

async function createDocument(forSite: string): Promise<string> {
  const [row] = await db
    .insert(documents)
    .values({ siteId: forSite, path: `/page-${randomUUID()}` })
    .returning({ id: documents.id });
  return row.id;
}

async function createUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email: `${randomUUID()}@example.com`, name })
    .returning({ id: users.id });
  userIds.push(row.id);
  return row.id;
}

function blockContext(id = `Hero-${randomUUID().slice(0, 8)}`) {
  return { type: 'block' as const, id };
}

async function post(context = blockContext(), body = 'first') {
  return postComment({ siteId, context, documentId, body, actor });
}

beforeAll(async () => {
  const handles = createRealDatabaseConnection();
  db = handles.db;
  sql = handles.sql;
  close = handles.close;
  await sql`SELECT 1`;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  siteId = await createSite();
  documentId = await createDocument(siteId);
  actor = { type: 'user', id: await createUser('Ada Lovelace') };
});

afterEach(async () => {
  for (const id of [...siteIds].reverse()) {
    await deleteSiteCascade(sql, id);
  }
  siteIds = [];
  for (const id of userIds) {
    await sql`DELETE FROM app.users WHERE id = ${id}`;
  }
  userIds = [];
});

describe('postComment', () => {
  it('opens a thread on the first comment and attributes it to the author', async () => {
    const write = await post(blockContext('Hero-1'), 'Can we tighten this?');

    expect(write.reopened).toBe(false);
    expect(write.thread).toMatchObject({
      siteId,
      context: { type: 'block', id: 'Hero-1' },
      documentId,
      status: 'open',
      commentCount: 1,
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(write.comment).toMatchObject({
      threadId: write.thread.id,
      kind: 'message',
      body: 'Can we tighten this?',
      author: { type: 'user', id: actor.id, name: 'Ada Lovelace', avatar: null },
      editedAt: null,
    });
  });

  it('lands two racing first posts on one thread with two comments', async () => {
    const context = blockContext('Hero-race');

    await asConcurrentRequests(
      () => service.postComment({ siteId, context, documentId, body: 'one', actor }),
      () => service.postComment({ siteId, context, documentId, body: 'two', actor }),
    );

    const threads = await listThreadsForContext(siteId, context);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.commentCount).toBe(2);
  });

  it('appends to the existing thread and reopens a resolved one', async () => {
    const context = blockContext();
    const first = await post(context);
    await setThreadStatus(siteId, first.thread.id, 'resolved', actor);

    const second = await post(context, 'still an issue');

    expect(second.thread.id).toBe(first.thread.id);
    expect(second.reopened).toBe(true);
    expect(second.thread).toMatchObject({ status: 'open', commentCount: 2, resolvedAt: null, resolvedBy: null });
  });

  it('keeps threads on the same block apart by site', async () => {
    const otherSite = await createSite();
    const otherDocument = await createDocument(otherSite);
    const context = blockContext('Hero-shared');

    const mine = await post(context);
    const theirs = await postComment({ siteId: otherSite, context, documentId: otherDocument, body: 'x', actor });

    expect(theirs.thread.id).not.toBe(mine.thread.id);
    expect(await getThread(otherSite, mine.thread.id)).toBeNull();
  });
});

describe('replyToThread', () => {
  it('reopens a resolved thread and records the acting user of an agent', async () => {
    const first = await post();
    await setThreadStatus(siteId, first.thread.id, 'resolved', actor);
    const [organization] = await sql<{ id: string }[]>`
      INSERT INTO app.organizations (name) VALUES ('Threads Test Org') RETURNING id`;
    if (organization === undefined) throw new Error('organization insert returned no row');
    const [agent] = await sql<{ id: string }[]>`
      INSERT INTO app.agents (organization_id, name) VALUES (${organization.id}, 'Copy Editor') RETURNING id`;
    if (agent === undefined) throw new Error('agent insert returned no row');

    try {
      const reply = await replyToThread(siteId, first.thread.id, 'Reworded.', {
        type: 'agent',
        id: agent.id,
        actingUserId: actor.id,
      });

      expect(reply).not.toBeNull();
      expect(reply?.reopened).toBe(true);
      expect(reply?.thread.status).toBe('open');
      expect(reply?.comment.author).toEqual({
        type: 'agent',
        id: agent.id,
        name: 'Copy Editor',
        avatar: null,
        requestedBy: { id: actor.id, name: 'Ada Lovelace' },
      });
    } finally {
      await sql`DELETE FROM app.comments WHERE author_id::text = ${agent.id}`;
      await sql`DELETE FROM app.agents WHERE id = ${agent.id}`;
      await sql`DELETE FROM app.organizations WHERE id = ${organization.id}`;
    }
  });

  it('returns null for a thread on another site', async () => {
    const otherSite = await createSite();
    const first = await post();

    expect(await replyToThread(otherSite, first.thread.id, 'x', actor)).toBeNull();
  });
});

describe('getThread', () => {
  it('returns comments oldest first', async () => {
    const first = await post(blockContext(), 'one');
    await replyToThread(siteId, first.thread.id, 'two', actor);
    await replyToThread(siteId, first.thread.id, 'three', actor);

    const result = await getThread(siteId, first.thread.id);

    expect(result?.thread.commentCount).toBe(3);
    expect(result?.comments.map((c) => c.body)).toEqual(['one', 'two', 'three']);
  });
});

describe('setThreadStatus', () => {
  it('resolves, reports no change on repeat, and reopens', async () => {
    const first = await post();

    const resolved = await setThreadStatus(siteId, first.thread.id, 'resolved', actor);
    const again = await setThreadStatus(siteId, first.thread.id, 'resolved', actor);
    const reopened = await setThreadStatus(siteId, first.thread.id, 'open', actor);

    expect(resolved).toMatchObject({ changed: true, thread: { status: 'resolved' } });
    expect(resolved?.thread.resolvedAt).not.toBeNull();
    expect(resolved?.thread.resolvedBy).toEqual({ type: 'user', id: actor.id, name: 'Ada Lovelace', avatar: null });
    expect(resolved?.actor).toMatchObject({ type: 'user', id: actor.id, name: 'Ada Lovelace' });
    expect(again).toMatchObject({ changed: false, thread: { status: 'resolved' } });
    expect(reopened).toMatchObject({ changed: true, thread: { status: 'open', resolvedAt: null, resolvedBy: null } });
  });
});

describe('listThreads', () => {
  async function seedResolvedAndOpen(context: ReturnType<typeof blockContext>) {
    const resolved = await post(context, 'old');
    await setThreadStatus(siteId, resolved.thread.id, 'resolved', actor);
    // A second thread on the same context is only reachable by writing it directly;
    // the service reopens instead. The overview still has to cope with the shape.
    const [open] = await sql<{ id: string }[]>`
      INSERT INTO app.comment_threads
        (site_id, context_type, context_id, document_id, status, created_by_type, created_by_id)
      VALUES (${siteId}, ${context.type}, ${context.id}, ${documentId}, 'open', 'user', ${actor.id})
      RETURNING id`;
    if (open === undefined) throw new Error('thread insert returned no row');
    return { resolvedId: resolved.thread.id, openId: open.id };
  }

  it('collapses a context with both a resolved and an open thread to the open one', async () => {
    const context = blockContext('Hero-both');
    const { resolvedId, openId } = await seedResolvedAndOpen(context);

    const page = await listThreads(siteId, { status: 'all', limit: 100 });
    const perContext = await listThreadsForContext(siteId, context);

    expect(page.threads.map((t) => t.id)).toEqual([openId]);
    expect(perContext.map((t) => t.id).sort()).toEqual([openId, resolvedId].sort());
  });

  it('filters by status and document after collapsing', async () => {
    const otherDocument = await createDocument(siteId);
    const resolved = await post(blockContext(), 'a');
    await setThreadStatus(siteId, resolved.thread.id, 'resolved', actor);
    const open = await post(blockContext(), 'b');
    const elsewhere = await postComment({
      siteId,
      context: blockContext(),
      documentId: otherDocument,
      body: 'c',
      actor,
    });

    const openOnly = await listThreads(siteId, { status: 'open', limit: 100 });
    const onDocument = await listThreads(siteId, { documentId, status: 'all', limit: 100 });

    expect(openOnly.threads.map((t) => t.id).sort()).toEqual([open.thread.id, elsewhere.thread.id].sort());
    expect(onDocument.threads.map((t) => t.id).sort()).toEqual([resolved.thread.id, open.thread.id].sort());
  });

  it('pages by the cursor without skipping or repeating', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push((await post(blockContext(), `c${String(i)}`)).thread.id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listThreads(siteId, { status: 'all', limit: 2, cursor });
      seen.push(...page.threads.map((t) => t.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it('lists a site thread without a document', async () => {
    const write = await postComment({
      siteId,
      context: { type: 'site', id: siteId },
      body: 'site-wide note',
      actor,
    });

    const page = await listThreads(siteId, { status: 'all', limit: 100 });

    expect(page.threads.map((t) => t.id)).toEqual([write.thread.id]);
    expect(write.thread.documentId).toBeNull();
  });
});
