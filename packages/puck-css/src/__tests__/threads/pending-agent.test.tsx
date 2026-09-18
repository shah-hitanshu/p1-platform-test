/**
 * Asking an agent for something should feel answered at once: the thread shows the agent
 * working before the agent has said so, and admits it did not start if the real working
 * line never arrives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { Comment, ThreadOverview, ThreadWithComments } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { setThreadsEnabled } from '../../features/threads/enabled.js';
import { setOpenThread } from '../../features/threads/open-thread.js';
import { AGENT_START_MS, withPendingAgents } from '../../features/threads/pending-agent.js';
import { appendThreadComment, threadCommentsKey } from '../../features/threads/thread-comments.js';

vi.mock('@pantheon-systems/pds-toolkit-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Icon: ({ iconName, ...props }: any) => <span data-testid={`icon-${iconName}`} {...props} />,
  Tally: ({ label, ...props }: any) => <span {...props}>{label}</span>,
}));

import { CommentTrigger } from '../../features/threads/ui/CommentTrigger.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');

const thread: ThreadOverview = {
  id: 't-1',
  siteId: 'site-1',
  context: { type: 'block', id: 'comp-1' },
  documentId: 'doc-1',
  status: 'open',
  commentCount: 1,
  lastCommentAt: new Date(NOW).toISOString(),
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  resolvedAt: null,
  resolvedBy: null,
  branchId: null,
};

const agent = { type: 'agent' as const, id: 'agent-1', name: 'P1 Agent' };

const ask: Comment = {
  id: 'c-1',
  threadId: 't-1',
  kind: 'message',
  body: '${mention|agent:agent-1} tighten this',
  metadata: null,
  author: { type: 'user', id: 'user-1', name: 'Nick', avatar: null },
  mentions: [agent],
  createdAt: new Date(NOW).toISOString(),
  editedAt: null,
};

const working: Comment = {
  id: 'a-1',
  threadId: 't-1',
  kind: 'agent_activity',
  body: '',
  metadata: { status: 'working' },
  author: { type: 'agent', id: 'agent-1', name: 'P1 Agent', avatar: null, requestedBy: { id: 'user-1', name: 'Nick' } },
  mentions: [],
  createdAt: new Date(NOW + 1_000).toISOString(),
  editedAt: null,
};

describe('withPendingAgents', () => {
  it('shows a mentioned agent working until it has had long enough to start', () => {
    const [, standIn] = withPendingAgents([ask], NOW + 1_000);
    expect(standIn?.kind).toBe('agent_activity');
    expect(standIn?.metadata).toEqual({ status: 'working' });
    expect(standIn?.author).toMatchObject({ type: 'agent', id: 'agent-1', name: 'P1 Agent', requestedBy: { id: 'user-1' } });

    const [, late] = withPendingAgents([ask], NOW + AGENT_START_MS);
    expect(late?.metadata).toEqual({ status: 'failed' });
  });

  it('stands aside once the agent has spoken', () => {
    expect(withPendingAgents([ask, working], NOW + 1_000)).toEqual([ask, working]);
  });

  it('adds nothing to a comment that mentions no agent', () => {
    const plain = { ...ask, mentions: [{ type: 'user' as const, id: 'user-2', name: 'Ada' }] };
    expect(withPendingAgents([plain], NOW)).toEqual([plain]);
    expect(withPendingAgents([], NOW)).toEqual([]);
  });
});

describe('in the open thread', () => {
  const getThread = vi.fn();
  let queryClient: QueryClient;

  function Harness({ children }: { children: React.ReactNode }) {
    const ctx = {
      client: { threads: { getThread, postComment: vi.fn() } },
      siteId: 'site-1',
      branchId: 'branch-1',
      userId: 'user-1',
      currentDocument: { id: 'doc-1', siteId: 'site-1' },
    } as unknown as P1PuckContextValue;
    return (
      <P1SdkQueryClientContext.Provider value={queryClient}>
        <P1PuckContext.Provider value={ctx}>{children}</P1PuckContext.Provider>
      </P1SdkQueryClientContext.Provider>
    );
  }

  function activity(): HTMLElement | null {
    return screen.queryByTestId('agent-activity');
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<ThreadWithComments>(threadCommentsKey('site-1', 't-1'), { thread, comments: [ask] });
    getThread.mockResolvedValue({ thread, comments: [ask] });
    setThreadsEnabled(true);
  });

  afterEach(() => {
    cleanup();
    setOpenThread(null);
    setThreadsEnabled(false);
    vi.useRealTimers();
  });

  function open() {
    render(
      <Harness>
        <CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={1} />
      </Harness>,
    );
    act(() => {
      screen.getByTestId('comment-trigger').click();
    });
  }

  it('shows the agent working at once and gives up when it never starts', async () => {
    open();
    expect(activity()).toHaveAttribute('data-status', 'working');
    expect(activity()).toHaveTextContent('Working for Nick');

    await act(() => vi.advanceTimersByTimeAsync(AGENT_START_MS));

    expect(activity()).toHaveAttribute('data-status', 'failed');
    expect(activity()).toHaveTextContent('P1 Agent did not respond.');
  });

  it("hands over to the agent's own working line when it arrives", async () => {
    open();
    await act(() => vi.advanceTimersByTimeAsync(1_000));

    getThread.mockResolvedValue({ thread, comments: [ask, working] });
    await act(async () => {
      appendThreadComment(queryClient, 'site-1', working);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getAllByTestId('agent-activity')).toHaveLength(1);
    expect(activity()?.closest('li')).toHaveAttribute('data-comment-id', 'a-1');
    await act(() => vi.advanceTimersByTimeAsync(AGENT_START_MS));
    expect(activity()).toHaveAttribute('data-status', 'working');
  });
});
