/**
 * CrdtPreviewButton Tests
 *
 * Tests for the "Try auto-merge" button that calls the CRDT merge preview API
 * and shows the result for review.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CrdtPreviewButton } from '../../components/field-resolution/CrdtPreviewButton';

// Mock the API module
vi.mock('../../api/merge-requests', () => ({
  previewCrdtMerge: vi.fn(),
}));

import { previewCrdtMerge } from '../../api/merge-requests';

describe('CrdtPreviewButton', () => {
  it('should render a button to try auto-merge', () => {
    render(
      <CrdtPreviewButton
        siteId="site-1"
        documentId="doc-1"
        sourceBranchId="source-branch"
        targetBranchId="target-branch"
        onResult={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: /auto-merge/i });
    expect(button).toBeInTheDocument();
  });

  it('should show loading state while fetching', async () => {
    // Mock to never resolve
    vi.mocked(previewCrdtMerge).mockImplementation(
      () => new Promise(() => {/* never resolves */}),
    );

    render(
      <CrdtPreviewButton
        siteId="site-1"
        documentId="doc-1"
        sourceBranchId="source-branch"
        targetBranchId="target-branch"
        onResult={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: /auto-merge/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/loading|merging/i)).toBeInTheDocument();
    });
  });

  it('should call the correct API endpoint with documentId in the body', async () => {
    const mergedSnapshot = { title: 'CRDT Merged', body: 'Merged content' };

    vi.mocked(previewCrdtMerge).mockResolvedValueOnce({
      success: true,
      snapshot: mergedSnapshot,
    });

    render(
      <CrdtPreviewButton
        siteId="site-1"
        documentId="doc-1"
        sourceBranchId="source-branch"
        targetBranchId="target-branch"
        onResult={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: /auto-merge/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(previewCrdtMerge).toHaveBeenCalledWith('site-1', {
        documentId: 'doc-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
      });
    });
  });

  it('should call onResult with merged data on success', async () => {
    const mergedSnapshot = { title: 'CRDT Merged', body: 'Merged content' };
    const onResult = vi.fn();

    vi.mocked(previewCrdtMerge).mockResolvedValueOnce({
      success: true,
      snapshot: mergedSnapshot,
    });

    render(
      <CrdtPreviewButton
        siteId="site-1"
        documentId="doc-1"
        sourceBranchId="source-branch"
        targetBranchId="target-branch"
        onResult={onResult}
      />
    );

    const button = screen.getByRole('button', { name: /auto-merge/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(mergedSnapshot);
    });
  });

  it('should show error message on failure', async () => {
    vi.mocked(previewCrdtMerge).mockRejectedValueOnce(new Error('Network error'));

    render(
      <CrdtPreviewButton
        siteId="site-1"
        documentId="doc-1"
        sourceBranchId="source-branch"
        targetBranchId="target-branch"
        onResult={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: /auto-merge/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/unable to auto-merge/i)).toBeInTheDocument();
    });
  });

  it('should show error when API returns success: false', async () => {
    vi.mocked(previewCrdtMerge).mockResolvedValueOnce({
      success: false,
      snapshot: {},
      error: 'CRDT merge failed',
    });

    render(
      <CrdtPreviewButton
        siteId="site-1"
        documentId="doc-1"
        sourceBranchId="source-branch"
        targetBranchId="target-branch"
        onResult={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: /auto-merge/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/CRDT merge failed/i)).toBeInTheDocument();
    });
  });
});
