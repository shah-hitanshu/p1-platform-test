/**
 * Resolving a thread is one request, and the thread that comes back has to reach the
 * page's listing: that listing is what the trigger and the thread header read their
 * status from, so a resolve that did not land there would read as undone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ThreadOverview } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { documentThreadsKey, overviewKey, type DocumentThreads } from '../../features/threads/document-threads.js';
import { useThreadStatus } from '../../features/threads/use-thread-status.js';

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

const resolved: ThreadOverview = {
  ...thread,
  status: 'resolved',
  resolvedAt: '2026-09-13T12:05:00Z',
  resolvedBy: { type: 'user', id: 'user-1', name: 'Nick', avatar: null },
};

const setThreadStatus = vi.fn();
const LISTING = documentThreadsKey('site-1', 'doc-1');
let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  const ctx = {
    client: { threads: { setThreadStatus } },
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
  queryClient.setQueryData<DocumentThreads>(LISTING, { [overviewKey(thread)]: thread });
  setThreadStatus.mockReset();
});

afterEach(cleanup);

describe('useThreadStatus', () => {
  it('resolves the thread and puts the resolved one in the page listing', async () => {
    setThreadStatus.mockResolvedValue(resolved);
    const { result } = renderHook(() => useThreadStatus({ threadId: 't-1' }), { wrapper });

    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.resolve?.();
    });

    expect(landed).toBe(true);
    expect(setThreadStatus).toHaveBeenCalledWith('site-1', 't-1', 'resolved');
    const listed = queryClient.getQueryData<DocumentThreads>(LISTING)?.[overviewKey(thread)];
    expect(listed?.status).toBe('resolved');
  });

  it('reopens a resolved thread', async () => {
    setThreadStatus.mockResolvedValue(thread);
    const { result } = renderHook(() => useThreadStatus({ threadId: 't-1' }), { wrapper });

    await act(async () => {
      await result.current.reopen?.();
    });

    expect(setThreadStatus).toHaveBeenCalledWith('site-1', 't-1', 'open');
  });

  it('offers neither until there is a thread to change', () => {
    const { result } = renderHook(() => useThreadStatus({}), { wrapper });

    expect(result.current.resolve).toBeUndefined();
    expect(result.current.reopen).toBeUndefined();
  });

  it('reports a change that did not land and leaves the listing alone', async () => {
    setThreadStatus.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useThreadStatus({ threadId: 't-1' }), { wrapper });

    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.resolve?.();
    });

    expect(landed).toBe(false);
    expect(result.current.failed).toBe(true);
    expect(queryClient.getQueryData<DocumentThreads>(LISTING)?.[overviewKey(thread)]?.status).toBe('open');
  });
});
