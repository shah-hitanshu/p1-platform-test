/**
 * An agent's turn in a thread is one comment that changes as the work moves along:
 * a working line, then a proposal, a refining comment, or a note that it failed. What matters is
 * that each state reads as itself, that the proposal's buttons do what they say, and
 * that refining sends the agent a comment it will be mentioned in.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AgentProposalComment, Comment } from '@pantheon-systems/css-client';

vi.mock('@pantheon-systems/pds-toolkit-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Icon: ({ iconName, ...props }: any) => <span data-testid={`icon-${iconName}`} {...props} />,
}));

import { CommentThread } from '../../features/threads/ui/CommentThread.js';
import { ProposalPreviewContext } from '../../features/threads/proposal-preview-context.js';

const agent = { type: 'agent' as const, id: 'agent-1', name: 'P1 Agent', avatar: null };
const nick = { id: 'user-1', name: 'Nick' };

function working(): Comment {
  return {
    id: 'a-1',
    threadId: 't-1',
    kind: 'agent_activity',
    body: 'Looking into it…',
    metadata: { status: 'working' },
    author: { ...agent, requestedBy: nick },
    mentions: [],
    createdAt: '2026-09-13T12:00:00Z',
    editedAt: null,
  };
}

function proposal(status: AgentProposalComment['metadata']['status'] = 'proposed'): AgentProposalComment {
  return {
    id: 'a-1',
    threadId: 't-1',
    kind: 'agent_proposal',
    body: 'Nick, here is a tighter heading.',
    metadata: {
      status,
      summary: 'Shorten the heading',
      operations: [{ op: 'replace', path: 'content.0.props.text', value: 'Welcome' }],
      ...(status === 'accepted' || status === 'dismissed'
        ? { decidedBy: { type: 'user', ...nick, avatar: null }, decidedAt: '2026-09-13T12:05:00Z' }
        : {}),
    },
    author: { ...agent, requestedBy: nick },
    mentions: [],
    createdAt: '2026-09-13T12:00:00Z',
    editedAt: '2026-09-13T12:01:00Z',
  };
}

function renderThread(props: Partial<React.ComponentProps<typeof CommentThread>>) {
  return render(<CommentThread contextType="block" contextId="comp-1" onClose={() => {}} {...props} />);
}

describe('agent comments in a thread', () => {
  it('shows a working line naming who asked, with a pulse', () => {
    renderThread({ comments: [working()] });
    const line = screen.getByTestId('agent-activity');
    expect(line).toHaveAttribute('data-status', 'working');
    expect(line).toHaveTextContent('Nick');
    expect(line.querySelector('span')).not.toBeNull();
  });

  it('shows a failed turn without the pulse', () => {
    renderThread({ comments: [{ ...working(), metadata: { status: 'failed' }, body: 'Something went wrong.' }] });
    const line = screen.getByTestId('agent-activity');
    expect(line).toHaveAttribute('data-status', 'failed');
    expect(line.querySelector('span')).toBeNull();
  });

  it('offers accept and dismiss on a waiting proposal and passes the comment through', async () => {
    const accept = vi.fn().mockResolvedValue(true);
    const dismiss = vi.fn().mockResolvedValue(true);
    renderThread({ comments: [proposal()], proposalActions: { accept, dismiss } });

    expect(screen.getByTestId('agent-proposal')).toHaveAttribute('data-status', 'proposed');
    fireEvent.click(screen.getByTestId('agent-proposal-accept'));
    fireEvent.click(screen.getByTestId('agent-proposal-dismiss'));
    await waitFor(() => expect(accept).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-1' })));
    expect(dismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-1' }));
  });

  it('keeps offering the buttons on a proposal another accept is applying', () => {
    renderThread({ comments: [proposal('applying')], proposalActions: { accept: vi.fn(), dismiss: vi.fn() } });
    expect(screen.getByTestId('agent-proposal')).toHaveAttribute('data-status', 'applying');
    expect(screen.getByTestId('agent-proposal-accept')).toBeEnabled();
    expect(screen.queryByTestId('agent-proposal-outcome')).toBeNull();
  });

  it('disables accept when the thread offers none', () => {
    renderThread({ comments: [proposal()], proposalActions: { dismiss: vi.fn() } });
    expect(screen.getByTestId('agent-proposal-accept')).toBeDisabled();
    expect(screen.getByTestId('agent-proposal-dismiss')).toBeEnabled();
  });

  it('sends a refinement as a comment that mentions the agent, on Enter', async () => {
    const onPost = vi.fn().mockResolvedValue(true);
    renderThread({ comments: [proposal()], onPost });

    fireEvent.click(screen.getByTestId('agent-proposal-refine-toggle'));
    const note = screen.getByLabelText('Refine this proposal');
    fireEvent.change(note, { target: { value: 'Keep it under five words' } });
    fireEvent.keyDown(note, { key: 'Enter' });

    await waitFor(() =>
      expect(onPost).toHaveBeenCalledWith('${mention|agent:agent-1} Keep it under five words'),
    );
    await waitFor(() => expect(screen.queryByLabelText('Refine this proposal')).toBeNull());
  });

  it('says who accepted or dismissed a decided proposal and hides the buttons', () => {
    const { rerender } = renderThread({ comments: [proposal('accepted')], proposalActions: { dismiss: vi.fn() } });
    expect(screen.getByTestId('agent-proposal')).toHaveAttribute('data-status', 'accepted');
    expect(screen.getByTestId('agent-proposal-outcome')).toHaveTextContent('Nick');
    expect(screen.queryByTestId('agent-proposal-accept')).toBeNull();
    expect(screen.queryByLabelText('Refine this proposal')).toBeNull();

    rerender(<CommentThread contextType="block" contextId="comp-1" onClose={() => {}} comments={[proposal('dismissed')]} />);
    expect(screen.getByTestId('agent-proposal')).toHaveAttribute('data-status', 'dismissed');
    expect(screen.getByTestId('agent-proposal-outcome')).toHaveTextContent('Nick');
  });

  it('names the block and field a change lands in and shows the text before and after', () => {
    const page = {
      data: { content: [{ type: 'HeroBlock', props: { id: 'comp-1', text: '<p>The research reshaping our world.</p>' } }] },
      config: { components: { HeroBlock: { label: 'Hero', fields: { text: { label: 'Headline' } } } } },
    };
    render(
      <ProposalPreviewContext.Provider value={() => page}>
        <CommentThread contextType="block" contextId="comp-1" onClose={() => {}} comments={[proposal()]} />
      </ProposalPreviewContext.Provider>,
    );
    expect(screen.getByTestId('agent-proposal-block')).toHaveTextContent('Hero');
    expect(screen.getByTestId('agent-proposal-field')).toHaveTextContent('Headline');
    expect(screen.getByTestId('agent-proposal-before')).toHaveTextContent('The research reshaping our world.');
    expect(screen.getByTestId('agent-proposal-after')).toHaveTextContent('Welcome');
  });

  it('falls back to the path when the page is not to hand', () => {
    renderThread({ comments: [proposal()] });
    expect(screen.queryByTestId('agent-proposal-block')).toBeNull();
    expect(screen.getByTestId('agent-proposal-field')).toHaveTextContent('Text');
    expect(screen.getByTestId('agent-proposal-after')).toHaveTextContent('Welcome');
  });
});
