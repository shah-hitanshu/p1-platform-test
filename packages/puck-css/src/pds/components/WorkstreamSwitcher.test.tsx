/**
 * Tests for <WorkstreamSwitcher> component.
 *
 * Validates trigger button display, "live" label for main branch, dropdown
 * open/close behavior, branch listing, switch callback, "Compare with Live"
 * conditional rendering and callback, search input, and the "New workstream"
 * create form flow.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Branch } from '@pantheon-systems/css-client';
import { WorkstreamSwitcher } from './WorkstreamSwitcher.js';

// =============================================================================
// Mock Data
// =============================================================================

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: overrides.id ?? 'branch-1',
    siteId: overrides.siteId ?? 'site-abc',
    name: overrides.name ?? 'feature/my-branch',
    isMain: overrides.isMain ?? false,
    status: overrides.status ?? 'active',
    sourceBranchId: overrides.sourceBranchId ?? null,
    sourceCheckpointId: overrides.sourceCheckpointId ?? null,
    createdById: overrides.createdById ?? 'user-1',
    createdByType: overrides.createdByType ?? 'user',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    ...overrides,
  };
}

const mainBranch = makeBranch({ id: 'main', name: 'main', isMain: true });
const featureBranch = makeBranch({ id: 'feat-1', name: 'feature/homepage-refresh' });
const otherBranch = makeBranch({ id: 'feat-2', name: 'feature/pricing-update' });

const allBranches: Branch[] = [mainBranch, featureBranch, otherBranch];

describe('WorkstreamSwitcher', () => {
  const defaultProps = {
    branches: allBranches,
    currentBranch: featureBranch,
    onSwitch: vi.fn(),
    onCompareWithLive: vi.fn(),
  };

  // ---------------------------------------------------------------------------
  // Trigger button
  // ---------------------------------------------------------------------------

  it('displays the current branch name in the trigger button', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    const trigger = screen.getByTestId('workstream-trigger');
    expect(trigger).toBeDefined();
    expect(trigger.textContent).toContain('feature/homepage-refresh');
  });

  it('displays "Live" in the trigger button when on the main branch', () => {
    render(
      <WorkstreamSwitcher
        {...defaultProps}
        currentBranch={mainBranch}
      />
    );

    const trigger = screen.getByTestId('workstream-trigger');
    expect(trigger.textContent).toContain('Live');
  });

  // ---------------------------------------------------------------------------
  // Live label
  // ---------------------------------------------------------------------------

  it('shows a "live" label for the main branch in the branch list', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    fireEvent.click(screen.getByTestId('workstream-trigger'));

    const liveLabel = screen.getByTestId('workstream-live-label');
    expect(liveLabel).toBeDefined();
  });

  it('does not show a "live" label for non-main branches', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    fireEvent.click(screen.getByTestId('workstream-trigger'));

    const liveLabels = screen.getAllByTestId('workstream-live-label');
    expect(liveLabels).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Dropdown open/close
  // ---------------------------------------------------------------------------

  it('dropdown is not visible before trigger is clicked', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    expect(screen.queryByTestId('workstream-dropdown')).toBeNull();
  });

  it('clicking the trigger opens the dropdown', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    fireEvent.click(screen.getByTestId('workstream-trigger'));

    expect(screen.getByTestId('workstream-dropdown')).toBeDefined();
  });

  it('clicking the close button inside the dropdown closes it', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    fireEvent.click(screen.getByTestId('workstream-trigger'));
    expect(screen.getByTestId('workstream-dropdown')).toBeDefined();

    fireEvent.click(screen.getByTestId('workstream-close'));
    expect(screen.queryByTestId('workstream-dropdown')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Branch listing
  // ---------------------------------------------------------------------------

  it('dropdown lists all branches', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    fireEvent.click(screen.getByTestId('workstream-trigger'));

    const dropdown = screen.getByTestId('workstream-dropdown');
    // Scope to dropdown to avoid matching the trigger button text
    expect(within(dropdown).getByText('Live')).toBeDefined();
    expect(within(dropdown).getByText('feature/homepage-refresh')).toBeDefined();
    expect(within(dropdown).getByText('feature/pricing-update')).toBeDefined();
  });

  it('main branch appears first in the dropdown list regardless of array order', () => {
    const branchesMainLast = [featureBranch, otherBranch, mainBranch];
    render(
      <WorkstreamSwitcher
        {...defaultProps}
        branches={branchesMainLast}
      />
    );

    fireEvent.click(screen.getByTestId('workstream-trigger'));

    const list = screen.getByTestId('workstream-list');
    const branchButtons = within(list).getAllByRole('button');
    expect(branchButtons[0].textContent).toContain('Live');
  });

  it('main branch displays "Live" as its label in the dropdown list, not its name', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    fireEvent.click(screen.getByTestId('workstream-trigger'));

    expect(screen.getByText('Live')).toBeDefined();
    expect(screen.queryByText('main')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // onSwitch callback
  // ---------------------------------------------------------------------------

  it('clicking a non-current branch calls onSwitch with that branch id', () => {
    const onSwitch = vi.fn();
    render(
      <WorkstreamSwitcher
        {...defaultProps}
        onSwitch={onSwitch}
      />
    );

    fireEvent.click(screen.getByTestId('workstream-trigger'));
    fireEvent.click(screen.getByText('feature/pricing-update'));

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith('feat-2');
  });

  it('clicking the current branch does not call onSwitch', () => {
    const onSwitch = vi.fn();
    render(
      <WorkstreamSwitcher
        {...defaultProps}
        onSwitch={onSwitch}
      />
    );

    fireEvent.click(screen.getByTestId('workstream-trigger'));
    // Scope to dropdown to avoid ambiguity with the trigger button text
    const dropdown = screen.getByTestId('workstream-dropdown');
    fireEvent.click(within(dropdown).getByText('feature/homepage-refresh'));

    expect(onSwitch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // "Compare with Live" button
  // ---------------------------------------------------------------------------

  it('renders "Compare with Live" button when current branch is not main', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    expect(screen.getByTestId('compare-with-live')).toBeDefined();
  });

  it('does not render "Compare with Live" button when on the main branch', () => {
    render(
      <WorkstreamSwitcher
        {...defaultProps}
        currentBranch={mainBranch}
      />
    );

    expect(screen.queryByTestId('compare-with-live')).toBeNull();
  });

  it('clicking "Compare with Live" calls onCompareWithLive', () => {
    const onCompareWithLive = vi.fn();
    render(
      <WorkstreamSwitcher
        {...defaultProps}
        onCompareWithLive={onCompareWithLive}
      />
    );

    fireEvent.click(screen.getByTestId('compare-with-live'));
    expect(onCompareWithLive).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Search input
  // ---------------------------------------------------------------------------

  it('dropdown contains a search input', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    fireEvent.click(screen.getByTestId('workstream-trigger'));

    expect(screen.getByTestId('workstream-search')).toBeDefined();
  });

  it('search input filters the branch list', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);

    fireEvent.click(screen.getByTestId('workstream-trigger'));

    const search = screen.getByTestId('workstream-search');
    fireEvent.change(search, { target: { value: 'pricing' } });

    const dropdown = screen.getByTestId('workstream-dropdown');
    expect(within(dropdown).getByText('feature/pricing-update')).toBeDefined();
    expect(within(dropdown).queryByText('feature/homepage-refresh')).toBeNull();
  });
});

// =============================================================================
// New workstream create form
// =============================================================================

describe('WorkstreamSwitcher — New workstream', () => {
  const defaultProps = {
    branches: allBranches,
    currentBranch: featureBranch,
    onSwitch: vi.fn(),
    onCompareWithLive: vi.fn(),
  };

  it('renders "New workstream" button in the dropdown footer', () => {
    render(<WorkstreamSwitcher {...defaultProps} onCreateBranch={vi.fn()} />);
    fireEvent.click(screen.getByTestId('workstream-trigger'));
    expect(screen.getByTestId('workstream-new')).toBeDefined();
  });

  it('renders "New workstream" button even without onCreateBranch', () => {
    render(<WorkstreamSwitcher {...defaultProps} />);
    fireEvent.click(screen.getByTestId('workstream-trigger'));
    expect(screen.getByTestId('workstream-new')).toBeDefined();
  });

  it('clicking "New workstream" shows the create form', () => {
    render(<WorkstreamSwitcher {...defaultProps} onCreateBranch={vi.fn()} />);
    fireEvent.click(screen.getByTestId('workstream-trigger'));
    fireEvent.click(screen.getByTestId('workstream-new'));
    expect(screen.getByTestId('workstream-create-form')).toBeDefined();
  });

  it('create form has a name input and Create/Cancel buttons', () => {
    render(<WorkstreamSwitcher {...defaultProps} onCreateBranch={vi.fn()} />);
    fireEvent.click(screen.getByTestId('workstream-trigger'));
    fireEvent.click(screen.getByTestId('workstream-new'));
    expect(screen.getByTestId('workstream-create-input')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDefined();
    expect(screen.getByTestId('workstream-create-cancel')).toBeDefined();
  });

  it('submitting the form calls onCreateBranch with the entered name', async () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    render(<WorkstreamSwitcher {...defaultProps} onCreateBranch={onCreateBranch} />);
    fireEvent.click(screen.getByTestId('workstream-trigger'));
    fireEvent.click(screen.getByTestId('workstream-new'));
    fireEvent.change(screen.getByTestId('workstream-create-input'), {
      target: { value: 'my-feature' },
    });
    fireEvent.submit(screen.getByTestId('workstream-create-form'));
    await waitFor(() => expect(onCreateBranch).toHaveBeenCalledWith('my-feature'));
  });

  it('hides the form and resets to "New workstream" button after successful create', async () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    render(<WorkstreamSwitcher {...defaultProps} onCreateBranch={onCreateBranch} />);
    fireEvent.click(screen.getByTestId('workstream-trigger'));
    fireEvent.click(screen.getByTestId('workstream-new'));
    fireEvent.change(screen.getByTestId('workstream-create-input'), {
      target: { value: 'my-feature' },
    });
    fireEvent.submit(screen.getByTestId('workstream-create-form'));
    await waitFor(() => expect(screen.queryByTestId('workstream-create-form')).toBeNull());
    expect(screen.getByTestId('workstream-new')).toBeDefined();
  });

  it('cancelling the form returns to the "New workstream" button', () => {
    render(<WorkstreamSwitcher {...defaultProps} onCreateBranch={vi.fn()} />);
    fireEvent.click(screen.getByTestId('workstream-trigger'));
    fireEvent.click(screen.getByTestId('workstream-new'));
    fireEvent.click(screen.getByTestId('workstream-create-cancel'));
    expect(screen.queryByTestId('workstream-create-form')).toBeNull();
    expect(screen.getByTestId('workstream-new')).toBeDefined();
  });

  it('shows an error message when onCreateBranch rejects', async () => {
    const onCreateBranch = vi.fn().mockRejectedValue(new Error('Name taken'));
    render(<WorkstreamSwitcher {...defaultProps} onCreateBranch={onCreateBranch} />);
    fireEvent.click(screen.getByTestId('workstream-trigger'));
    fireEvent.click(screen.getByTestId('workstream-new'));
    fireEvent.change(screen.getByTestId('workstream-create-input'), {
      target: { value: 'taken' },
    });
    fireEvent.submit(screen.getByTestId('workstream-create-form'));
    await waitFor(() => expect(screen.getByTestId('workstream-create-error')).toBeDefined());
    expect(screen.getByTestId('workstream-create-error').textContent).toContain('Name taken');
  });

  it('does not call onCreateBranch when the name input is empty', async () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    render(<WorkstreamSwitcher {...defaultProps} onCreateBranch={onCreateBranch} />);
    fireEvent.click(screen.getByTestId('workstream-trigger'));
    fireEvent.click(screen.getByTestId('workstream-new'));
    fireEvent.submit(screen.getByTestId('workstream-create-form'));
    // Give async handlers a chance to run
    await waitFor(() => expect(onCreateBranch).not.toHaveBeenCalled());
  });
});
