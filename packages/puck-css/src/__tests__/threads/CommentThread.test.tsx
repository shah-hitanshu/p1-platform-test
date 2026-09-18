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
    metadata: null,
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

  it('puts the cursor in the composer as soon as the thread opens', () => {
    renderThread({ onPost: vi.fn() });
    expect(screen.getByRole('textbox', { name: 'New comment' })).toHaveFocus();
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

  it('offers to resolve an open thread, and the badge instead once it is resolved', () => {
    const onResolve = vi.fn();
    const { rerender } = renderThread({ threadId: 't-1', onResolve });

    fireEvent.click(screen.getByRole('button', { name: 'Resolve thread' }));
    expect(onResolve).toHaveBeenCalledTimes(1);

    rerender(
      <CommentThread contextType="block" contextId="comp-1" threadId="t-1" resolved onResolve={onResolve} onClose={() => {}} />,
    );
    expect(screen.queryByTestId('comment-thread-resolve')).not.toBeInTheDocument();
    expect(screen.getByTestId('comment-thread-resolved')).toBeInTheDocument();
  });

  // A reader looking at a thread on a context nothing can be sent through — no editor,
  // no thread started yet — is shown no control they cannot use.
  it('offers no way to resolve when resolving is not on offer', () => {
    renderThread({ threadId: 't-1' });

    expect(screen.queryByTestId('comment-thread-resolve')).not.toBeInTheDocument();
  });

  it('holds the resolve button while the change is in flight, and says when it did not land', () => {
    const onResolve = vi.fn();
    const { rerender } = renderThread({ threadId: 't-1', onResolve, resolving: true });
    expect(screen.getByTestId('comment-thread-resolve')).toBeDisabled();

    rerender(
      <CommentThread
        contextType="block"
        contextId="comp-1"
        threadId="t-1"
        onResolve={onResolve}
        resolveFailed
        onClose={() => {}}
      />,
    );
    const button = screen.getByTestId('comment-thread-resolve');
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName('Resolve thread, last attempt failed');
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

describe('CommentThread mentions', () => {
  const agent = { type: 'agent' as const, id: 'a-1', name: 'Pantheon Agent', role: 'Editor', avatar: null };
  const marco = { type: 'user' as const, id: 'u-1', name: 'Marco Reyes', role: 'Editor', avatar: null };
  const nadia = { type: 'user' as const, id: 'u-2', name: 'Nadia Brooks', role: 'Site owner', avatar: null };
  const candidates = [agent, marco, nadia];

  afterEach(() => {
    vi.useRealTimers();
  });

  function typeDraft(draft: HTMLElement, value: string) {
    fireEvent.change(draft, { target: { value } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
  }

  function renderWithPicker(onPost = vi.fn()) {
    vi.useFakeTimers();
    renderThread({ onPost, mentionCandidates: candidates });
    return { onPost, draft: screen.getByRole('textbox', { name: 'New comment' }) };
  }

  it('opens a grouped list of everyone once @ has settled, and filters it as the reader types', () => {
    const { draft } = renderWithPicker();

    fireEvent.change(draft, { target: { value: '@' } });
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(200);
    });

    const picker = screen.getByRole('listbox', { name: 'Mention someone' });
    expect(screen.getByRole('group', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Site members' })).toBeInTheDocument();
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Pantheon Agent');
    expect(rows[1]).toHaveTextContent('Marco Reyes');
    expect(rows[2]).toHaveTextContent('Nadia Brooks');

    typeDraft(draft, '@NAD');
    expect(picker).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Nadia Brooks/ })).toHaveTextContent('Site owner');
    expect(screen.queryByRole('group', { name: 'Agent' })).toBeNull();
  });

  it('goes away when a space follows the @ or nobody matches, leaving the text as typed', () => {
    const { draft } = renderWithPicker();

    typeDraft(draft, '@ ');
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    expect(draft).toHaveValue('@ ');

    typeDraft(draft, '@nonexistent');
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    expect(draft).toHaveValue('@nonexistent');
  });

  it('moves with the arrow keys and inserts the highlighted name on Enter', () => {
    const { draft, onPost } = renderWithPicker();
    typeDraft(draft, 'hey @');

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(draft, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(draft).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1]?.id);

    fireEvent.keyDown(draft, { key: 'Enter' });
    expect(draft).toHaveValue('hey @Marco Reyes ');
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    expect(onPost).not.toHaveBeenCalled();
  });

  it('selects with Tab and with a click', () => {
    const { draft } = renderWithPicker();

    typeDraft(draft, '@pan');
    fireEvent.keyDown(draft, { key: 'Tab' });
    expect(draft).toHaveValue('@Pantheon Agent ');

    typeDraft(draft, '@Pantheon Agent @na');
    fireEvent.click(screen.getByRole('option', { name: /Nadia Brooks/ }));
    expect(draft).toHaveValue('@Pantheon Agent @Nadia Brooks ');
  });

  it('wraps around at either end of the list', () => {
    const { draft } = renderWithPicker();
    typeDraft(draft, '@');

    fireEvent.keyDown(draft, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(draft, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  describe('placement', () => {
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

    function pickerOpenedWith(listHeight: number, composerTop: number) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => listHeight });
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: composerTop } as DOMRect);
      const { draft } = renderWithPicker();
      typeDraft(draft, '@');
      return screen.getByTestId('mention-picker');
    }

    afterEach(() => {
      if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor);
      vi.restoreAllMocks();
    });

    it('opens above the composer when the list fits between it and the top of the frame', () => {
      expect(pickerOpenedWith(200, 400)).toHaveAttribute('data-placement', 'above');
    });

    it('opens below the composer when the top of the frame would cut the list off', () => {
      expect(pickerOpenedWith(200, 120)).toHaveAttribute('data-placement', 'below');
    });
  });

  it('closes on Escape without touching the draft, and stays closed until the query changes', () => {
    const { draft } = renderWithPicker();
    typeDraft(draft, '@ma');

    fireEvent.keyDown(draft, { key: 'Escape' });
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    expect(draft).toHaveValue('@ma');

    typeDraft(draft, '@mar');
    expect(screen.getByTestId('mention-picker')).toBeInTheDocument();
  });

  it('posts the chosen names as mention tokens', () => {
    const { draft, onPost } = renderWithPicker();

    typeDraft(draft, '@pan');
    fireEvent.keyDown(draft, { key: 'Enter' });
    typeDraft(draft, '@Pantheon Agent please loop in @mar');
    fireEvent.keyDown(draft, { key: 'Enter' });
    typeDraft(draft, '@Pantheon Agent please loop in @Marco Reyes too');

    fireEvent.keyDown(draft, { key: 'Enter' });
    expect(onPost).toHaveBeenCalledWith('${mention|agent:a-1} please loop in ${mention|user:u-1} too');
    expect(draft).toHaveValue('');
  });

  it('shows the agent with its glyph and badge, people with their role', () => {
    const { draft } = renderWithPicker();
    typeDraft(draft, '@');

    const [agentRow, marcoRow] = screen.getAllByRole('option');
    expect(agentRow?.querySelector('[data-testid="icon-sparkles"]')).not.toBeNull();
    expect(agentRow).toHaveTextContent('Agent');
    expect(marcoRow?.querySelector('[data-testid="icon-sparkles"]')).toBeNull();
    expect(marcoRow).toHaveTextContent('Editor');
  });
});
