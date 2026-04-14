/**
 * ExpandableConflictRow CRDT Preview Tests (TDD)
 *
 * Tests for the CRDT merge preview flow within the conflict row:
 * - Shows "Try auto-merge" button when CRDT merge selected
 * - Shows preview after button click succeeds
 * - "Accept" changes strategy to manual and sets resolvedSnapshot
 * - "Reject" clears preview
 * - Changing resolution strategy clears preview
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExpandableConflictRow } from '../../components/ExpandableConflictRow';
import type { DocumentConflict, DocumentDiff } from '../../types';

// Mock the design toolkit Button
vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  Spinner: ({ label, ...props }: Record<string, unknown>) => (
    <div role="status" aria-label={label as string} {...props} />
  ),
  Button: ({ label, children, onClick, disabled, isLoading, ...props }: Record<string, unknown>) => (
    <button
      
      onClick={onClick as () => void}
      disabled={(disabled as boolean) || (isLoading as boolean)}
      {...props}
    >
      {(label as string) || (children as React.ReactNode)}
    </button>
  ),
}));

// Mock the CRDT preview API
vi.mock('../../api/merge-requests', () => ({
  previewCrdtMerge: vi.fn(),
}));

import { previewCrdtMerge } from '../../api/merge-requests';

const bothModifiedConflict: DocumentConflict = {
  documentId: 'doc-1',
  documentPath: '/pages/home',
  conflictType: 'both-modified',
  sourceVersion: 3,
  targetVersion: 2,
};

const diff: DocumentDiff = {
  documentId: 'doc-1',
  documentPath: '/pages/home',
  sourceSnapshot: { title: 'Source Title', body: 'Source Body' },
  targetSnapshot: { title: 'Target Title', body: 'Target Body' },
  diffOperations: [
    { op: 'replace', path: '/title', value: 'Source Title' },
  ],
};

describe('ExpandableConflictRow - CRDT preview flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show "Try auto-merge" button when CRDT merge is selected and row is expanded', () => {
    render(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="merge-crdt"
        onResolutionChange={vi.fn()}
        siteId="site-1"
        sourceBranchId="branch-source"
        targetBranchId="branch-target"
      />
    );

    expect(screen.getByRole('button', { name: /auto-merge/i })).toBeInTheDocument();
  });

  it('should not show "Try auto-merge" button when a different strategy is selected', () => {
    render(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="take-source"
        onResolutionChange={vi.fn()}
        siteId="site-1"
        sourceBranchId="branch-source"
        targetBranchId="branch-target"
      />
    );

    expect(screen.queryByRole('button', { name: /auto-merge/i })).not.toBeInTheDocument();
  });

  it('should show preview content after successful auto-merge', async () => {
    const mergedSnapshot = { title: 'Merged Title', body: 'Merged Body' };

    vi.mocked(previewCrdtMerge).mockResolvedValueOnce({
      success: true,
      snapshot: mergedSnapshot,
    });

    render(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="merge-crdt"
        onResolutionChange={vi.fn()}
        siteId="site-1"
        sourceBranchId="branch-source"
        targetBranchId="branch-target"
      />
    );

    // Click "Try auto-merge"
    fireEvent.click(screen.getByRole('button', { name: /auto-merge/i }));

    // Wait for preview to appear
    await waitFor(() => {
      expect(screen.getByText(/auto-merge preview/i)).toBeInTheDocument();
    });

    // Accept and Reject buttons should appear
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
  });

  it('should change strategy to manual and set resolvedSnapshot when Accept is clicked', async () => {
    const mergedSnapshot = { title: 'Merged Title', body: 'Merged Body' };
    const onResolutionChange = vi.fn();
    const onResolvedSnapshot = vi.fn();

    vi.mocked(previewCrdtMerge).mockResolvedValueOnce({
      success: true,
      snapshot: mergedSnapshot,
    });

    render(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="merge-crdt"
        onResolutionChange={onResolutionChange}
        onResolvedSnapshot={onResolvedSnapshot}
        siteId="site-1"
        sourceBranchId="branch-source"
        targetBranchId="branch-target"
      />
    );

    // Click "Try auto-merge"
    fireEvent.click(screen.getByRole('button', { name: /auto-merge/i }));

    // Wait for preview
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    });

    // Click "Accept"
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    // Should change resolution to manual with the previewed snapshot
    expect(onResolutionChange).toHaveBeenCalledWith('manual');
    expect(onResolvedSnapshot).toHaveBeenCalledWith(mergedSnapshot);
  });

  it('should clear preview when Reject is clicked', async () => {
    const mergedSnapshot = { title: 'Merged Title', body: 'Merged Body' };

    vi.mocked(previewCrdtMerge).mockResolvedValueOnce({
      success: true,
      snapshot: mergedSnapshot,
    });

    render(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="merge-crdt"
        onResolutionChange={vi.fn()}
        siteId="site-1"
        sourceBranchId="branch-source"
        targetBranchId="branch-target"
      />
    );

    // Click "Try auto-merge"
    fireEvent.click(screen.getByRole('button', { name: /auto-merge/i }));

    // Wait for preview
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    });

    // Click "Reject"
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));

    // Preview should be cleared, "Try auto-merge" button should reappear
    await waitFor(() => {
      expect(screen.queryByText(/auto-merge preview/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /auto-merge/i })).toBeInTheDocument();
    });
  });

  it('should show "Auto-merge accepted" indicator after acceptance', async () => {
    const mergedSnapshot = { title: 'Merged Title', body: 'Merged Body' };
    const onResolutionChange = vi.fn();
    const onResolvedSnapshot = vi.fn();

    vi.mocked(previewCrdtMerge).mockResolvedValueOnce({
      success: true,
      snapshot: mergedSnapshot,
    });

    const { rerender } = render(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="merge-crdt"
        onResolutionChange={onResolutionChange}
        onResolvedSnapshot={onResolvedSnapshot}
        siteId="site-1"
        sourceBranchId="branch-source"
        targetBranchId="branch-target"
      />
    );

    // Click "Try auto-merge"
    fireEvent.click(screen.getByRole('button', { name: /auto-merge/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    });

    // Click "Accept"
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    // Re-render with updated resolution (simulating parent state update)
    rerender(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="manual"
        onResolutionChange={onResolutionChange}
        onResolvedSnapshot={onResolvedSnapshot}
        siteId="site-1"
        sourceBranchId="branch-source"
        targetBranchId="branch-target"
      />
    );

    // Should show accepted indicator
    expect(screen.getByText(/auto-merge accepted/i)).toBeInTheDocument();
  });
});
