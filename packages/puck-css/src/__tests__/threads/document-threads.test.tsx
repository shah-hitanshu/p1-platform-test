/**
 * A page's threads are asked for once, as the editor opens, and every block trigger
 * reads its own from that one answer. The listing follows the cursor until the site
 * has nothing more to say, and is not asked for at all until threads are on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ThreadOverview } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { setThreadsEnabled } from '../../features/threads/enabled.js';
import {
  useDocumentThreads,
  useThreadOverview,
} from '../../features/threads/use-document-threads.js';
import { DocumentThreadsLoader } from '../../features/threads/ui/DocumentThreadsLoader.js';

vi.mock('@pantheon-systems/pds-toolkit-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Icon: ({ iconName, ...props }: any) => <span data-testid={`icon-${iconName}`} {...props} />,
  Tally: ({ label, ...props }: any) => (
    <span data-testid="tally" {...props}>
      {label}
    </span>
  ),
}));

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => (selector: (s: any) => unknown) =>
    selector({
      config: { components: { HeadingBlock: { label: 'Heading' } } },
      getItemById: () => ({ type: 'HeadingBlock' }),
    }),
}));

import { BlockCommentTrigger } from '../../features/threads/ui/BlockCommentTrigger.js';

function overview(contextId: string, extra: Partial<ThreadOverview> = {}): ThreadOverview {
  return {
    id: `thread-${contextId}`,
    siteId: 'site-1',
    context: { type: 'block', id: contextId },
    documentId: 'doc-1',
    status: 'open',
    commentCount: 2,
    lastCommentAt: '2026-09-01T00:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    resolvedAt: null,
    resolvedBy: null,
    ...extra,
  };
}

const listThreads = vi.fn();

function makeCtx(over: Partial<{ branchId: string; documentId: string | null }> = {}) {
  return {
    client: { threads: { listThreads } },
    siteId: 'site-1',
    branchId: over.branchId ?? 'branch-1',
    userId: 'user-1',
    currentDocument:
      over.documentId === null ? null : { id: over.documentId ?? 'doc-1', siteId: 'site-1' },
  } as unknown as P1PuckContextValue;
}

function Harness({
  ctx,
  queryClient,
  children,
}: {
  ctx: P1PuckContextValue;
  queryClient: QueryClient;
  children: React.ReactNode;
}) {
  return (
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={ctx}>{children}</P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>
  );
}

function Probe(): React.ReactElement {
  const { threads, loaded, failed } = useDocumentThreads();
  return (
    <div
      data-testid="probe"
      data-loaded={String(loaded)}
      data-failed={String(failed)}
      data-keys={Object.keys(threads).sort().join(',')}
    />
  );
}

function OverviewProbe({ blockId }: { blockId: string }): React.ReactElement {
  const thread = useThreadOverview('block', blockId);
  return <div data-testid={`overview-${blockId}`}>{thread ? thread.commentCount : 'none'}</div>;
}

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setThreadsEnabled(true);
  listThreads.mockReset();
});

afterEach(() => {
  cleanup();
  setThreadsEnabled(false);
});

describe('useDocumentThreads', () => {
  it('indexes the page\'s threads by context and follows the cursor to the end', async () => {
    listThreads
      .mockResolvedValueOnce({ threads: [overview('comp-1')], nextCursor: 'more' })
      .mockResolvedValueOnce({ threads: [overview('comp-2')], nextCursor: null });

    render(
      <Harness ctx={makeCtx()} queryClient={queryClient}>
        <Probe />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('probe').dataset.loaded).toBe('true'));

    expect(screen.getByTestId('probe').dataset.keys).toBe('block:comp-1,block:comp-2');
    expect(listThreads).toHaveBeenCalledTimes(2);
    expect(listThreads).toHaveBeenNthCalledWith(1, 'site-1', {
      documentId: 'doc-1',
      limit: 500,
      cursor: undefined,
    });
    expect(listThreads).toHaveBeenNthCalledWith(2, 'site-1', {
      documentId: 'doc-1',
      limit: 500,
      cursor: 'more',
    });
  });

  it('asks for nothing while threads are off', () => {
    setThreadsEnabled(false);

    render(
      <Harness ctx={makeCtx()} queryClient={queryClient}>
        <Probe />
      </Harness>
    );

    expect(listThreads).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').dataset.loaded).toBe('false');
  });

  it('asks for nothing until a document is open', () => {
    render(
      <Harness ctx={makeCtx({ documentId: null })} queryClient={queryClient}>
        <Probe />
      </Harness>
    );

    expect(listThreads).not.toHaveBeenCalled();
  });

  it('reports a listing it could not read as failed, not empty', async () => {
    listThreads.mockRejectedValueOnce(new Error('nope'));

    render(
      <Harness ctx={makeCtx()} queryClient={queryClient}>
        <Probe />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('probe').dataset.loaded).toBe('true'));
    expect(screen.getByTestId('probe').dataset.failed).toBe('true');
    expect(screen.getByTestId('probe').dataset.keys).toBe('');
  });

  it('asks again for the same page when the branch changes', async () => {
    listThreads.mockResolvedValue({ threads: [overview('comp-1')], nextCursor: null });

    const { rerender } = render(
      <Harness ctx={makeCtx({ branchId: 'branch-1' })} queryClient={queryClient}>
        <Probe />
      </Harness>
    );
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(1));

    rerender(
      <Harness ctx={makeCtx({ branchId: 'branch-2' })} queryClient={queryClient}>
        <Probe />
      </Harness>
    );

    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
  });
});

describe('useThreadOverview', () => {
  it('hands each block the thread the loader fetched for it', async () => {
    listThreads.mockResolvedValueOnce({
      threads: [overview('comp-1', { commentCount: 4 })],
      nextCursor: null,
    });

    render(
      <Harness ctx={makeCtx()} queryClient={queryClient}>
        <DocumentThreadsLoader />
        <OverviewProbe blockId="comp-1" />
        <OverviewProbe blockId="comp-2" />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('overview-comp-1').textContent).toBe('4'));
    expect(screen.getByTestId('overview-comp-2').textContent).toBe('none');
  });

  it('answers none, without throwing, when rendered outside the editor', () => {
    render(<OverviewProbe blockId="comp-1" />);

    expect(screen.getByTestId('overview-comp-1').textContent).toBe('none');
  });

  it('answers none while threads are off, whatever the cache holds', async () => {
    listThreads.mockResolvedValueOnce({
      threads: [overview('comp-1', { commentCount: 4 })],
      nextCursor: null,
    });

    render(
      <Harness ctx={makeCtx()} queryClient={queryClient}>
        <DocumentThreadsLoader />
        <OverviewProbe blockId="comp-1" />
      </Harness>
    );
    await waitFor(() => expect(screen.getByTestId('overview-comp-1').textContent).toBe('4'));

    act(() => setThreadsEnabled(false));

    expect(screen.getByTestId('overview-comp-1').textContent).toBe('none');
  });
});

describe('DocumentThreadsLoader', () => {
  it('starts loading as soon as threads turn on', async () => {
    setThreadsEnabled(false);
    listThreads.mockResolvedValue({ threads: [], nextCursor: null });

    render(
      <Harness ctx={makeCtx()} queryClient={queryClient}>
        <DocumentThreadsLoader />
      </Harness>
    );
    expect(listThreads).not.toHaveBeenCalled();

    act(() => setThreadsEnabled(true));

    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(1));
  });

  it('renders nothing where there is no editor to load for', () => {
    const { container } = render(<DocumentThreadsLoader />);

    expect(container).toBeEmptyDOMElement();
    expect(listThreads).not.toHaveBeenCalled();
  });
});

describe('BlockCommentTrigger', () => {
  it('shows the block\'s comment count and whether its thread is resolved', async () => {
    listThreads.mockResolvedValueOnce({
      threads: [overview('comp-1', { commentCount: 3, status: 'resolved' })],
      nextCursor: null,
    });

    render(
      <Harness ctx={makeCtx()} queryClient={queryClient}>
        <DocumentThreadsLoader />
        <BlockCommentTrigger blockId="comp-1" />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('tally').textContent).toBe('3'));

    fireEvent.click(screen.getByTestId('comment-trigger'));

    expect(screen.getByTestId('comment-thread')).toHaveAttribute('data-thread-id', 'thread-comp-1');
    expect(screen.getByTestId('comment-thread-resolved')).toBeInTheDocument();
  });
});
