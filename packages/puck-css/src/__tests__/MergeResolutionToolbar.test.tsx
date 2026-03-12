/**
 * MergeResolutionToolbar Tests
 *
 * Tests for the toolbar component - progress display, bulk actions,
 * execute merge button state, confirmation flow, progress bar,
 * keyboard shortcut hints, and branch label format.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MergeResolutionToolbar } from '../components/merge-resolution/MergeResolutionToolbar.js';

describe('MergeResolutionToolbar', () => {
  const defaultProps = {
    sourceBranchName: 'my-feature',
    targetBranchName: 'Live',
    resolvedCount: 3,
    totalCount: 12,
    allResolved: false,
    mergeExecuting: false,
    onClose: vi.fn(),
    onExecuteMerge: vi.fn(),
    onSetAllStrategy: vi.fn(),
  };

  it('shows progress as X of Y resolved', () => {
    render(<MergeResolutionToolbar {...defaultProps} />);

    expect(screen.getByText(/3 of 12 resolved/)).toBeDefined();
  });

  it('shows branch direction label in Draft (branch-name) -> Live format', () => {
    render(<MergeResolutionToolbar {...defaultProps} />);

    expect(screen.getByText(/Draft \(my-feature\) → Live/)).toBeDefined();
  });

  it('renders a progress bar with correct percentage', () => {
    render(<MergeResolutionToolbar {...defaultProps} />);

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeDefined();
    expect(progressBar.getAttribute('aria-valuenow')).toBe('25');
  });

  it('Execute Merge button disabled when not all resolved', () => {
    render(<MergeResolutionToolbar {...defaultProps} />);

    const executeBtn = screen.getByText('Execute merge');
    expect(executeBtn.closest('button')?.disabled).toBe(true);
  });

  it('Execute Merge button enabled when all resolved', () => {
    render(
      <MergeResolutionToolbar
        {...defaultProps}
        allResolved={true}
        resolvedCount={12}
      />
    );

    const executeBtn = screen.getByText('Execute merge');
    expect(executeBtn.closest('button')?.disabled).toBe(false);
  });

  it('shows inline confirmation before executing merge', () => {
    const onExecuteMerge = vi.fn();
    render(
      <MergeResolutionToolbar
        {...defaultProps}
        allResolved={true}
        resolvedCount={12}
        onExecuteMerge={onExecuteMerge}
      />
    );

    // Click Execute merge
    fireEvent.click(screen.getByText('Execute merge'));
    // Should not call onExecuteMerge yet
    expect(onExecuteMerge).not.toHaveBeenCalled();

    // Should show confirmation
    expect(screen.getByText('Are you sure?')).toBeDefined();
    expect(screen.getByText('Confirm merge')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();

    // Click Confirm merge
    fireEvent.click(screen.getByText('Confirm merge'));
    expect(onExecuteMerge).toHaveBeenCalledTimes(1);
  });

  it('cancel confirmation hides the confirm UI', () => {
    render(
      <MergeResolutionToolbar
        {...defaultProps}
        allResolved={true}
        resolvedCount={12}
      />
    );

    fireEvent.click(screen.getByText('Execute merge'));
    expect(screen.getByText('Are you sure?')).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));
    // Should be back to normal Execute merge button
    expect(screen.getByText('Execute merge')).toBeDefined();
    expect(screen.queryByText('Are you sure?')).toBeNull();
  });

  it('bulk action buttons call setAllStrategy', () => {
    const onSetAllStrategy = vi.fn();
    render(
      <MergeResolutionToolbar
        {...defaultProps}
        onSetAllStrategy={onSetAllStrategy}
      />
    );

    fireEvent.click(screen.getByText('Accept all as Draft'));
    expect(onSetAllStrategy).toHaveBeenCalledWith('accept-draft');

    fireEvent.click(screen.getByText('Accept all as Live'));
    expect(onSetAllStrategy).toHaveBeenCalledWith('accept-live');
  });

  it('shows remaining strategy buttons when onSetRemainingStrategy provided', () => {
    const onSetRemainingStrategy = vi.fn();
    render(
      <MergeResolutionToolbar
        {...defaultProps}
        onSetRemainingStrategy={onSetRemainingStrategy}
      />
    );

    fireEvent.click(screen.getByText('Accept remaining as Draft'));
    expect(onSetRemainingStrategy).toHaveBeenCalledWith('accept-draft');

    fireEvent.click(screen.getByText('Accept remaining as Live'));
    expect(onSetRemainingStrategy).toHaveBeenCalledWith('accept-live');
  });

  it('does not show remaining strategy buttons when prop is not provided', () => {
    render(<MergeResolutionToolbar {...defaultProps} />);

    expect(screen.queryByText('Accept remaining as Draft')).toBeNull();
    expect(screen.queryByText('Accept remaining as Live')).toBeNull();
  });

  it('shows keyboard shortcuts when toggle clicked', () => {
    render(<MergeResolutionToolbar {...defaultProps} />);

    // Shortcuts should not be visible initially
    expect(screen.queryByTestId('keyboard-shortcuts')).toBeNull();

    // Click toggle
    fireEvent.click(screen.getByText('Keyboard shortcuts'));

    // Shortcuts should now be visible
    expect(screen.getByTestId('keyboard-shortcuts')).toBeDefined();
    expect(screen.getByText('Next document')).toBeDefined();
    expect(screen.getByText('Next unresolved')).toBeDefined();
  });
});
