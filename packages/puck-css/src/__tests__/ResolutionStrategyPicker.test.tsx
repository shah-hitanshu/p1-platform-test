/**
 * ResolutionStrategyPicker Tests
 *
 * Tests for the strategy picker button group - rendering, click handling,
 * and disabled states for delete-type conflicts.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResolutionStrategyPicker } from '../components/merge-resolution/ResolutionStrategyPicker.js';

describe('ResolutionStrategyPicker', () => {
  it('renders three strategy buttons', () => {
    render(
      <ResolutionStrategyPicker
        currentStrategy="unresolved"
        conflictType="both-modified"
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText('Accept Draft')).toBeDefined();
    expect(screen.getByText('Accept Live')).toBeDefined();
    expect(screen.getByText('Cherry-pick')).toBeDefined();
  });

  it('highlights selected strategy', () => {
    render(
      <ResolutionStrategyPicker
        currentStrategy="accept-draft"
        conflictType="both-modified"
        onSelect={vi.fn()}
      />
    );

    const draftBtn = screen.getByText('Accept Draft').closest('button');
    expect(draftBtn?.getAttribute('aria-pressed')).toBe('true');

    const liveBtn = screen.getByText('Accept Live').closest('button');
    expect(liveBtn?.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onSelect with strategy on click', () => {
    const onSelect = vi.fn();
    render(
      <ResolutionStrategyPicker
        currentStrategy="unresolved"
        conflictType="both-modified"
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByText('Accept Draft'));
    expect(onSelect).toHaveBeenCalledWith('accept-draft');

    fireEvent.click(screen.getByText('Accept Live'));
    expect(onSelect).toHaveBeenCalledWith('accept-live');

    fireEvent.click(screen.getByText('Cherry-pick'));
    expect(onSelect).toHaveBeenCalledWith('cherry-pick');
  });

  it('disables Cherry-pick for deleted-in-source', () => {
    const onSelect = vi.fn();
    render(
      <ResolutionStrategyPicker
        currentStrategy="unresolved"
        conflictType="deleted-in-source"
        onSelect={onSelect}
      />
    );

    const cherryPickBtn = screen.getByText('Cherry-pick').closest('button');

    expect(cherryPickBtn?.disabled).toBe(true);

    // Clicking disabled button should not invoke onSelect
    fireEvent.click(cherryPickBtn!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables Cherry-pick for deleted-in-target', () => {
    const onSelect = vi.fn();
    render(
      <ResolutionStrategyPicker
        currentStrategy="unresolved"
        conflictType="deleted-in-target"
        onSelect={onSelect}
      />
    );

    const cherryPickBtn = screen.getByText('Cherry-pick').closest('button');

    expect(cherryPickBtn?.disabled).toBe(true);

    fireEvent.click(cherryPickBtn!);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
