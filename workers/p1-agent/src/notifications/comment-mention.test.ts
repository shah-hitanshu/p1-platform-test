import { describe, it, expect, vi } from 'vitest';
import type { CompletionRequest } from '../providers/transport.js';
import type { Comment, ThreadResponse } from '../ccr/thread-types.js';
import type { Env } from '../env.js';
import {
  alreadyReplied,
  handleCommentNotification,
  renderThread,
  replyToMention,
  type MentionCommentDeps,
} from './comment-mention.js';

const AGENT_ID = 'a0000000-0000-0000-0000-000000000003';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const SITE_ID = 'site-1';
const THREAD_ID = 'thread-1';

const env = {
  AGENT_ID,
  AGENT_API_KEY: 'key',
  AGENT_NOTIFY_SECRET: 'shared-secret',
  CCR_BACKEND_URL: 'https://ccr.example.com',
  AGENT_MODEL: 'openai/gpt-test',
} as unknown as Env;

const notification = { siteId: SITE_ID, threadId: THREAD_ID, commentId: 'c1', agentIds: [AGENT_ID] };

function comment(overrides: Partial<Comment>): Comment {
  return {
    id: 'c1',
    threadId: THREAD_ID,
    body: `\${mention|agent:${AGENT_ID}} can you shorten this headline?`,
    author: { type: 'user', id: USER_ID, name: 'Ada' },
    mentions: [{ type: 'agent', id: AGENT_ID, name: 'Pantheon Agent' }],
    createdAt: '2026-09-13T10:00:00.000Z',
    ...overrides,
  };
}

function thread(comments: Comment[]): ThreadResponse {
  return {
    thread: { id: THREAD_ID, siteId: SITE_ID, context: { type: 'block', id: 'Hero-1' }, documentId: 'doc', status: 'open' },
    comments,
  };
}

function deps(threadResponse: ThreadResponse, reply = 'Try "Ship faster".') {
  const getThread = vi.fn(async () => threadResponse);
  const postThreadComment = vi.fn(async (_s: string, _t: string, body: string) => ({
    thread: threadResponse.thread,
    comment: comment({ id: 'c-reply', body }),
  }));
  const complete = vi.fn(async (_req: CompletionRequest) => ({ content: reply, toolCalls: [] }));
  const d: MentionCommentDeps = {
    createCcrClient: () => ({ getThread, postThreadComment }),
    createModel: () => ({ complete }),
  };
  return { d, getThread, postThreadComment, complete };
}

function request(body: unknown, secret: string | null = 'shared-secret'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) headers['X-Internal-Secret'] = secret;
  return new Request('https://agent.example.com/notifications/comment', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function ctx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => { pending.push(p); } } as unknown as ExecutionContext,
    settled: () => Promise.all(pending),
  };
}

describe('handleCommentNotification', () => {
  it('refuses a request without the shared secret', async () => {
    const res = await handleCommentNotification(request(notification, 'wrong'), env, ctx().ctx);
    expect(res.status).toBe(401);
  });

  it('refuses every request when no secret is configured', async () => {
    const bare = { ...env, AGENT_NOTIFY_SECRET: undefined } as unknown as Env;
    const res = await handleCommentNotification(request(notification), bare, ctx().ctx);
    expect(res.status).toBe(401);
  });

  it('rejects a malformed payload', async () => {
    const res = await handleCommentNotification(request({ siteId: SITE_ID }), env, ctx().ctx);
    expect(res.status).toBe(400);
    const badRequester = await handleCommentNotification(request({ ...notification, requestedBy: { id: USER_ID } }), env, ctx().ctx);
    expect(badRequester.status).toBe(400);
  });

  it('acknowledges but ignores a mention of some other agent', async () => {
    const { d, getThread } = deps(thread([comment({})]));
    const c = ctx();
    const res = await handleCommentNotification(request({ ...notification, agentIds: ['someone-else'] }), env, c.ctx, d);
    await c.settled();
    expect(res.status).toBe(202);
    expect(getThread).not.toHaveBeenCalled();
  });

  it('acknowledges immediately and replies in the background', async () => {
    const { d, postThreadComment } = deps(thread([comment({})]));
    const c = ctx();
    const res = await handleCommentNotification(request(notification), env, c.ctx, d);
    expect(res.status).toBe(202);
    await c.settled();
    expect(postThreadComment).toHaveBeenCalledTimes(1);
  });
});

describe('replyToMention', () => {
  it('posts the model reply addressed to the person who asked', async () => {
    const { d, postThreadComment, complete } = deps(thread([comment({})]));
    await replyToMention(notification, env, d);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0].messages[0]?.content).toContain('@Pantheon Agent can you shorten this headline?');
    expect(postThreadComment).toHaveBeenCalledWith(SITE_ID, THREAD_ID, `\${mention|user:${USER_ID}} Try "Ship faster".`);
  });

  it('does not reply twice when the same comment is delivered again', async () => {
    const existing = [
      comment({}),
      comment({
        id: 'c2',
        body: 'Already answered.',
        author: { type: 'agent', id: AGENT_ID, name: 'Pantheon Agent' },
        mentions: [],
        createdAt: '2026-09-13T10:00:05.000Z',
      }),
    ];
    const { d, postThreadComment, complete } = deps(thread(existing));
    await replyToMention(notification, env, d);
    expect(complete).not.toHaveBeenCalled();
    expect(postThreadComment).not.toHaveBeenCalled();
  });

  it('reads and replies on behalf of the teammate who asked', async () => {
    const requestedBy = { id: USER_ID, email: 'ada@example.com', name: 'Ada' };
    const { d, postThreadComment } = deps(thread([comment({})]));
    const createCcrClient = vi.fn(d.createCcrClient!);
    await replyToMention({ ...notification, requestedBy }, env, { ...d, createCcrClient });
    expect(createCcrClient).toHaveBeenCalledWith(env, requestedBy);
    expect(postThreadComment).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the comment is no longer in the thread', async () => {
    const { d, postThreadComment } = deps(thread([]));
    await replyToMention(notification, env, d);
    expect(postThreadComment).not.toHaveBeenCalled();
  });

  it('does not post an empty reply', async () => {
    const { d, postThreadComment } = deps(thread([comment({})]), '   ');
    await replyToMention(notification, env, d);
    expect(postThreadComment).not.toHaveBeenCalled();
  });

  it('survives a failing CCR call', async () => {
    const d: MentionCommentDeps = {
      createCcrClient: () => ({
        getThread: async () => { throw new Error('boom'); },
        postThreadComment: async () => { throw new Error('unreachable'); },
      }),
    };
    await expect(replyToMention(notification, env, d)).resolves.toBeUndefined();
  });
});

describe('alreadyReplied', () => {
  it('ignores agent comments that came before the trigger', () => {
    const trigger = comment({});
    const earlier = comment({
      id: 'c0',
      author: { type: 'agent', id: AGENT_ID, name: 'Pantheon Agent' },
      createdAt: '2026-09-13T09:00:00.000Z',
    });
    expect(alreadyReplied([earlier, trigger], trigger, AGENT_ID)).toBe(false);
  });
});

describe('renderThread', () => {
  it('names the pinned block and each speaker', () => {
    const text = renderThread(thread([comment({})]), comment({}));
    expect(text).toContain('block "Hero-1"');
    expect(text).toMatch(/^Ada: /m);
  });
});
