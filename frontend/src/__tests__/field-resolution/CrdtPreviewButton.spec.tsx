/**
 * Phase 3b: Field-Level Conflict Resolution - CrdtPreviewButton Tests (TDD)
 *
 * Tests for the "Try auto-merge" button that calls the CRDT merge API
 * and shows the result for review.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CrdtPreviewButton } from '../../components/field-resolution/CrdtPreviewButton';

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
    // Mock fetch to delay
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(
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

    globalThis.fetch = originalFetch;
  });

  it('should call onResult with merged data on success', async () => {
    const mergedSnapshot = { title: 'CRDT Merged', body: 'Merged content' };
    const onResult = vi.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ snapshot: mergedSnapshot }),
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

    globalThis.fetch = originalFetch;
  });

  it('should show error message on failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'CRDT merge failed' }),
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
      expect(screen.getByText(/failed|error/i)).toBeInTheDocument();
    });

    globalThis.fetch = originalFetch;
  });
});
