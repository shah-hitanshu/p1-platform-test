/**
 * The line saying an agent never replied exists only on screen. Each one a reader is
 * shown is reported once, whatever else is drawing the same thread.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, renderHook, cleanup } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { Comment, ThreadOverview, ThreadWithComments } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { setThreadsEnabled } from '../../features/threads/enabled.js';
import { AGENT_START_MS, withPendingAgents } from '../../features/threads/pending-agent.js';
import { threadCommentsKey } from '../../features/threads/thread-comments.js';
import { useThreadComments } from '../../features/threads/use-thread-comments.js';
import {
  resetUnansweredMentionReports,
  unansweredMentions,
} from '../../features/threads/unanswered-mention.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');

const agent = { type: 'agent' as const, id: 'agent-1', name: 'P1 Agent' };

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

function ask(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    threadId: 't-1',
    kind: 'message',
    body: '${mention|agent:agent-1} tighten this',
    metadata: null,
    author: { type: 'user', id: 'user-1', name: 'Nick', avatar: null },
    mentions: [agent],
    createdAt: new Date(NOW).toISOString(),
    editedAt: null,
    ...overrides,
  };
}

/** What the hook hands the reporter: the comments as loaded, and the same list rendered. */
function asShown(comments: readonly Comment[], now: number) {
  return [comments, withPendingAgents(comments, now), now] as const;
}

/** A stand-in built by hand, for the lists `withPendingAgents` will not produce. */
function standIn(overrides: Partial<Comment> = {}): Comment {
  return ask({
    id: 'pending:c-1:agent-1',
    metadata: { status: 'failed' },
    author: { type: 'agent', id: 'agent-1', name: 'P1 Agent', avatar: null },
    mentions: [],
    ...overrides,
  });
}

describe('unansweredMentions', () => {
  it('reports nothing while the agent still has time to start', () => {
    expect(unansweredMentions(...asShown([ask()], NOW + 1_000))).toEqual([]);
  });

  it('reports the ask, the agent and the wait once the stand-in has given up', () => {
    expect(unansweredMentions(...asShown([ask()], NOW + AGENT_START_MS))).toEqual([
      { key: `pending:c-1:agent-1`, commentId: 'c-1', agentId: 'agent-1', elapsedMs: AGENT_START_MS },
    ]);
  });

  it('names the comment that did the mentioning, not the stand-in', () => {
    const [report] = unansweredMentions(...asShown([ask()], NOW + AGENT_START_MS));
    expect(report?.commentId).toBe('c-1');
    expect(report?.key).not.toBe(report?.commentId);
  });

  it('reports one per agent the ask mentioned', () => {
    const two = ask({ mentions: [agent, { type: 'agent', id: 'agent-2', name: 'Other' }] });
    expect(unansweredMentions(...asShown([two], NOW + AGENT_START_MS)).map((r) => r.agentId)).toEqual([
      'agent-1',
      'agent-2',
    ]);
  });

  it('reports nothing for a comment that mentions no agent', () => {
    const plain = ask({ mentions: [{ type: 'user', id: 'user-2', name: 'Ada' }] });
    expect(unansweredMentions(...asShown([plain], NOW + AGENT_START_MS))).toEqual([]);
    expect(unansweredMentions(...asShown([], NOW))).toEqual([]);
  });

  it('reports nothing once the turn it belongs to is long over', () => {
    expect(unansweredMentions(...asShown([ask()], NOW + 120_000))).toEqual([]);
  });

  it('reports nothing for a timestamp it cannot read', () => {
    const unreadable = ask({ createdAt: 'whenever' });
    expect(unansweredMentions([unreadable], [unreadable, standIn()], NOW)).toEqual([]);
  });

  it('finds a stand-in wherever it sits in the list', () => {
    const asked = ask();
    expect(unansweredMentions([asked], [standIn(), asked], NOW + AGENT_START_MS)).toEqual([
      { key: 'pending:c-1:agent-1', commentId: 'c-1', agentId: 'agent-1', elapsedMs: AGENT_START_MS },
    ]);
  });
});

describe('reporting from the open thread', () => {
  const getThread = vi.fn();
  const reportUnansweredMention = vi.fn();
  let queryClient: QueryClient;

  function Harness({ children }: { children: React.ReactNode }) {
    const ctx = {
      client: { threads: { getThread, postComment: vi.fn(), reportUnansweredMention } },
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetUnansweredMentionReports();
    reportUnansweredMention.mockResolvedValue(undefined);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<ThreadWithComments>(threadCommentsKey('site-1', 't-1'), {
      thread,
      comments: [ask()],
    });
    getThread.mockResolvedValue({ thread, comments: [ask()] });
    setThreadsEnabled(true);
  });

  afterEach(() => {
    cleanup();
    setThreadsEnabled(false);
    vi.useRealTimers();
  });

  function open(threadId: string | undefined, wrapper = Harness) {
    return renderHook(() => useThreadComments(threadId), { wrapper });
  }

  it('reports nothing until the stand-in gives up, then reports once', async () => {
    open('t-1');
    expect(reportUnansweredMention).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(AGENT_START_MS));

    expect(reportUnansweredMention).toHaveBeenCalledTimes(1);
    expect(reportUnansweredMention).toHaveBeenCalledWith('site-1', 't-1', {
      commentId: 'c-1',
      agentId: 'agent-1',
      elapsedMs: AGENT_START_MS,
    });
  });

  it('reports once across the polling that keeps the thread fresh', async () => {
    // Each poll has to come back different, or the cache hands back the array it already
    // had and the effect never runs a second time for the ledger to stop.
    let poll = 0;
    getThread.mockImplementation(() => {
      poll += 1;
      return Promise.resolve({ thread, comments: [ask({ editedAt: new Date(NOW + poll).toISOString() })] });
    });
    open('t-1');
    await act(() => vi.advanceTimersByTimeAsync(AGENT_START_MS + 20_000));

    expect(poll).toBeGreaterThan(1);
    expect(reportUnansweredMention).toHaveBeenCalledTimes(1);
  });

  it('reports once when the thread is open in two places at the same time', async () => {
    open('t-1');
    open('t-1');
    await act(() => vi.advanceTimersByTimeAsync(AGENT_START_MS));

    expect(reportUnansweredMention).toHaveBeenCalledTimes(1);
  });

  it('reports once when the reader closes the thread and opens it again', async () => {
    const first = open('t-1');
    await act(() => vi.advanceTimersByTimeAsync(AGENT_START_MS));
    first.unmount();
    open('t-1');
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(reportUnansweredMention).toHaveBeenCalledTimes(1);
  });

  it('reports nothing while the thread is closed', async () => {
    open(undefined);
    await act(() => vi.advanceTimersByTimeAsync(AGENT_START_MS));

    expect(reportUnansweredMention).not.toHaveBeenCalled();
  });

  it('reports nothing while threads are switched off', async () => {
    setThreadsEnabled(false);
    vi.setSystemTime(NOW + AGENT_START_MS);
    open('t-1');
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(reportUnansweredMention).not.toHaveBeenCalled();
  });

  it('still shows the thread when the report is refused', async () => {
    reportUnansweredMention.mockRejectedValue(new Error('no'));
    const { result } = open('t-1');

    await act(() => vi.advanceTimersByTimeAsync(AGENT_START_MS));

    expect(result.current.failed).toBe(false);
    expect(result.current.comments.at(-1)?.metadata).toEqual({ status: 'failed' });
  });

  it('still shows the thread when the host has an SDK that cannot report', async () => {
    const Older = ({ children }: { children: React.ReactNode }) => {
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
    };
    const { result } = open('t-1', Older);

    await act(() => vi.advanceTimersByTimeAsync(AGENT_START_MS));

    expect(result.current.comments.at(-1)?.metadata).toEqual({ status: 'failed' });
  });
});
