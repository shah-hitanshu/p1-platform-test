/**
 * Publish button while a historical version is previewed
 *
 * The version-history preview is read-only, so the toolbar's publish control
 * must not offer to publish what is on screen. The toolbar itself knows
 * nothing about versions; it just greys the control out when told to.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { P1EditorSubheader } from './P1EditorSubheader.js';

const publishControlProps: Record<string, unknown>[] = [];

vi.mock('./AgentChip.js', () => ({
  AgentChip: () => <div data-testid="agent-chip" />,
}));

vi.mock('./WorkstreamSwitcher.js', () => ({
  WorkstreamSwitcher: () => <div data-testid="workstream-trigger" />,
}));

vi.mock('./PublishControl.js', () => ({
  PublishControl: (props: Record<string, unknown>) => {
    publishControlProps.push(props);
    return (
      <button type="button" disabled={Boolean(props.disabled)}>
        {props.renderBadgeOnly ? 'badge' : 'Publish'}
      </button>
    );
  },
}));

const mainBranch = {
  id: 'main',
  name: 'main',
  isMain: true,
  siteId: 'site-1',
  createdAt: '2024-01-01T00:00:00Z',
};

const defaultProps = {
  puckActions: <></>,
  docState: 'unpublished' as const,
  context: 'main' as const,
  agents: [],
  onStopAgent: () => {},
  hasPast: false,
  hasFuture: false,
  onUndo: () => {},
  onRedo: () => {},
  branches: [mainBranch],
  currentBranch: mainBranch,
  onSwitchBranch: () => {},
  onCompareWithLive: () => {},
};

function buttonControl(): Record<string, unknown> | undefined {
  return publishControlProps.find((p) => p.renderButtonOnly === true);
}

function badgeControl(): Record<string, unknown> | undefined {
  return publishControlProps.find((p) => p.renderBadgeOnly === true);
}

describe('P1EditorSubheader publish button gating', () => {
  afterEach(() => {
    cleanup();
    publishControlProps.length = 0;
  });

  it('disables the publish control when publishDisabled is set', () => {
    render(<P1EditorSubheader {...defaultProps} publishDisabled />);

    expect(buttonControl()?.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('leaves the publish control enabled otherwise', () => {
    render(<P1EditorSubheader {...defaultProps} />);

    expect(buttonControl()?.disabled).toBeFalsy();
    expect(screen.getByRole('button', { name: 'Publish' })).not.toBeDisabled();
  });

  it('renders no badge when badgeDocState is absent', () => {
    render(<P1EditorSubheader {...defaultProps} publishDisabled />);

    expect(badgeControl()).toBeUndefined();
  });

  it('renders the badge when a badge state is given', () => {
    render(<P1EditorSubheader {...defaultProps} badgeDocState="unpublished" />);

    expect(badgeControl()).toBeDefined();
  });
});
