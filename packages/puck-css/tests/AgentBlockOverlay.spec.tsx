import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentBlockOverlay } from '../src/collaboration/components/AgentBlockOverlay.js';

const AGENT = { actorName: 'Pantheon Agent', onBehalfOf: 'Alice', onStop: vi.fn() };

describe('AgentBlockOverlay, marking the block', () => {
  it('names the agent while it is working', () => {
    render(<AgentBlockOverlay {...AGENT} isEditing />);

    expect(screen.getByText('Pantheon Agent')).toBeInTheDocument();
  });

  it('names the agent while it only holds the block', () => {
    render(<AgentBlockOverlay {...AGENT} isEditing={false} />);

    expect(screen.getByText('Pantheon Agent')).toBeInTheDocument();
  });

  it('uses the name the agent is registered under', () => {
    render(<AgentBlockOverlay {...AGENT} actorName="Acme Copywriter" isEditing />);

    expect(screen.getByText('Acme Copywriter')).toBeInTheDocument();
  });
});

describe('AgentBlockOverlay, while the agent is working', () => {
  it('names the person the agent is working for', () => {
    render(<AgentBlockOverlay {...AGENT} isEditing />);

    expect(screen.getByText('Pantheon Agent on behalf of Alice')).toBeInTheDocument();
  });

  it('names the agent alone when nobody asked for the work', () => {
    render(<AgentBlockOverlay actorName="Pantheon Agent" isEditing onStop={vi.fn()} />);

    expect(screen.queryByText(/on behalf of/)).not.toBeInTheDocument();
  });

  // An empty requester reads as a name the presence record simply lacks.
  it('names the agent alone when the requester has no name', () => {
    render(<AgentBlockOverlay {...AGENT} onBehalfOf="" isEditing />);

    expect(screen.queryByText(/on behalf of/)).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAccessibleName('Stop Pantheon Agent');
  });

  it('offers a stop control that reads as one and says what it stops', () => {
    render(<AgentBlockOverlay {...AGENT} isEditing />);

    const stop = screen.getByRole('button', { name: 'Stop Pantheon Agent on behalf of Alice' });
    expect(stop).toHaveTextContent('Stop');
  });

  it('calls off the agent when the control is used', () => {
    const onStop = vi.fn();
    render(<AgentBlockOverlay {...AGENT} isEditing onStop={onStop} />);

    fireEvent.click(screen.getByRole('button', { name: /^Stop/ }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('AgentBlockOverlay, while the agent only holds the block', () => {
  it('keeps the banner and its controls away', () => {
    render(<AgentBlockOverlay {...AGENT} isEditing={false} />);

    expect(screen.queryByText(/on behalf of/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('AgentBlockOverlay, the shimmer over the block', () => {
  it('sweeps while the agent is working', () => {
    const { container } = render(<AgentBlockOverlay {...AGENT} isEditing />);

    expect(container.querySelector('.focus-region-agent__shimmer')).toBeInTheDocument();
  });

  it('is still while the agent only holds the block', () => {
    const { container } = render(<AgentBlockOverlay {...AGENT} isEditing={false} />);

    expect(container.querySelector('.focus-region-agent__shimmer')).not.toBeInTheDocument();
  });

  it('says nothing to a screen reader', () => {
    const { container } = render(<AgentBlockOverlay {...AGENT} isEditing />);

    expect(container.querySelector('.focus-region-agent__shimmer')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

describe('AgentBlockOverlay, over a run of blocks', () => {
  it('says how many blocks the agent has taken', () => {
    render(<AgentBlockOverlay {...AGENT} isEditing blockCount={2} />);

    expect(screen.getByText('Pantheon Agent on behalf of Alice \u00b7 2 blocks')).toBeInTheDocument();
  });

  it('counts nothing when the agent has the one block', () => {
    render(<AgentBlockOverlay {...AGENT} isEditing blockCount={1} />);

    expect(screen.getByText('Pantheon Agent on behalf of Alice')).toBeInTheDocument();
  });
});

// Named here so a rename cannot quietly break the end-to-end suite.
describe('AgentBlockOverlay, the handles an end-to-end test targets', () => {
  it('names the shimmer, the banner and the stop control while the agent works', () => {
    render(<AgentBlockOverlay {...AGENT} isEditing />);

    expect(screen.getByTestId('agent-block-shimmer')).toBeInTheDocument();
    expect(screen.getByTestId('agent-block-banner')).toBeInTheDocument();
    expect(screen.getByTestId('agent-block-stop')).toBeInTheDocument();
  });

  it('carries none of them while the agent only holds the block', () => {
    render(<AgentBlockOverlay {...AGENT} isEditing={false} />);

    expect(screen.queryByTestId('agent-block-shimmer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-block-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-block-stop')).not.toBeInTheDocument();
  });
});
