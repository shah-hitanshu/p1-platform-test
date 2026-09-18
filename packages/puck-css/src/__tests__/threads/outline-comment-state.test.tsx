/**
 * The outline reads a block's comment state from the same page listing the block's
 * trigger reads, so the sidebar and the canvas can never disagree about a block.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ThreadOverview } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { setThreadsEnabled } from '../../features/threads/enabled.js';
import {
  documentThreadsKey,
  indexThreads,
} from '../../features/threads/document-threads.js';
import { applyThreadOverview } from '../../features/threads/thread-cache.js';

vi.mock('@pantheon-systems/pds-toolkit-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Icon: ({ iconName, ...props }: any) => <span data-testid={`icon-${iconName}`} {...props} />,
}));

import { OutlineCommentState } from '../../features/threads/ui/OutlineCommentState.js';

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

const ctx = {
  client: { threads: {} },
  siteId: 'site-1',
  branchId: 'branch-1',
  userId: 'user-1',
  currentDocument: { id: 'doc-1', siteId: 'site-1' },
} as unknown as P1PuckContextValue;

const KEY = documentThreadsKey('site-1', 'doc-1');
let queryClient: QueryClient;

function renderState(blockId: string) {
  return render(
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={ctx}>
        <OutlineCommentState blockId={blockId} />
      </P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setThreadsEnabled(true);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('OutlineCommentState', () => {
  it('shows nothing for a block nobody has commented on', () => {
    queryClient.setQueryData(KEY, indexThreads([overview('other')]));
    const { container } = renderState('quiet');
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the open thread as a comment icon with its count', () => {
    queryClient.setQueryData(KEY, indexThreads([overview('hero', { commentCount: 3 })]));
    renderState('hero');

    const state = screen.getByTestId('outline-comment-count');
    expect(state).toHaveAccessibleName('3 comments');
    expect(state).toHaveTextContent('3');
    expect(screen.getByTestId('icon-comment')).toBeInTheDocument();
  });

  it('shows a check once the block\'s thread is resolved', () => {
    queryClient.setQueryData(
      KEY,
      indexThreads([overview('features', { status: 'resolved', resolvedAt: '2026-09-02T00:00:00Z' })]),
    );
    renderState('features');

    expect(screen.getByTestId('outline-comments-resolved')).toHaveAccessibleName('Comments resolved');
    expect(screen.getByTestId('icon-check')).toBeInTheDocument();
    expect(screen.queryByTestId('outline-comment-count')).toBeNull();
  });

  it('follows the listing as threads change', async () => {
    queryClient.setQueryData(KEY, indexThreads([overview('hero', { commentCount: 1 })]));
    renderState('hero');
    expect(screen.getByTestId('outline-comment-count')).toHaveTextContent('1');

    applyThreadOverview(queryClient, overview('hero', { commentCount: 2 }));
    await waitFor(() => expect(screen.getByTestId('outline-comment-count')).toHaveTextContent('2'));

    applyThreadOverview(queryClient, overview('hero', { status: 'resolved' }));
    await waitFor(() => expect(screen.getByTestId('outline-comments-resolved')).toBeInTheDocument());
  });

  it('shows nothing while threads are off, whatever the listing holds', () => {
    setThreadsEnabled(false);
    queryClient.setQueryData(KEY, indexThreads([overview('hero')]));
    const { container } = renderState('hero');
    expect(container).toBeEmptyDOMElement();
  });
});
