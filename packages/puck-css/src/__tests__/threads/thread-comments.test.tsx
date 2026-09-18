/**
 * Opening a thread is what asks for its comments, so what matters is that nothing is
 * asked for until then, that what comes back reads in the order it was said, and that a
 * comment posted from the thread joins the list without a second request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, renderHook, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { Comment, ThreadEvent, ThreadOverview, ThreadWithComments } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { setThreadsEnabled } from '../../features/threads/enabled.js';
import { setOpenThread } from '../../features/threads/open-thread.js';
import { applyThreadEvent } from '../../features/threads/thread-cache.js';
import {
  appendThreadComment,
  insertComment,
  threadCommentsKey,
} from '../../features/threads/thread-comments.js';
import { useThreadComments } from '../../features/threads/use-thread-comments.js';

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

const thread: ThreadOverview = {
  id: 't-1',
  siteId: 'site-1',
  context: { type: 'block', id: 'comp-1' },
  documentId: 'doc-1',
  status: 'open',
  commentCount: 2,
  lastCommentAt: '2026-09-01T00:02:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:02:00Z',
  resolvedAt: null,
  resolvedBy: null,
  branchId: null,
};

function comment(id: string, body: string, minute: number, extra: Partial<Comment> = {}): Comment {
  return {
    id,
    threadId: 't-1',
    kind: 'message',
    body,
    metadata: null,
    author: { type: 'user', id: 'user-1', name: 'Nick', avatar: null },
    mentions: [],
    createdAt: `2026-09-01T00:0${minute}:00Z`,
    editedAt: null,
    ...extra,
  };
}

const first = comment('c-1', 'First', 1);
const second = comment('c-2', 'Second', 2);

const getThread = vi.fn();
const postComment = vi.fn();

function makeCtx(): P1PuckContextValue {
  return {
    client: { threads: { getThread, postComment } },
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

const KEY = threadCommentsKey('site-1', 't-1');
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setThreadsEnabled(true);
  getThread.mockReset();
  postComment.mockReset();
});

afterEach(() => {
  cleanup();
  setOpenThread(null);
  setThreadsEnabled(false);
});

function bodies(): string[] {
  return screen.getAllByTestId('thread-comment').map((li) => li.querySelector('p')?.textContent ?? '');
}

describe('insertComment', () => {
  it('slots a comment in by when it was said and says nothing twice', () => {
    const between = comment('c-1.5', 'Between', 1, { createdAt: '2026-09-01T00:01:30Z' });

    const inserted = insertComment([first, second], between);

    expect(inserted.map((c) => c.id)).toEqual(['c-1', 'c-1.5', 'c-2']);
    expect(insertComment(inserted, between)).toBe(inserted);
  });
});

describe('appendThreadComment', () => {
  it('leaves a thread nobody has opened alone', () => {
    expect(appendThreadComment(queryClient, 'site-1', first)).toBe(false);
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it('adds a comment pushed from elsewhere to the open thread', () => {
    queryClient.setQueryData<ThreadWithComments>(KEY, { thread, comments: [first] });
    const event: ThreadEvent = { type: 'comment_posted', siteId: 'site-1', thread, comment: second };

    expect(applyThreadEvent(queryClient, event)).toBe(true);

    expect(queryClient.getQueryData<ThreadWithComments>(KEY)?.comments.map((c) => c.id)).toEqual(['c-1', 'c-2']);
  });
});

describe('opening a thread', () => {
  it('listens to nothing until there is a thread to show', () => {
    const subscribe = vi.spyOn(queryClient.getQueryCache(), 'subscribe');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Harness queryClient={queryClient}>{children}</Harness>
    );

    const { rerender } = renderHook(({ threadId }: { threadId?: string }) => useThreadComments(threadId), {
      wrapper,
      initialProps: {},
    });
    expect(subscribe).not.toHaveBeenCalled();

    rerender({ threadId: 't-1' });
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing on a context with no thread', () => {
    render(
      <Harness queryClient={queryClient}>
        <CommentTrigger contextType="block" contextId="comp-1" />
      </Harness>,
    );

    fireEvent.click(screen.getByTestId('comment-trigger'));

    expect(screen.getByRole('list', { name: 'Comments' })).toBeEmptyDOMElement();
    expect(screen.queryByTestId('comment-thread-loading')).not.toBeInTheDocument();
    expect(getThread).not.toHaveBeenCalled();
  });

  it('loads the comments once opened and reads them oldest first', async () => {
    getThread.mockResolvedValue({ thread, comments: [first, second] });

    render(
      <Harness queryClient={queryClient}>
        <CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={2} />
      </Harness>,
    );
    expect(getThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('comment-trigger'));
    expect(screen.getByTestId('comment-thread-loading')).toBeInTheDocument();

    await waitFor(() => expect(bodies()).toEqual(['First', 'Second']));
    expect(getThread).toHaveBeenCalledWith('site-1', 't-1');
    expect(screen.queryByTestId('comment-thread-loading')).not.toBeInTheDocument();
    expect(screen.getAllByText('Nick')).toHaveLength(2);
  });

  it('shows a mention as the member it names', async () => {
    getThread.mockResolvedValue({
      thread,
      comments: [
        comment('c-3', 'Ping ${mention|user:u-2} and ${mention|user:u-gone}', 3, {
          mentions: [
            { type: 'user', id: 'u-2', name: 'Sam' },
            { type: 'user', id: 'u-gone', name: null },
          ],
        }),
      ],
    });

    render(
      <Harness queryClient={queryClient}>
        <CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={1} />
      </Harness>,
    );
    fireEvent.click(screen.getByTestId('comment-trigger'));

    await waitFor(() => expect(bodies()).toEqual(['Ping @Sam and @former member']));
  });

  it('shows a thread reopened straight away from memory', async () => {
    getThread.mockResolvedValue({ thread, comments: [first] });

    render(
      <Harness queryClient={queryClient}>
        <CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={1} />
      </Harness>,
    );
    const trigger = screen.getByTestId('comment-trigger');
    fireEvent.click(trigger);
    await waitFor(() => expect(bodies()).toEqual(['First']));

    fireEvent.click(screen.getByLabelText('Close comments'));
    fireEvent.click(trigger);

    expect(bodies()).toEqual(['First']);
    expect(screen.queryByTestId('comment-thread-loading')).not.toBeInTheDocument();
    expect(getThread).toHaveBeenCalledTimes(1);
  });

  it('says when the comments could not be loaded and offers to try again', async () => {
    getThread.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ thread, comments: [first] });

    render(
      <Harness queryClient={queryClient}>
        <CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={1} />
      </Harness>,
    );
    fireEvent.click(screen.getByTestId('comment-trigger'));

    await waitFor(() => expect(screen.getByTestId('comment-thread-failed')).toBeInTheDocument());
    expect(screen.getByRole('list', { name: 'Comments' })).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(bodies()).toEqual(['First']));
    expect(screen.queryByTestId('comment-thread-failed')).not.toBeInTheDocument();
    expect(getThread).toHaveBeenCalledTimes(2);
  });

  it('still opens, with nothing to load through, outside the editor', () => {
    render(<CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={1} />);

    fireEvent.click(screen.getByTestId('comment-trigger'));

    expect(screen.getByRole('list', { name: 'Comments' })).toBeEmptyDOMElement();
    expect(screen.queryByTestId('comment-thread-loading')).not.toBeInTheDocument();
    expect(getThread).not.toHaveBeenCalled();
  });
});

describe('posting into an open thread', () => {
  function draftAndPost(body: string) {
    fireEvent.change(screen.getByRole('textbox', { name: 'New comment' }), { target: { value: body } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  }

  it('adds the posted comment to the list without asking again', async () => {
    getThread.mockResolvedValue({ thread, comments: [first] });
    postComment.mockResolvedValue({ thread: { ...thread, commentCount: 2 }, comment: second });

    render(
      <Harness queryClient={queryClient}>
        <CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={1} />
      </Harness>,
    );
    fireEvent.click(screen.getByTestId('comment-trigger'));
    await waitFor(() => expect(bodies()).toEqual(['First']));

    draftAndPost('Second');

    await waitFor(() => expect(bodies()).toEqual(['First', 'Second']));
    expect(screen.getByRole('textbox', { name: 'New comment' })).toHaveValue('');
    expect(getThread).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft and says so when the post did not land', async () => {
    getThread.mockResolvedValue({ thread, comments: [first] });
    postComment.mockRejectedValue(new Error('offline'));

    render(
      <Harness queryClient={queryClient}>
        <CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={1} />
      </Harness>,
    );
    fireEvent.click(screen.getByTestId('comment-trigger'));
    await waitFor(() => expect(bodies()).toEqual(['First']));

    draftAndPost('Lost?');

    await waitFor(() => expect(screen.getByTestId('comment-thread-post-failed')).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'New comment' })).toHaveValue('Lost?');
    expect(bodies()).toEqual(['First']);
  });
});
