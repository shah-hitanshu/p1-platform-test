import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../../../src/env';
import { emitThreadEvent } from '../../../src/routes/threads';
import { AGENT_NOTIFICATION_HEADER, mentionedAgentIds, requesterFor } from '../../../src/routes/threads/agent-notifications';
import type { SiteMembers } from '../../../src/services/site-members-service';
import { AGENT_ID, COMMENT_ID, SITE_ID, THREAD_ID, USER_ID, makeComment, makeThread } from '../../helpers/threads';

const OTHER_AGENT_ID = '77777777-7777-4777-8777-777777777777';

const env = {
  AGENT_WORKER_URL: 'https://agent.example.com/',
  AGENT_NOTIFY_SECRET: 'shared-secret',
} as unknown as Env;

function makeCtx(): { ctx: ExecutionContext; settled: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { ctx, settled: async () => { await Promise.all(pending); } };
}

const agentMention = { type: 'agent' as const, id: AGENT_ID, name: 'Copy Editor' };
const userMention = { type: 'user' as const, id: USER_ID, name: 'Ada Lovelace' };

describe('mentionedAgentIds', () => {
  it('keeps agent mentions and drops user mentions', () => {
    const comment = makeComment({ mentions: [userMention, agentMention, agentMention] });
    expect(mentionedAgentIds(comment)).toEqual([AGENT_ID]);
  });

  it('does not tell an agent about its own comment', () => {
    const comment = makeComment({
      author: { type: 'agent', id: AGENT_ID, name: 'Copy Editor', avatar: null },
      mentions: [agentMention, { type: 'agent', id: OTHER_AGENT_ID, name: 'Other' }],
    });
    expect(mentionedAgentIds(comment)).toEqual([OTHER_AGENT_ID]);
  });
});

describe('requesterFor', () => {
  const roster = {
    members: [{ id: USER_ID, name: 'Ada Lovelace', email: 'ada@example.com', role: 'developer', avatar: null, source: 'local' }],
    agents: [],
    rosterSource: 'local',
  } as unknown as SiteMembers;

  it('names the posting user with the email the roster holds', () => {
    expect(requesterFor(makeComment(), roster)).toEqual({ id: USER_ID, email: 'ada@example.com', name: 'Ada Lovelace' });
  });

  it('has nobody to name when the poster is an agent or the roster lacks an email', () => {
    const agentAuthored = makeComment({ author: { type: 'agent', id: AGENT_ID, name: 'Copy Editor', avatar: null } });
    expect(requesterFor(agentAuthored, roster)).toBeUndefined();
    expect(requesterFor(makeComment(), null)).toBeUndefined();
    const noEmail = { ...roster, members: [{ ...roster.members[0], email: null }] } as SiteMembers;
    expect(requesterFor(makeComment(), noEmail)).toBeUndefined();
  });
});

describe('emitThreadEvent agent dispatch', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the ids and the shared secret to the agent worker off the request path', async () => {
    const { ctx, settled } = makeCtx();
    emitThreadEvent(ctx, env, {
      type: 'comment_posted',
      siteId: SITE_ID,
      thread: makeThread(),
      comment: makeComment({ mentions: [agentMention] }),
      requester: { id: USER_ID, email: 'ada@example.com', name: 'Ada Lovelace' },
    });
    await settled();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://agent.example.com/notifications/comment');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)[AGENT_NOTIFICATION_HEADER]).toBe('shared-secret');
    expect(JSON.parse(init.body as string)).toEqual({
      siteId: SITE_ID,
      threadId: THREAD_ID,
      commentId: COMMENT_ID,
      agentIds: [AGENT_ID],
      requestedBy: { id: USER_ID, email: 'ada@example.com', name: 'Ada Lovelace' },
    });
  });

  it('sends nothing when no agent is mentioned', async () => {
    const { ctx, settled } = makeCtx();
    emitThreadEvent(ctx, env, {
      type: 'comment_posted',
      siteId: SITE_ID,
      thread: makeThread(),
      comment: makeComment({ mentions: [userMention] }),
    });
    await settled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing for status changes', async () => {
    const { ctx, settled } = makeCtx();
    emitThreadEvent(ctx, env, {
      type: 'thread_status_changed',
      siteId: SITE_ID,
      thread: makeThread({ status: 'resolved' }),
      actor: { type: 'user', id: USER_ID, name: 'Ada Lovelace', avatar: null },
    });
    await settled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when the agent worker is not configured', async () => {
    const { ctx, settled } = makeCtx();
    emitThreadEvent(ctx, {} as Env, {
      type: 'comment_posted',
      siteId: SITE_ID,
      thread: makeThread(),
      comment: makeComment({ mentions: [agentMention] }),
    });
    await settled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a failed delivery', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const { ctx, settled } = makeCtx();
    emitThreadEvent(ctx, env, {
      type: 'comment_posted',
      siteId: SITE_ID,
      thread: makeThread(),
      comment: makeComment({ mentions: [agentMention] }),
    });
    await expect(settled()).resolves.toBeUndefined();
  });
});
