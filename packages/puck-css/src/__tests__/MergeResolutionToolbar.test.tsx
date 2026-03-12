/**
 * MergeResolutionToolbar Tests
 *
 * Tests for the toolbar component - progress display, bulk actions,
 * and execute merge button state.
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

  it('shows branch direction label', () => {
    render(<MergeResolutionToolbar {...defaultProps} />);

    expect(screen.getByText(/my-feature/)).toBeDefined();
    // The branch label contains "my-feature → Live"
    expect(screen.getByText(/my-feature → Live/)).toBeDefined();
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
});
