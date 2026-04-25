/**
 * Tests for <AgentChip> component.
 *
 * Validates agent name/intent rendering, progress display, stop button
 * behavior, accessible labeling, cross-workstream indicator badge,
 * and PDS Avatar usage.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentChip } from './AgentChip.js';

// =============================================================================
// Mock Data
// =============================================================================

const mockAgent = {
  id: 'agent-001',
  name: 'Content Writer',
  initials: 'CW',
  gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
  intent: 'Rewriting hero section copy',
  workstream: 'feature/homepage-refresh',
};

const mockAgentWithProgress = {
  ...mockAgent,
  progress: '3 of 8 components updated',
};

describe('AgentChip', () => {
  const defaultProps = {
    agent: mockAgent,
    onStop: vi.fn(),
  };

  it('renders the agent name', () => {
    render(<AgentChip {...defaultProps} />);

    const name = screen.getByTestId('agent-chip-name');
    expect(name).toBeDefined();
    expect(name.textContent).toBe('Content Writer');
  });

  it('renders the agent intent', () => {
    render(<AgentChip {...defaultProps} />);

    const intent = screen.getByTestId('agent-chip-intent');
    expect(intent).toBeDefined();
    expect(intent.textContent).toContain('Rewriting hero section copy');
  });

  it('renders progress in the intent area when progress is provided', () => {
    render(<AgentChip agent={mockAgentWithProgress} onStop={vi.fn()} />);

    const intent = screen.getByTestId('agent-chip-intent');
    expect(intent.textContent).toContain('3 of 8 components updated');
  });

  it('does not render progress text when progress is not provided', () => {
    render(<AgentChip {...defaultProps} />);

    const intent = screen.getByTestId('agent-chip-intent');
    expect(intent.textContent).not.toContain('of');
  });

  it('renders a PDS Avatar for the agent', () => {
    render(<AgentChip {...defaultProps} />);

    const wrapper = screen.getByTestId('agent-chip-avatar');
    expect(wrapper).toBeDefined();
    expect(wrapper.querySelector('.pds-avatar')).toBeTruthy();
  });

  it('does not show user fallback icon — agents use robot icon overlay', () => {
    render(<AgentChip {...defaultProps} />);

    const wrapper = screen.getByTestId('agent-chip-avatar');
    expect(wrapper.querySelector('.pds-avatar__user-icon')).toBeNull();
  });

  it('renders the stop button', () => {
    render(<AgentChip {...defaultProps} />);

    const stopBtn = screen.getByTestId('agent-chip-stop');
    expect(stopBtn).toBeDefined();
  });

  it('calls onStop with the agent id when stop button is clicked', () => {
    const onStop = vi.fn();
    render(<AgentChip agent={mockAgent} onStop={onStop} />);

    fireEvent.click(screen.getByTestId('agent-chip-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledWith('agent-001');
  });

  it('stop button has an accessible aria-label containing "Stop"', () => {
    render(<AgentChip {...defaultProps} />);

    const stopBtn = screen.getByTestId('agent-chip-stop');
    const ariaLabel = stopBtn.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain('Stop');
  });

  it('does not render workstream badge when agent.workstream matches currentWorkstream', () => {
    render(
      <AgentChip
        {...defaultProps}
        currentWorkstream="feature/homepage-refresh"
      />
    );

    expect(screen.queryByTestId('agent-chip-workstream-badge')).toBeNull();
  });

  it('renders workstream badge when agent.workstream differs from currentWorkstream', () => {
    render(
      <AgentChip
        {...defaultProps}
        currentWorkstream="feature/pricing-page"
      />
    );

    const badge = screen.getByTestId('agent-chip-workstream-badge');
    expect(badge).toBeDefined();
  });

  it('renders workstream badge when currentWorkstream is not provided', () => {
    render(<AgentChip {...defaultProps} />);

    const badge = screen.getByTestId('agent-chip-workstream-badge');
    expect(badge).toBeDefined();
  });

  it('workstream badge displays the agent workstream name', () => {
    render(
      <AgentChip
        {...defaultProps}
        currentWorkstream="feature/pricing-page"
      />
    );

    const badge = screen.getByTestId('agent-chip-workstream-badge');
    expect(badge.textContent).toContain('feature/homepage-refresh');
  });
});
