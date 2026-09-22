/**
 * Opening a thread should land on its most recent message, and any comment added
 * after that — posted from here or added by an agent's reply — should scroll
 * smoothly into view instead of leaving the reader looking at an old spot.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import type { Comment as CommentRecord } from '@pantheon-systems/css-client';

import { CommentList } from '../../features/threads/ui/CommentList.js';

function comment(id: string, body: string, minute: number, threadId = 't-1'): CommentRecord {
  return {
    id,
    threadId,
    kind: 'message',
    body,
    metadata: null,
    author: { type: 'user', id: 'user-1', name: 'Nick', avatar: null },
    mentions: [],
    createdAt: `2026-09-01T00:0${minute}:00Z`,
    editedAt: null,
  };
}

afterEach(() => {
  cleanup();
});

describe('CommentList scroll management', () => {
  it('opens scrolled to the bottom of a thread taller than the visible area', () => {
    const scrollHeightSpy = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(900);

    const { getByTestId } = render(
      <CommentList threadId="t-1" comments={[comment('c-1', 'First', 1), comment('c-2', 'Second', 2)]} />,
    );

    const list = getByTestId('thread-comments');
    expect(list.scrollTop).toBe(900);

    scrollHeightSpy.mockRestore();
  });

  it('smooth-scrolls a newly appended comment into view', () => {
    const scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});

    const initial = [comment('c-1', 'First', 1), comment('c-2', 'Second', 2)];
    const { getByTestId, rerender } = render(<CommentList threadId="t-1" comments={initial} />);

    // The initial mount jumps to the bottom, not a smooth scroll — only count what
    // happens once a new comment arrives.
    scrollIntoViewSpy.mockClear();

    rerender(<CommentList threadId="t-1" comments={[...initial, comment('c-3', 'Third', 3)]} />);

    const list = getByTestId('thread-comments');
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' });
    expect(scrollIntoViewSpy.mock.instances[0]).toBe(list.lastElementChild);

    scrollIntoViewSpy.mockRestore();
  });

  it('jumps to the bottom of a new thread even when its comment count matches the old one', () => {
    const scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const scrollHeightSpy = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(900);

    const threadA = [comment('a-1', 'First', 1, 't-a'), comment('a-2', 'Second', 2, 't-a')];
    const { getByTestId, rerender } = render(<CommentList threadId="t-a" comments={threadA} />);

    const list = getByTestId('thread-comments');
    // Simulate the reader having scrolled up within thread A before switching threads.
    list.scrollTop = 0;

    // Same comment count as thread A, but a different thread — the panel should not
    // reuse thread A's scroll offset (or treat this as just another appended comment).
    const threadB = [comment('b-1', 'Other first', 1, 't-b'), comment('b-2', 'Other second', 2, 't-b')];
    rerender(<CommentList threadId="t-b" comments={threadB} />);

    expect(list.scrollTop).toBe(900);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    scrollHeightSpy.mockRestore();
    scrollIntoViewSpy.mockRestore();
  });

  it('jumps to the bottom on first render of a draft thread (no threadId yet)', () => {
    const scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const scrollHeightSpy = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(900);

    const { getByTestId } = render(
      <CommentList threadId={undefined} comments={[comment('c-1', 'First', 1), comment('c-2', 'Second', 2)]} />,
    );

    const list = getByTestId('thread-comments');
    expect(list.scrollTop).toBe(900);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    scrollHeightSpy.mockRestore();
    scrollIntoViewSpy.mockRestore();
  });
});
