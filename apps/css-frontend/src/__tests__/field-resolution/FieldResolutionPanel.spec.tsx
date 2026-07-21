/**
 * Phase 3b: Field-Level Conflict Resolution - FieldResolutionPanel Tests (TDD)
 *
 * Tests for the main resolution UI that shows auto-merged fields,
 * conflicts with options, and a preview of the result.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldResolutionPanel } from '../../components/field-resolution/FieldResolutionPanel';

describe('FieldResolutionPanel', () => {
  const baseSnapshot = { title: 'Original', body: 'Original Body', status: 'draft' };
  const sourceSnapshot = { title: 'Source Title', body: 'Original Body', status: 'published' };
  const targetSnapshot = { title: 'Target Title', body: 'Updated Body', status: 'draft' };

  it('should show auto-merged fields that are pre-selected', () => {
    render(
      <FieldResolutionPanel
        sourceSnapshot={sourceSnapshot}
        targetSnapshot={targetSnapshot}
        baseSnapshot={baseSnapshot}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    // body changed only in target -> auto-merged
    // status changed only in source -> auto-merged
    expect(screen.getByText(/auto/i)).toBeInTheDocument();
  });

  it('should show conflicts with resolution options', () => {
    render(
      <FieldResolutionPanel
        sourceSnapshot={sourceSnapshot}
        targetSnapshot={targetSnapshot}
        baseSnapshot={baseSnapshot}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    // title changed in both -> conflict
    // Should show options for resolving
    const radioButtons = screen.getAllByRole('radio');
    expect(radioButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('should call onResolve with merged snapshot when apply is clicked', () => {
    const onResolve = vi.fn();

    render(
      <FieldResolutionPanel
        sourceSnapshot={sourceSnapshot}
        targetSnapshot={targetSnapshot}
        baseSnapshot={baseSnapshot}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={onResolve}
      />
    );

    // Select a resolution for the conflicting field
    const radioButtons = screen.getAllByRole('radio');
    fireEvent.click(radioButtons[0]); // Select first option

    // Click apply
    const applyButton = screen.getByRole('button', { name: /apply/i });
    fireEvent.click(applyButton);

    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.any(String),
      }),
    );
  });

  it('should show source and target branch names in options', () => {
    render(
      <FieldResolutionPanel
        sourceSnapshot={sourceSnapshot}
        targetSnapshot={targetSnapshot}
        baseSnapshot={baseSnapshot}
        sourceBranchName="feature-branch"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    expect(screen.getByText(/feature-branch/)).toBeInTheDocument();
    expect(screen.getByText(/main/)).toBeInTheDocument();
  });

  it('should work without a base snapshot', () => {
    // Without base, all differing fields are conflicts
    const source = { title: 'Source', body: 'Same' };
    const target = { title: 'Target', body: 'Same' };

    render(
      <FieldResolutionPanel
        sourceSnapshot={source}
        targetSnapshot={target}
        baseSnapshot={null}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    // title differs -> should be shown as conflict
    const radioButtons = screen.getAllByRole('radio');
    expect(radioButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('should disable apply button until all conflicts are resolved', () => {
    render(
      <FieldResolutionPanel
        sourceSnapshot={sourceSnapshot}
        targetSnapshot={targetSnapshot}
        baseSnapshot={baseSnapshot}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    const applyButton = screen.getByRole('button', { name: /apply/i });
    expect(applyButton).toBeDisabled();
  });
});
