/**
 * The thread hooks read the query cache directly. When something they show has
 * changed and another component then asks the cache for a new query mid-render, the
 * cache's synchronous notice must not turn into an update on them while that other
 * component is still rendering.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, useQuery } from '@tanstack/react-query';
import type { ThreadOverview } from '@pantheon-systems/css-client';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import type { P1PuckContextValue } from '../../core/types.js';
import { setThreadsEnabled } from '../../features/threads/enabled.js';
import { documentThreadsKey } from '../../features/threads/document-threads.js';
import { useThreadOverview } from '../../features/threads/use-document-threads.js';

const thread: ThreadOverview = {
  id: 't-1',
  siteId: 'site-1',
  context: { type: 'block', id: 'comp-1' },
  documentId: 'doc-1',
  status: 'open',
  commentCount: 1,
  lastCommentAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  resolvedAt: null,
  resolvedBy: null,
  branchId: null,
};

const ctx = {
  siteId: 'site-1',
  currentDocument: { id: 'doc-1', siteId: 'site-1' },
} as unknown as P1PuckContextValue;

function Reader() {
  const overview = useThreadOverview('block', 'comp-1');
  return <span data-testid="count">{overview?.commentCount ?? 0}</span>;
}

function Asker({ queryClient }: { queryClient: QueryClient }) {
  useQuery({ queryKey: ['something-else'], queryFn: async () => 'x' }, queryClient);
  return null;
}

function Page({ queryClient }: { queryClient: QueryClient }) {
  const [asking, setAsking] = useState(false);
  const changeThenAsk = () => {
    queryClient.setQueryData(documentThreadsKey('site-1', 'doc-1'), { 'block:comp-1': thread });
    setAsking(true);
  };
  return (
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={ctx}>
        <Reader />
        {asking && <Asker queryClient={queryClient} />}
        <button onClick={changeThenAsk}>go</button>
      </P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  setThreadsEnabled(false);
  vi.restoreAllMocks();
});

describe('reading the query cache', () => {
  it('is not updated while another component is still rendering its first query', async () => {
    setThreadsEnabled(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getByTestId, getByRole } = render(<Page queryClient={queryClient} />);

    fireEvent.click(getByRole('button', { name: 'go' }));

    await waitFor(() => expect(getByTestId('count')).toHaveTextContent('1'));
    const renderWarnings = errors.mock.calls.filter((call) => String(call[0]).includes('Cannot update a component'));
    expect(renderWarnings).toEqual([]);
  });
});
