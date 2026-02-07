/**
 * Phase 2 Deferred: MergePreviewPanel DocumentChangeSummary Tests (TDD)
 *
 * Tests that the MergePreviewPanel renders DocumentChangeSummary
 * when sourceChanges/targetChanges data is available.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MergePreviewPanel } from '../../components/MergePreviewPanel';

// Mock the design toolkit
vi.mock('@pantheon-systems/design-toolkit-react', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as string}</button>
  ),
  Alert: ({ children, ...props }: Record<string, unknown>) => (
    <div role="alert" {...props}>{children as string}</div>
  ),
}));

// Mock the previewMerge API call
vi.mock('../../api/merge-requests', () => ({
  previewMerge: vi.fn().mockResolvedValue({
    canMerge: true,
    hasConflicts: false,
    conflicts: { documentConflicts: [], structureConflicts: [] },
    sourceChanges: [
      {
        documentId: 'doc-1',
        documentPath: '/pages/new-page',
        latestVersionId: 'v1',
        latestVersionNumber: 1,
        baseVersionId: null,
        baseVersionNumber: null,
      },
    ],
    targetChanges: [
      {
        documentId: 'doc-2',
        documentPath: '/pages/updated-page',
        latestVersionId: 'v2',
        latestVersionNumber: 2,
        baseVersionId: 'v1',
        baseVersionNumber: 1,
      },
    ],
  }),
}));

describe('MergePreviewPanel - DocumentChangeSummary', () => {
  it('should show document change summary when data is available', async () => {
    render(
      <MergePreviewPanel
        siteId="site-1"
        sourceBranchId="source-branch"
        targetBranchId="target-branch"
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Wait for the preview to load
    await waitFor(() => {
      expect(screen.getByText(/can be merged/i)).toBeInTheDocument();
    });

    // Should show the document change summary section
    expect(screen.getByText(/new-page/)).toBeInTheDocument();
    expect(screen.getByText(/updated-page/)).toBeInTheDocument();
  });
});
