/**
 * The roster behind the mention picker is read straight out of the query cache, with
 * nothing observing it, so what matters is that it is still there however long a
 * thread stays open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { SiteMembers } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { setThreadsEnabled } from '../../features/threads/enabled.js';
import { useSiteMembers } from '../../features/threads/use-site-members.js';

const roster: SiteMembers = {
  members: [{ id: 'u-1', name: 'Marco Reyes', email: null, role: 'editor', avatar: null }],
  agents: [{ id: 'a-1', name: 'Pantheon Agent', role: 'editor', avatar: null, isGlobal: true }],
};

const members = vi.fn();

function Harness({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
  const ctx = { client: { sites: { members } }, siteId: 'site-1' } as unknown as P1PuckContextValue;
  return (
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={ctx}>{children}</P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>
  );
}

let queryClient: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setThreadsEnabled(true);
  members.mockReset();
  members.mockResolvedValue(roster);
});

afterEach(() => {
  cleanup();
  setThreadsEnabled(false);
  vi.useRealTimers();
});

describe('useSiteMembers', () => {
  it('still knows the roster after the cache has let go of it', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Harness queryClient={queryClient}>{children}</Harness>
    );
    const { result } = renderHook(() => useSiteMembers(true), { wrapper });

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.candidates.map((c) => c.name)).toEqual(['Pantheon Agent', 'Marco Reyes']);

    // Longer than the query client keeps an unobserved query around.
    await act(() => vi.advanceTimersByTimeAsync(6 * 60_000));

    expect(result.current.candidates.map((c) => c.name)).toEqual(['Pantheon Agent', 'Marco Reyes']);
  });
});
