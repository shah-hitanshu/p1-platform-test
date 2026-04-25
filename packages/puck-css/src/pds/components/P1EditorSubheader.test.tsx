/**
 * P1EditorSubheader Tests
 *
 * Tests for the pure presentational subheader component — panel toggles,
 * device selector, presence stack, agent chips, doc state badge,
 * publish control, and undo/redo button states and callbacks.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { P1EditorSubheader } from './P1EditorSubheader.js';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('./AgentChip.js', () => ({
  AgentChip: ({
    id,
    agent,
    currentWorkstream,
  }: {
    id: string;
    agent: { intent: string };
    currentWorkstream?: string;
  }) => (
    <div
      data-testid="agent-chip"
      data-id={id}
      data-intent={agent.intent}
      data-current-workstream={currentWorkstream ?? ''}
    />
  ),
}));

vi.mock('./PresenceStack.js', () => ({
  PresenceStack: () => <div data-testid="presence-stack" />,
}));

vi.mock('./PublishControl.js', () => ({
  PublishControl: () => <div data-testid="publish-control" />,
}));

// =============================================================================
// Types
// =============================================================================

type DocState = 'modified' | 'unpublished' | 'live' | 'liveOnly';

interface ActorPresence {
  id: string;
  name: string;
  isAgent: boolean;
}

// =============================================================================
// Fixtures
// =============================================================================

const humanActor: ActorPresence = { id: 'user-1', name: 'Alice', isAgent: false };
const agentActor: ActorPresence = { id: 'agent-1', name: 'Agent Smith', isAgent: true };

// =============================================================================
// Tests
// =============================================================================

afterEach(() => {
  cleanup();
});

describe('P1EditorSubheader', () => {
  const defaultProps = {
    puckActions: <div data-testid="puck-actions" />,
    docState: 'modified' as DocState,
    context: 'branch' as const,
    agents: [],
    humanActors: [],
    onStopAgent: vi.fn(),
    onPublish: vi.fn(),
    hasPast: false,
    hasFuture: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };

  it('renders the subheader container with data-testid="p1-editor-subheader"', () => {
    render(<P1EditorSubheader {...defaultProps} />);

    const subheader = screen.getByTestId('p1-editor-subheader');
    expect(subheader).toBeDefined();
    expect(subheader.tagName).toBe('DIV');
  });

  it('renders panel toggle buttons', () => {
    render(<P1EditorSubheader {...defaultProps} />);

    expect(screen.getByTestId('panel-toggles')).toBeDefined();
  });

  it('renders device selector', () => {
    render(<P1EditorSubheader {...defaultProps} />);

    expect(screen.getByTestId('device-selector')).toBeDefined();
  });

  it('renders PresenceStack when humanActors is non-empty', () => {
    render(
      <P1EditorSubheader {...defaultProps} humanActors={[humanActor]} />
    );

    expect(screen.getByTestId('presence-stack')).toBeDefined();
  });

  it('does NOT render PresenceStack when humanActors is empty', () => {
    render(<P1EditorSubheader {...defaultProps} humanActors={[]} />);

    expect(screen.queryByTestId('presence-stack')).toBeNull();
  });

  it('renders an AgentChip for each agent in agents', () => {
    const twoAgents = [agentActor, { id: 'agent-2', name: 'Bot', isAgent: true }];
    render(
      <P1EditorSubheader {...defaultProps} agents={twoAgents} />
    );

    const chips = screen.getAllByTestId('agent-chip');
    expect(chips.length).toBe(2);
  });

  it('renders no AgentChip when agents is empty', () => {
    render(<P1EditorSubheader {...defaultProps} agents={[]} />);

    expect(screen.queryByTestId('agent-chip')).toBeNull();
  });

  it('renders PublishControl', () => {
    render(<P1EditorSubheader {...defaultProps} />);

    expect(screen.getByTestId('publish-control')).toBeDefined();
  });

  it('undo button is disabled when hasPast is false', () => {
    render(<P1EditorSubheader {...defaultProps} hasPast={false} />);

    const undoBtn = screen.getByTestId('undo-btn');
    expect((undoBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('undo button is enabled when hasPast is true', () => {
    render(<P1EditorSubheader {...defaultProps} hasPast={true} />);

    const undoBtn = screen.getByTestId('undo-btn');
    expect((undoBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('redo button is disabled when hasFuture is false', () => {
    render(<P1EditorSubheader {...defaultProps} hasFuture={false} />);

    const redoBtn = screen.getByTestId('redo-btn');
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('redo button is enabled when hasFuture is true', () => {
    render(<P1EditorSubheader {...defaultProps} hasFuture={true} />);

    const redoBtn = screen.getByTestId('redo-btn');
    expect((redoBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking undo button calls onUndo', () => {
    const onUndo = vi.fn();
    render(<P1EditorSubheader {...defaultProps} hasPast={true} onUndo={onUndo} />);

    fireEvent.click(screen.getByTestId('undo-btn'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('clicking redo button calls onRedo', () => {
    const onRedo = vi.fn();
    render(<P1EditorSubheader {...defaultProps} hasFuture={true} onRedo={onRedo} />);

    fireEvent.click(screen.getByTestId('redo-btn'));
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('passes each agent id to its AgentChip', () => {
    const twoAgents: ActorPresence[] = [
      { id: 'agent-alpha', name: 'Alpha', isAgent: true },
      { id: 'agent-beta', name: 'Beta', isAgent: true },
    ];
    render(<P1EditorSubheader {...defaultProps} agents={twoAgents} />);

    const chips = screen.getAllByTestId('agent-chip');
    const ids = chips.map((el) => el.getAttribute('data-id'));
    expect(ids).toContain('agent-alpha');
    expect(ids).toContain('agent-beta');
  });

  it('forwards intent from SubheaderActor to AgentChip', () => {
    const agents = [{ id: 'agent-1', name: 'Agent', isAgent: true, intent: 'Rewrite hero copy' }];
    render(<P1EditorSubheader {...defaultProps} agents={agents} />);

    const chip = screen.getByTestId('agent-chip');
    expect(chip.getAttribute('data-intent')).toBe('Rewrite hero copy');
  });

  it('falls back to empty intent when SubheaderActor has no intent', () => {
    const agents = [{ id: 'agent-1', name: 'Agent', isAgent: true }];
    render(<P1EditorSubheader {...defaultProps} agents={agents} />);

    const chip = screen.getByTestId('agent-chip');
    expect(chip.getAttribute('data-intent')).toBe('');
  });

  it('always passes currentWorkstream="" to AgentChip to suppress cross-workstream badge', () => {
    const agents = [{ id: 'agent-1', name: 'Agent', isAgent: true }];
    render(<P1EditorSubheader {...defaultProps} agents={agents} />);

    const chip = screen.getByTestId('agent-chip');
    expect(chip.getAttribute('data-current-workstream')).toBe('');
  });
});
