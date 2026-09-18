/**
 * Every change to a thread reaches the page listing through one seam, so a
 * comment this reader posts moves the trigger's count the same way a change pushed
 * from elsewhere will. A listing that was never loaded is left alone by both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ThreadEvent, ThreadOverview } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { setThreadsEnabled } from '../../features/threads/enabled.js';
import { documentThreadsKey, type DocumentThreads } from '../../features/threads/document-threads.js';
import {
  applyThreadEvent,
  applyThreadOverview,
} from '../../features/threads/thread-cache.js';
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

import { CommentTrigger } from '../../features/threads/ui/CommentTrigger.js';

function overview(contextId: string, extra: Partial<ThreadOverview> = {}): ThreadOverview {
  return {
    id: `thread-${contextId}`,
    siteId: 'site-1',
    context: { type: 'block', id: contextId },
    documentId: 'doc-1',
    status: 'open',
    commentCount: 1,
    lastCommentAt: '2026-09-01T00:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    resolvedAt: null,
    resolvedBy: null,
    branchId: null,
    ...extra,
  };
}

const comment = {
  id: 'c-1',
  threadId: 'thread-comp-1',
  kind: 'message' as const,
  body: 'hi',
  metadata: null,
  author: { type: 'user' as const, id: 'user-1', name: 'Nick', avatar: null },
  mentions: [],
  createdAt: '2026-09-01T00:00:00Z',
  editedAt: null,
};

const listThreads = vi.fn();
const postThread = vi.fn();
const postComment = vi.fn();

function makeCtx(): P1PuckContextValue {
  return {
    client: { threads: { listThreads, postThread, postComment } },
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument: { id: 'doc-1', siteId: 'site-1' },
  } as unknown as P1PuckContextValue;
}

function Harness({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
  return (
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={makeCtx()}>{children}</P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>
  );
}

const KEY = documentThreadsKey('site-1', 'doc-1');
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setThreadsEnabled(true);
  listThreads.mockReset();
  postThread.mockReset();
  postComment.mockReset();
});

afterEach(() => {
  cleanup();
  setThreadsEnabled(false);
});

describe('applyThreadOverview', () => {
  it('replaces the thread on its context in the loaded listing', () => {
    queryClient.setQueryData<DocumentThreads>(KEY, { 'block:comp-1': overview('comp-1') });

    const applied = applyThreadOverview(queryClient, overview('comp-1', { commentCount: 5 }));

    expect(applied).toBe(true);
    expect(queryClient.getQueryData<DocumentThreads>(KEY)?.['block:comp-1']?.commentCount).toBe(5);
  });

  it('adds a thread on a context the listing did not have yet', () => {
    queryClient.setQueryData<DocumentThreads>(KEY, {});

    applyThreadOverview(queryClient, overview('comp-9'));

    expect(Object.keys(queryClient.getQueryData<DocumentThreads>(KEY) ?? {})).toEqual(['block:comp-9']);
  });

  it('leaves a listing that was never loaded alone', () => {
    const applied = applyThreadOverview(queryClient, overview('comp-1'));

    expect(applied).toBe(false);
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it('has nowhere to put a thread that is not on a page', () => {
    queryClient.setQueryData<DocumentThreads>(KEY, {});

    const applied = applyThreadOverview(
      queryClient,
      overview('site-1', { context: { type: 'site', id: 'site-1' }, documentId: null }),
    );

    expect(applied).toBe(false);
  });
});

describe('applyThreadEvent', () => {
  it('folds a posted comment and a status change into the listing', () => {
    queryClient.setQueryData<DocumentThreads>(KEY, { 'block:comp-1': overview('comp-1') });

    const posted: ThreadEvent = {
      type: 'comment_posted',
      siteId: 'site-1',
      thread: overview('comp-1', { commentCount: 2 }),
      comment,
    };
    const resolved: ThreadEvent = {
      type: 'thread_status_changed',
      siteId: 'site-1',
      thread: overview('comp-1', { commentCount: 2, status: 'resolved' }),
      actor: comment.author,
    };

    expect(applyThreadEvent(queryClient, posted)).toBe(true);
    expect(queryClient.getQueryData<DocumentThreads>(KEY)?.['block:comp-1']?.commentCount).toBe(2);

    expect(applyThreadEvent(queryClient, resolved)).toBe(true);
    expect(queryClient.getQueryData<DocumentThreads>(KEY)?.['block:comp-1']?.status).toBe('resolved');
  });
});

function draftAndPost(body: string) {
  fireEvent.click(screen.getByTestId('comment-trigger'));
  fireEvent.change(screen.getByRole('textbox', { name: 'New comment' }), { target: { value: body } });
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
}

describe('posting from the trigger', () => {
  it('starts a thread on a block with none, and the count appears', async () => {
    listThreads.mockResolvedValue({ threads: [], nextCursor: null });
    postThread.mockResolvedValue({ thread: overview('comp-1', { commentCount: 1 }), comment });

    render(
      <Harness queryClient={queryClient}>
        <DocumentThreadsLoader />
        <CommentTrigger contextType="block" contextId="comp-1" />
      </Harness>,
    );
    await waitFor(() => expect(listThreads).toHaveBeenCalled());
    await waitFor(() => expect(queryClient.getQueryData(KEY)).toBeDefined());

    draftAndPost('First!');

    await waitFor(() => expect(postThread).toHaveBeenCalledTimes(1));
    expect(postThread).toHaveBeenCalledWith('site-1', {
      context: { type: 'block', id: 'comp-1' },
      documentId: 'doc-1',
      branchId: 'branch-1',
      body: 'First!',
    });
    await waitFor(() =>
      expect(queryClient.getQueryData<DocumentThreads>(KEY)?.['block:comp-1']?.commentCount).toBe(1),
    );
    expect(postComment).not.toHaveBeenCalled();
  });

  it('adds to the thread a block already has', async () => {
    listThreads.mockResolvedValue({ threads: [overview('comp-1', { commentCount: 1 })], nextCursor: null });
    postComment.mockResolvedValue({ thread: overview('comp-1', { commentCount: 2 }), comment });

    render(
      <Harness queryClient={queryClient}>
        <DocumentThreadsLoader />
        <CommentTrigger contextType="block" contextId="comp-1" threadId="thread-comp-1" commentCount={1} />
      </Harness>,
    );
    await waitFor(() => expect(queryClient.getQueryData(KEY)).toBeDefined());

    draftAndPost('Second');

    await waitFor(() => expect(postComment).toHaveBeenCalledWith('site-1', 'thread-comp-1', 'Second'));
    await waitFor(() =>
      expect(queryClient.getQueryData<DocumentThreads>(KEY)?.['block:comp-1']?.commentCount).toBe(2),
    );
    expect(postThread).not.toHaveBeenCalled();
  });

  it('still opens, with nothing to post through, outside the editor', () => {
    render(<CommentTrigger contextType="block" contextId="comp-1" />);

    draftAndPost('Into the void');

    expect(postThread).not.toHaveBeenCalled();
    expect(postComment).not.toHaveBeenCalled();
  });
});
