/**
 * Feature actions in the editor toolbar
 *
 * The toolbar renders controls a feature hands it without knowing what they
 * are, which is how a feature reaches the toolbar without the toolbar
 * importing it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { P1EditorSubheader } from './P1EditorSubheader.js';

vi.mock('./AgentChip.js', () => ({
  AgentChip: () => <div data-testid="agent-chip" />,
}));

vi.mock('./PublishControl.js', () => ({
  PublishControl: () => <div data-testid="publish-control" />,
}));

vi.mock('./WorkstreamSwitcher.js', () => ({
  WorkstreamSwitcher: () => <div data-testid="workstream-trigger" />,
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
  docState: 'modified' as const,
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

describe('P1EditorSubheader feature actions', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a control a feature contributes', () => {
    render(
      <P1EditorSubheader
        {...defaultProps}
        featureActions={<button type="button">Locales</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Locales' })).toBeDefined();
  });

  it('renders every contributed control, in the order given', () => {
    render(
      <P1EditorSubheader
        {...defaultProps}
        featureActions={
          <>
            <button type="button">First</button>
            <button type="button">Second</button>
          </>
        }
      />,
    );

    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => t === 'First' || t === 'Second');
    expect(labels).toEqual(['First', 'Second']);
  });

  it('places contributed controls in the toolbar, not the header', () => {
    render(
      <P1EditorSubheader
        {...defaultProps}
        featureActions={<button type="button">Locales</button>}
      />,
    );

    const slot = screen.getByTestId('toolbar-feature-actions');
    expect(slot.contains(screen.getByRole('button', { name: 'Locales' }))).toBe(true);
  });

  it('renders the toolbar when no feature contributes one', () => {
    render(<P1EditorSubheader {...defaultProps} />);

    expect(screen.getByTestId('p1-editor-subheader')).toBeDefined();
    expect(screen.queryByTestId('toolbar-feature-actions')).toBeNull();
  });

  it('leaves the slot empty when every control it holds renders nothing', () => {
    // Controls self-gate, so a contributed control that renders nothing leaves
    // the container childless. `.featureActions:empty` is what keeps it and the
    // rule beside it from taking toolbar room, and that hinges on this staying
    // true — a placeholder wrapper here would defeat it.
    const Silent = (): null => null;
    render(
      <P1EditorSubheader
        {...defaultProps}
        featureActions={
          <>
            <Silent />
            <Silent />
          </>
        }
      />,
    );

    expect(screen.getByTestId('toolbar-feature-actions')).toBeEmptyDOMElement();
  });
});
