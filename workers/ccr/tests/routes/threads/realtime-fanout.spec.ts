/**
 * A committed comment is pushed to the sessions of every branch on which someone
 * has the document open, off the request path, without the poster's email.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/env';
import { emitThreadEvent } from '../../../src/routes/threads';
import { notifyDocumentEditors } from '../../../src/routes/threads/realtime-fanout';
import { COMMENT_ID, DOCUMENT_ID, SITE_ID, THREAD_ID, USER_ID, makeComment, makeThread } from '../../helpers/threads';

vi.mock('@pantheon-systems/p1-telemetry', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { getLogger: () => logger, __logger: logger };
});

function makeCtx(): { ctx: ExecutionContext; settled: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { ctx, settled: async () => { await Promise.all(pending); } };
}

interface FakeEnv {
  env: Env;
  getDocumentBranches: ReturnType<typeof vi.fn>;
  sessionFetch: ReturnType<typeof vi.fn>;
  sessionNames: string[];
}

function makeEnv(branches: string[]): FakeEnv {
  const getDocumentBranches = vi.fn().mockResolvedValue(branches);
  const sessionFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  const sessionNames: string[] = [];
  const env = {
    PRESENCE: {
      idFromName: (name: string) => ({ name }),
      get: () => ({ getDocumentBranches }),
    },
    DOCUMENT_STATE: {
      idFromName: (name: string) => { sessionNames.push(name); return { name }; },
      get: () => ({ fetch: sessionFetch }),
    },
  } as unknown as Env;
  return { env, getDocumentBranches, sessionFetch, sessionNames };
}

async function requestsSent(sessionFetch: ReturnType<typeof vi.fn>) {
  return Promise.all(
    sessionFetch.mock.calls.map(async (call) => {
      const request = call[0] as Request;
      return {
        url: request.url,
        method: request.method,
        sessionId: request.headers.get('X-Session-Id'),
        body: await request.json<{ type: string; event: Record<string, unknown>; timestamp: number }>(),
      };
    }),
  );
}

describe('notifyDocumentEditors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the event to each branch session that has the document open, without the requester', async () => {
    const { ctx, settled } = makeCtx();
    const fake = makeEnv(['branch-a', 'branch-b']);
    const thread = makeThread();
    const comment = makeComment();

    notifyDocumentEditors(ctx, fake.env, {
      type: 'comment_posted',
      siteId: SITE_ID,
      thread,
      comment,
      requester: { id: USER_ID, email: 'ada@example.com', name: 'Ada Lovelace' },
    });
    await settled();

    expect(fake.getDocumentBranches).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(fake.sessionNames.sort()).toEqual([
      `${SITE_ID}:${DOCUMENT_ID}:branch-a`,
      `${SITE_ID}:${DOCUMENT_ID}:branch-b`,
    ]);

    const sent = await requestsSent(fake.sessionFetch);
    expect(sent).toHaveLength(2);
    for (const request of sent) {
      expect(request.url).toBe('http://internal/notify');
      expect(request.method).toBe('POST');
      expect(request.sessionId).toMatch(new RegExp(`^${SITE_ID}:${DOCUMENT_ID}:branch-[ab]$`));
      expect(request.body.type).toBe('thread_event');
      expect(request.body.event).toEqual({ type: 'comment_posted', siteId: SITE_ID, thread, comment });
      expect(JSON.stringify(request.body)).not.toContain('ada@example.com');
      expect(typeof request.body.timestamp).toBe('number');
    }
  });

  it('carries status changes and rewritten comments too', async () => {
    const { ctx, settled } = makeCtx();
    const fake = makeEnv(['branch-a']);
    const thread = makeThread({ status: 'resolved' });
    const actor = { type: 'user' as const, id: USER_ID, name: 'Ada Lovelace', avatar: null };

    notifyDocumentEditors(ctx, fake.env, { type: 'thread_status_changed', siteId: SITE_ID, thread, actor });
    notifyDocumentEditors(ctx, fake.env, { type: 'comment_updated', siteId: SITE_ID, thread, comment: makeComment() });
    await settled();

    const sent = await requestsSent(fake.sessionFetch);
    expect(sent.map((r) => r.body.event.type)).toEqual(['thread_status_changed', 'comment_updated']);
    expect(sent[0].body.event.actor).toEqual(actor);
  });

  it('sends nothing when nobody has the document open, or the thread has no document', async () => {
    const { ctx, settled } = makeCtx();
    const nobody = makeEnv([]);
    notifyDocumentEditors(ctx, nobody.env, { type: 'comment_posted', siteId: SITE_ID, thread: makeThread(), comment: makeComment() });

    const siteThread = makeEnv(['branch-a']);
    notifyDocumentEditors(ctx, siteThread.env, {
      type: 'comment_posted',
      siteId: SITE_ID,
      thread: makeThread({ documentId: null, context: { type: 'site', id: SITE_ID } }),
      comment: makeComment(),
    });
    await settled();

    expect(nobody.sessionFetch).not.toHaveBeenCalled();
    expect(siteThread.getDocumentBranches).not.toHaveBeenCalled();
    expect(siteThread.sessionFetch).not.toHaveBeenCalled();
  });

  it('logs a failed push instead of failing the write', async () => {
    const { ctx, settled } = makeCtx();
    const fake = makeEnv(['branch-a', 'branch-b']);
    fake.sessionFetch
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockRejectedValueOnce(new Error('session unreachable'));
    const { __logger } = await import('@pantheon-systems/p1-telemetry') as unknown as { __logger: { warn: ReturnType<typeof vi.fn> } };

    notifyDocumentEditors(ctx, fake.env, { type: 'comment_posted', siteId: SITE_ID, thread: makeThread(), comment: makeComment() });
    await expect(settled()).resolves.toBeUndefined();

    expect(__logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('push failed'),
      expect.objectContaining({ thread_id: THREAD_ID, failed_count: 1, branch_count: 2 }),
    );
  });

  it('is reached from emitThreadEvent', async () => {
    const { ctx, settled } = makeCtx();
    const fake = makeEnv(['branch-a']);

    emitThreadEvent(ctx, fake.env, { type: 'comment_posted', siteId: SITE_ID, thread: makeThread(), comment: makeComment({ id: COMMENT_ID }) });
    await settled();

    expect(fake.sessionFetch).toHaveBeenCalledTimes(1);
  });
});
