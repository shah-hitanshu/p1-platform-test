/**
 * The thread view is the first thing a reader sees once they open a thread, so
 * what matters is that it says what is being discussed, whether that discussion is
 * over, and that nothing can be posted until there is something to post.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@pantheon-systems/pds-toolkit-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Icon: ({ iconName, ...props }: any) => <span data-testid={`icon-${iconName}`} {...props} />,
}));

import type { Comment } from '@pantheon-systems/css-client';
import { CommentThread } from '../../features/threads/ui/CommentThread.js';

function comment(id: string, createdAt: string, author: Partial<Comment['author']> = {}): Comment {
  return {
    id,
    threadId: 't-1',
    kind: 'message',
    body: 'Looks good',
    author: { type: 'user', id: 'user-1', name: 'Nick', avatar: null, ...author },
    mentions: [],
    createdAt,
    editedAt: null,
  };
}

function renderThread(props: Partial<React.ComponentProps<typeof CommentThread>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <CommentThread contextType="block" contextId="comp-1" onClose={onClose} {...props} />,
  );
  return { ...utils, onClose };
}

describe('CommentThread', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says how long ago each comment was posted and keeps that current', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-09-13T12:00:00Z'));
    renderThread({
      comments: [
        comment('c-1', '2026-09-13T11:08:00Z'),
        comment('c-2', '2026-09-13T11:59:30Z'),
      ],
    });

    const [first, second] = screen.getAllByRole('time');
    expect(first).toHaveTextContent('52m');
    expect(first).toHaveAttribute('datetime', '2026-09-13T11:08:00Z');
    expect(second).toHaveTextContent('Just now');

    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(second).toHaveTextContent('1m');
  });

  it('shows mentions as chips, with the agent marked by its icon', () => {
    const c = comment('c-1', '2026-09-13T11:00:00Z');
    c.body = '${mention|agent:a-1} shorten this for ${mention|user:u-2}';
    c.mentions = [
      { type: 'agent', id: 'a-1', name: 'Pantheon Agent' },
      { type: 'user', id: 'u-2', name: 'Marco' },
    ];
    renderThread({ comments: [c] });

    const chips = screen.getAllByTestId('comment-mention');
    expect(chips.map((el) => el.textContent)).toEqual(['@Pantheon Agent', '@Marco']);
    expect(chips[0]?.querySelector('[data-testid="icon-sparkles"]')).not.toBeNull();
    expect(chips[1]?.querySelector('[data-testid="icon-sparkles"]')).toBeNull();
  });

  it('says the thread is empty only when nothing is loading or broken', () => {
    const { rerender } = renderThread({ contextType: 'page', contextId: '/about' });
    expect(screen.getByTestId('comment-thread-empty')).toBeInTheDocument();

    rerender(<CommentThread contextType="page" contextId="/about" loading onClose={() => {}} />);
    expect(screen.queryByTestId('comment-thread-empty')).toBeNull();

    rerender(
      <CommentThread
        contextType="page"
        contextId="/about"
        comments={[comment('c-1', '2026-09-13T11:00:00Z')]}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId('comment-thread-empty')).toBeNull();
  });

  it('marks a comment an agent posted', () => {
    renderThread({
      comments: [comment('c-1', '2026-09-13T11:00:00Z', { type: 'agent', name: 'Pantheon Agent' })],
    });

    const entry = screen.getByTestId('thread-comment');
    expect(entry).toHaveTextContent('Pantheon Agent');
    expect(entry).toHaveTextContent('Agent');
    expect(screen.getByTestId('icon-sparkles')).toBeInTheDocument();
  });

  it('names the thing being discussed, with an icon for its kind', () => {
    renderThread({ subject: { label: 'Hero Banner', icon: 'grid2' } });

    expect(screen.getByTestId('comment-thread-subject')).toHaveTextContent('Hero Banner');
    expect(screen.getByRole('dialog', { name: 'Comments on Hero Banner' })).toBeInTheDocument();
    expect(screen.getByTestId('icon-grid2')).toBeInTheDocument();
  });

  // A trigger that could not resolve a name still opens a thread that says what kind
  // of thing it is about, rather than an untitled panel.
  it('falls back to naming the kind of thing when no subject is given', () => {
    renderThread({ contextType: 'page', contextId: '/about' });

    expect(screen.getByTestId('comment-thread-subject')).toHaveTextContent('Page');
    expect(screen.queryByTestId('icon-grid2')).not.toBeInTheDocument();
  });

  it('carries the context it is about', () => {
    renderThread({ contextType: 'workstream', contextId: 'ws-2', threadId: 't-3' });

    const dialog = screen.getByTestId('comment-thread');
    expect(dialog).toHaveAttribute('data-context-type', 'workstream');
    expect(dialog).toHaveAttribute('data-context-id', 'ws-2');
    expect(dialog).toHaveAttribute('data-thread-id', 't-3');
  });

  it('marks a resolved thread and only a resolved one', () => {
    const { rerender } = renderThread({ threadId: 't-1' });
    expect(screen.queryByTestId('comment-thread-resolved')).not.toBeInTheDocument();

    rerender(<CommentThread contextType="block" contextId="comp-1" threadId="t-1" resolved onClose={() => {}} />);
    expect(screen.getByTestId('comment-thread-resolved')).toHaveTextContent('Resolved');
  });

  it('closes from its header', () => {
    const { onClose } = renderThread();

    fireEvent.click(screen.getByLabelText('Close comments'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('holds a place for the comments', () => {
    renderThread();

    expect(screen.getByRole('list', { name: 'Comments' })).toBeEmptyDOMElement();
  });

  // Whitespace is not a comment: the button reads as disabled until there is something
  // to say, so a stray Enter cannot post an empty comment.
  it('only allows posting once the draft says something', () => {
    renderThread();
    const post = screen.getByRole('button', { name: 'Post' });
    const draft = screen.getByRole('textbox', { name: 'New comment' });

    expect(post).toBeDisabled();

    fireEvent.change(draft, { target: { value: '   ' } });
    expect(post).toBeDisabled();

    fireEvent.change(draft, { target: { value: 'Looks good' } });
    expect(post).toBeEnabled();
  });

  it('hands over the trimmed draft and clears it', () => {
    const onPost = vi.fn();
    renderThread({ onPost });
    const draft = screen.getByRole('textbox', { name: 'New comment' });

    fireEvent.change(draft, { target: { value: '  Ship it  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    expect(onPost).toHaveBeenCalledWith('Ship it');
    expect(draft).toHaveValue('');
  });

  it('keeps what was typed while the post was in flight', async () => {
    let land: (landed: boolean) => void = () => {};
    const onPost = vi.fn(() => new Promise<boolean>((resolve) => (land = resolve)));
    renderThread({ onPost });
    const draft = screen.getByRole('textbox', { name: 'New comment' });

    fireEvent.change(draft, { target: { value: 'First' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    fireEvent.change(draft, { target: { value: 'Second' } });
    await act(async () => land(true));

    expect(draft).toHaveValue('Second');
  });

  it('keeps Backspace and Delete from reaching the canvas document', () => {
    renderThread();
    const draft = screen.getByRole('textbox', { name: 'New comment' });
    const reachedDocument = vi.fn();
    document.addEventListener('keydown', reachedDocument);

    fireEvent.keyDown(draft, { key: 'Backspace' });
    fireEvent.keyDown(draft, { key: 'Delete' });
    fireEvent.keyDown(draft, { key: 'a' });

    document.removeEventListener('keydown', reachedDocument);
    expect(reachedDocument).toHaveBeenCalledTimes(1);
  });

  it('posts on Enter and keeps Shift+Enter for a newline', () => {
    const onPost = vi.fn();
    renderThread({ onPost });
    const draft = screen.getByRole('textbox', { name: 'New comment' });

    fireEvent.change(draft, { target: { value: 'From the keyboard' } });
    fireEvent.keyDown(draft, { key: 'Enter', shiftKey: true });
    expect(onPost).not.toHaveBeenCalled();

    fireEvent.keyDown(draft, { key: 'Enter' });
    expect(onPost).toHaveBeenCalledWith('From the keyboard');
  });
});
