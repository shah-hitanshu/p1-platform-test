import { describe, it, expect, vi } from 'vitest';
import type { CompletionRequest, CompletionResult } from '../providers/transport.js';
import type { Comment, CommentContent, ThreadResponse } from '../ccr/thread-types.js';
import type { Env } from '../env.js';
import type { RawTool } from '../tools/definitions.js';
import {
  alreadyReplied,
  findBlockPath,
  handleCommentNotification,
  PROPOSE_TOOL_NAME,
  readProposal,
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
    kind: 'message',
    body: `\${mention|agent:${AGENT_ID}} can you shorten this headline?`,
    metadata: null,
    author: { type: 'user', id: USER_ID, name: 'Ada' },
    mentions: [{ type: 'agent', id: AGENT_ID, name: 'Pantheon Agent' }],
    createdAt: '2026-09-13T10:00:00.000Z',
    ...overrides,
  };
}

function thread(comments: Comment[]): ThreadResponse {
  return {
    thread: {
      id: THREAD_ID,
      siteId: SITE_ID,
      context: { type: 'block', id: 'Hero-1' },
      documentId: 'doc',
      branchId: null,
      status: 'open',
    },
    comments,
  };
}

const PAGE = {
  content: [
    { type: 'Heading', props: { id: 'Intro-1', title: 'Welcome' } },
    { type: 'Hero', props: { id: 'Hero-1', title: 'We help teams ship websites faster than ever before' } },
  ],
  root: { props: {} },
};

function proposalCall(args: unknown) {
  return { id: 'call-1', type: 'function' as const, function: { name: PROPOSE_TOOL_NAME, arguments: JSON.stringify(args) } };
}

function deps(threadResponse: ThreadResponse, result: string | CompletionResult = 'Try "Ship faster".') {
  const getThread = vi.fn(async () => threadResponse);
  const postThreadComment = vi.fn(async (_s: string, _t: string, content: string | CommentContent) => ({
    thread: threadResponse.thread,
    comment: comment({ id: 'c-reply', ...(typeof content === 'string' ? { body: content } : content) }),
  }));
  const updateThreadComment = vi.fn(async (_s: string, _t: string, id: string, content: CommentContent) => ({
    thread: threadResponse.thread,
    comment: comment({ id, ...content }),
  }));
  const listDocuments = vi.fn(async () => ({ documents: [{ id: 'doc', path: 'pages/home', createdAt: '' }] }));
  const getDocument = vi.fn(async () => ({ snapshot: PAGE }));
  const complete = vi.fn(async (_req: CompletionRequest) =>
    typeof result === 'string' ? { content: result, toolCalls: [] } : result,
  );
  const createModel = vi.fn((_env: Env, _model: string, tools: RawTool[]) => {
    void tools;
    return { complete };
  });
  const d: MentionCommentDeps = {
    createCcrClient: () => ({ getThread, postThreadComment, updateThreadComment, listDocuments, getDocument }),
    createModel,
  };
  return { d, getThread, postThreadComment, updateThreadComment, listDocuments, getDocument, complete, createModel };
}

function onBranch(response: ThreadResponse): ThreadResponse {
  return { ...response, thread: { ...response.thread, branchId: 'main' } };
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
    const { d, postThreadComment, updateThreadComment } = deps(thread([comment({})]));
    const c = ctx();
    const res = await handleCommentNotification(request(notification), env, c.ctx, d);
    expect(res.status).toBe(202);
    await c.settled();
    expect(postThreadComment).toHaveBeenCalledTimes(1);
    expect(updateThreadComment).toHaveBeenCalledTimes(1);
  });
});

describe('replyToMention', () => {
  it('posts a working line first, then turns it into the comment addressed to the person who asked', async () => {
    const { d, postThreadComment, updateThreadComment, complete } = deps(thread([comment({})]));
    await replyToMention(notification, env, d);

    expect(postThreadComment).toHaveBeenCalledWith(SITE_ID, THREAD_ID, expect.objectContaining({
      kind: 'agent_activity',
      metadata: { status: 'working' },
    }));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0].messages[0]?.content).toContain('@Pantheon Agent can you shorten this headline?');
    expect(updateThreadComment).toHaveBeenCalledWith(SITE_ID, THREAD_ID, 'c-reply', {
      kind: 'message',
      body: `\${mention|user:${USER_ID}} Try "Ship faster".`,
    });
  });

  it('offers no edit tool when the thread does not say which branch holds the page', async () => {
    const { d, createModel, listDocuments } = deps(thread([comment({})]));
    await replyToMention(notification, env, d);
    expect(listDocuments).not.toHaveBeenCalled();
    expect(createModel.mock.calls[0]?.[2]).toEqual([]);
  });

  it('shows the model the pinned block and turns its tool call into a proposal', async () => {
    const call = proposalCall({
      summary: 'Shorten the hero headline',
      note: 'Cut it to four words.',
      operations: [{ op: 'replace', path: 'content.1.props.title', value: 'Ship websites faster' }],
    });
    const { d, complete, createModel, updateThreadComment, getDocument } = deps(onBranch(thread([comment({})])), {
      content: '',
      toolCalls: [call],
    });
    await replyToMention(notification, env, d);

    expect(getDocument).toHaveBeenCalledWith(SITE_ID, 'main', 'pages/home');
    expect(createModel.mock.calls[0]?.[2]?.map((t) => t.name)).toEqual([PROPOSE_TOOL_NAME]);
    const prompt = String(complete.mock.calls[0]?.[0].messages[0]?.content);
    expect(prompt).toContain('content.1: Hero');
    expect(prompt).toContain('The pinned block at content.1:');
    expect(updateThreadComment).toHaveBeenCalledWith(SITE_ID, THREAD_ID, 'c-reply', {
      kind: 'agent_proposal',
      body: `\${mention|user:${USER_ID}} Cut it to four words.`,
      metadata: {
        status: 'proposed',
        summary: 'Shorten the hero headline',
        operations: [{ op: 'replace', path: 'content.1.props.title', value: 'Ship websites faster' }],
      },
    });
  });

  it('marks the working line failed when the model produces nothing usable', async () => {
    const { d, postThreadComment, updateThreadComment } = deps(thread([comment({})]), '   ');
    await replyToMention(notification, env, d);
    expect(postThreadComment).toHaveBeenCalledTimes(1);
    expect(updateThreadComment).toHaveBeenCalledWith(SITE_ID, THREAD_ID, 'c-reply', expect.objectContaining({
      kind: 'agent_activity',
      metadata: { status: 'failed' },
    }));
  });

  it('marks the working line failed when the model call throws', async () => {
    const { d, updateThreadComment } = deps(thread([comment({})]));
    d.createModel = () => ({ complete: async () => { throw new Error('gateway down'); } });
    await replyToMention(notification, env, d);
    expect(updateThreadComment).toHaveBeenCalledWith(SITE_ID, THREAD_ID, 'c-reply', expect.objectContaining({
      metadata: { status: 'failed' },
    }));
  });

  it('does not reply twice when the same comment is delivered again', async () => {
    const existing = [
      comment({}),
      comment({
        id: 'c2',
        kind: 'agent_activity',
        body: 'Looking into it…',
        metadata: { status: 'working' },
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

  it('survives a failing CCR call', async () => {
    const d: MentionCommentDeps = {
      createCcrClient: () => ({
        getThread: async () => { throw new Error('boom'); },
        postThreadComment: async () => { throw new Error('unreachable'); },
        updateThreadComment: async () => { throw new Error('unreachable'); },
      }),
    };
    await expect(replyToMention(notification, env, d)).resolves.toBeUndefined();
  });
});

describe('readProposal', () => {
  it('keeps only well-formed operations and ignores other tools', () => {
    const other = { id: 'x', type: 'function' as const, function: { name: 'get_document', arguments: '{}' } };
    const call = proposalCall({
      summary: ' Tidy up ',
      operations: [{ op: 'replace', path: 'content.0.props.title', value: 'Hi' }, { op: 'explode', path: 'x' }, { op: 'remove' }],
    });
    expect(readProposal([other, call])).toEqual({
      summary: 'Tidy up',
      note: undefined,
      operations: [{ op: 'replace', path: 'content.0.props.title', value: 'Hi' }],
    });
  });

  it('is null when the arguments are not a usable proposal', () => {
    expect(readProposal([])).toBeNull();
    expect(readProposal([proposalCall({ summary: 'x', operations: [] })])).toBeNull();
    expect(readProposal([{ ...proposalCall({}), function: { name: PROPOSE_TOOL_NAME, arguments: '{not json' } }])).toBeNull();
  });
});

describe('findBlockPath', () => {
  it('finds a top-level block by its id', () => {
    expect(findBlockPath(PAGE, 'Hero-1')).toBe('content.1');
    expect(findBlockPath(PAGE, 'nope')).toBeNull();
    expect(findBlockPath({}, 'Hero-1')).toBeNull();
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

  it('leaves the agent\'s own working lines out of the transcript', () => {
    const working = comment({
      id: 'c2',
      kind: 'agent_activity',
      body: 'Looking into it…',
      metadata: { status: 'working' },
      author: { type: 'agent', id: AGENT_ID, name: 'Pantheon Agent' },
    });
    expect(renderThread(thread([comment({}), working]), comment({}))).not.toContain('Looking into it');
  });
});
