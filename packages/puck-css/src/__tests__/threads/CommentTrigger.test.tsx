/**
 * The trigger is the whole of the feature a reader can see right now, so what matters
 * is that its two states read differently to assistive tech and that opening it says
 * which thing is being discussed.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  Icon: ({ iconName, ...props }: any) => <span data-testid={`icon-${iconName}`} {...props} />,
  Tally: ({ label, ...props }: any) => (
    <span data-testid="tally" {...props}>
      {label}
    </span>
  ),
}));

import { CommentTrigger } from '../../features/threads/ui/CommentTrigger.js';

describe('CommentTrigger', () => {
  it('offers to start a thread when there is none', () => {
    render(<CommentTrigger contextType="block" contextId="comp-1" />);

    const trigger = screen.getByTestId('comment-trigger');
    expect(trigger).toHaveAttribute('aria-label', 'Comment on this');
    expect(screen.getByTestId('icon-comment')).toBeInTheDocument();
  });

  it('shows no count when there is nothing to count', () => {
    render(<CommentTrigger contextType="block" contextId="comp-1" commentCount={0} />);

    expect(screen.queryByTestId('tally')).not.toBeInTheDocument();
  });

  it('shows how many comments a thread holds', () => {
    render(
      <CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={4} />
    );

    const trigger = screen.getByTestId('comment-trigger');
    expect(trigger).toHaveAttribute('aria-label', '4 comments');
    expect(screen.getByTestId('tally')).toHaveTextContent('4');
    // The label already reads the count, so the tally must not repeat it.
    expect(screen.getByTestId('tally')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says "1 comment" rather than "1 comments"', () => {
    render(<CommentTrigger contextType="block" contextId="comp-1" threadId="t-1" commentCount={1} />);

    expect(screen.getByTestId('comment-trigger')).toHaveAttribute('aria-label', '1 comment');
  });

  it('opens the thread on the context it was given', () => {
    render(<CommentTrigger contextType="page" contextId="/about" />);

    expect(screen.queryByTestId('comment-thread')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('comment-trigger'));

    expect(screen.getByTestId('comment-thread').textContent).toContain(
      'thread will go here for page with id /about'
    );
  });

  it('names the thread it opened when one already exists', () => {
    render(<CommentTrigger contextType="block" contextId="comp-1" threadId="t-9" commentCount={2} />);

    fireEvent.click(screen.getByTestId('comment-trigger'));

    expect(screen.getByTestId('comment-thread').textContent).toContain('thread t-9');
  });

  it('closes the thread again', () => {
    render(<CommentTrigger contextType="block" contextId="comp-1" />);
    const trigger = screen.getByTestId('comment-trigger');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByLabelText('Close comments'));
    expect(screen.queryByTestId('comment-thread')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  // Two threads at once would both claim to be about the content under them, and on
  // the canvas they would overlap.
  it('closes the open thread when another one is opened', () => {
    render(
      <>
        <CommentTrigger contextType="block" contextId="comp-1" />
        <CommentTrigger contextType="block" contextId="comp-2" />
      </>
    );
    const [first, second] = screen.getAllByTestId('comment-trigger');

    fireEvent.click(first as HTMLElement);
    expect(screen.getAllByTestId('comment-thread')).toHaveLength(1);
    expect(first).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(second as HTMLElement);
    expect(screen.getAllByTestId('comment-thread')).toHaveLength(1);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('comment-thread').textContent).toContain('id comp-2');
  });

  it('closes the thread when the pointer goes down somewhere else', () => {
    render(
      <>
        <CommentTrigger contextType="block" contextId="comp-1" />
        <p>somewhere else</p>
      </>
    );
    const trigger = screen.getByTestId('comment-trigger');
    fireEvent.click(trigger);

    fireEvent.pointerDown(screen.getByTestId('comment-thread'));
    expect(screen.getByTestId('comment-thread')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText('somewhere else'));
    expect(screen.queryByTestId('comment-thread')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  // A host that owns the panel gets the click instead, and the trigger stops claiming
  // to expand anything of its own.
  it('hands the context to a host that wants to open its own panel', () => {
    const onOpen = vi.fn();
    render(
      <CommentTrigger
        contextType="workstream"
        contextId="ws-2"
        threadId="t-3"
        commentCount={5}
        onOpen={onOpen}
      />
    );

    const trigger = screen.getByTestId('comment-trigger');
    expect(trigger).not.toHaveAttribute('aria-expanded');

    fireEvent.click(trigger);

    expect(onOpen).toHaveBeenCalledWith({
      contextType: 'workstream',
      contextId: 'ws-2',
      threadId: 't-3',
      commentCount: 5,
    });
    expect(screen.queryByTestId('comment-thread')).not.toBeInTheDocument();
  });
});
