/**
 * Accepting or dismissing a proposal is one request to the service, which puts an
 * accepted proposal's edits into the page itself. What matters here is that the
 * decision is sent, that the rewritten comment replaces the proposal in the open thread
 * rather than sitting beside it, and that a decision that did not land is reported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { AgentProposalComment, ThreadEvent, ThreadOverview, ThreadWithComments } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { applyThreadEvent } from '../../features/threads/thread-cache.js';
import { threadCommentsKey } from '../../features/threads/thread-comments.js';
import { useProposalDecision } from '../../features/threads/use-proposal-decision.js';
import { awaitingAgent } from '../../features/threads/use-thread-comments.js';

const thread: ThreadOverview = {
  id: 't-1',
  siteId: 'site-1',
  context: { type: 'block', id: 'comp-1' },
  documentId: 'doc-1',
  branchId: null,
  status: 'open',
  commentCount: 2,
  lastCommentAt: '2026-09-13T12:00:00Z',
  createdAt: '2026-09-13T12:00:00Z',
  updatedAt: '2026-09-13T12:00:00Z',
  resolvedAt: null,
  resolvedBy: null,
};

const agent = { type: 'agent' as const, id: 'agent-1', name: 'P1 Agent', avatar: null };

const proposal: AgentProposalComment = {
  id: 'a-1',
  threadId: 't-1',
  kind: 'agent_proposal',
  body: 'Here you go.',
  metadata: {
    status: 'proposed',
    summary: 'Shorten the heading',
    operations: [{ op: 'replace', path: 'content.0.props.text', value: 'Welcome' }],
  },
  author: agent,
  mentions: [],
  createdAt: '2026-09-13T12:00:00Z',
  editedAt: null,
};

const decideProposal = vi.fn();
const KEY = threadCommentsKey('site-1', 't-1');
let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  const ctx = {
    client: { threads: { decideProposal } },
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
  } as unknown as P1PuckContextValue;
  return (
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={ctx}>{children}</P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<ThreadWithComments>(KEY, { thread, comments: [proposal] });
  decideProposal.mockReset();
});

afterEach(cleanup);

describe('useProposalDecision', () => {
  it('records the acceptance and replaces the comment in the thread', async () => {
    const decided = { ...proposal, metadata: { ...proposal.metadata, status: 'accepted' as const } };
    decideProposal.mockResolvedValue({ thread, comment: decided });
    const { result } = renderHook(() => useProposalDecision({ threadId: 't-1' }), { wrapper });

    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.accept?.(proposal);
    });

    expect(landed).toBe(true);
    expect(decideProposal).toHaveBeenCalledWith('site-1', 't-1', 'a-1', 'accepted');
    const comments = queryClient.getQueryData<ThreadWithComments>(KEY)?.comments ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0]?.metadata).toMatchObject({ status: 'accepted' });
  });

  it('records a dismissal', async () => {
    decideProposal.mockResolvedValue({ thread, comment: proposal });
    const { result } = renderHook(() => useProposalDecision({ threadId: 't-1' }), { wrapper });

    await act(async () => {
      await result.current.dismiss?.(proposal);
    });

    expect(decideProposal).toHaveBeenCalledWith('site-1', 't-1', 'a-1', 'dismissed');
  });

  it('offers neither decision until the thread is known', () => {
    const { result } = renderHook(() => useProposalDecision({}), { wrapper });
    expect(result.current.accept).toBeUndefined();
    expect(result.current.dismiss).toBeUndefined();
  });

  it('reports a decision that did not land', async () => {
    decideProposal.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useProposalDecision({ threadId: 't-1' }), { wrapper });

    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.dismiss?.(proposal);
    });

    expect(landed).toBe(false);
    expect(result.current.failed).toBe('a-1');
  });
});

describe('a rewritten comment arriving as an event', () => {
  it('replaces the comment in the open thread instead of adding another', () => {
    const decided = { ...proposal, metadata: { ...proposal.metadata, status: 'dismissed' as const } };
    const event: ThreadEvent = { type: 'comment_updated', siteId: 'site-1', thread, comment: decided };

    expect(applyThreadEvent(queryClient, event)).toBe(true);

    const comments = queryClient.getQueryData<ThreadWithComments>(KEY)?.comments ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0]?.metadata).toMatchObject({ status: 'dismissed' });
  });
});

describe('awaitingAgent', () => {
  const now = Date.parse('2026-09-13T12:00:30Z');
  const person = { type: 'user' as const, id: 'user-1', name: 'Nick', avatar: null };
  const ask = {
    ...proposal,
    id: 'c-1',
    kind: 'message' as const,
    metadata: null,
    author: person,
    mentions: [{ type: 'agent' as const, id: 'agent-1', name: 'P1 Agent' }],
  };

  it('holds while an agent says it is working', () => {
    const working = { ...proposal, kind: 'agent_activity' as const, metadata: { status: 'working' as const } };
    expect(awaitingAgent([ask, working], now)).toBe(true);
  });

  it('gives up on a working line that has stood for too long', () => {
    const working = { ...proposal, kind: 'agent_activity' as const, metadata: { status: 'working' as const } };
    expect(awaitingAgent([ask, working], now + 2 * 60_000)).toBe(true);
    expect(awaitingAgent([ask, working], now + 10 * 60_000)).toBe(false);
  });

  it('holds for a while after an agent is mentioned and has not answered', () => {
    expect(awaitingAgent([ask], now)).toBe(true);
    expect(awaitingAgent([ask], now + 5 * 60_000)).toBe(false);
  });

  it('stands down once the agent has answered', () => {
    expect(awaitingAgent([ask, proposal], now)).toBe(false);
    expect(awaitingAgent([ask, { ...ask, mentions: [] }], now)).toBe(false);
  });
});
