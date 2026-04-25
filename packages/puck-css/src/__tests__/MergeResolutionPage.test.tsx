/**
 * MergeResolutionPage Tests
 *
 * Integration tests for the page component - layout rendering,
 * child component composition, config threading, and diff computation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PuckData } from '@pantheon/css-client';

// Mock Puck's Render component
vi.mock('@puckeditor/core', () => ({
  Render: ({ data }: { data: PuckData }) => (
    <div data-testid="puck-render">
      {data.content.map((c, i) => (
        <div key={i} data-component-type={c.type}>
          {c.type}: {String(c.props.text ?? c.props.id)}
        </div>
      ))}
    </div>
  ),
}));

// Mock the useMergeResolution hook
const mockLoadPreview = vi.fn();
const mockExecuteMerge = vi.fn();
const mockOnClose = vi.fn();
const mockOnMergeComplete = vi.fn();

const sourceSnapshot: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Source Title' } },
  ],
  root: { props: {} },
};

const targetSnapshot: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Target Title' } },
  ],
  root: { props: {} },
};

const defaultHookReturn = {
  documents: [
    {
      documentId: 'doc-1',
      documentPath: '/home',
      strategy: 'unresolved' as const,
      changeType: 'conflicting' as const,
      cherryPickSelections: {},
      mergedSnapshot: null,
      sourceSnapshot,
      targetSnapshot,
      conflictType: 'both-modified' as const,
      classifiedFields: null,
    },
  ],
  currentIndex: 0,
  currentDocument: null,
  totalCount: 1,
  resolvedCount: 0,
  unresolvedCount: 1,
  allResolved: false,
  previewLoading: false,
  previewError: null,
  mergeExecuting: false,
  mergeError: null,
  mergeSuccess: false,
  mergeRequest: null,
  mergeRequestCreating: false,
  mergeRequestError: null,
  goToDocument: vi.fn(),
  goToNext: vi.fn(),
  goToPrevious: vi.fn(),
  goToNextUnresolved: vi.fn(),
  setStrategy: vi.fn(),
  setAllStrategy: vi.fn(),
  setRemainingStrategy: vi.fn(),
  setCherryPickSelection: vi.fn(),
  acceptAllComponentProps: vi.fn(),
  executeMerge: mockExecuteMerge,
  loadPreview: mockLoadPreview,
  createMergeRequest: vi.fn(),
  approveMergeRequest: vi.fn(),
};

let hookReturnOverrides: Record<string, unknown> = {};

vi.mock('../hooks/useMergeResolution.js', () => ({
  useMergeResolution: () => ({
    ...defaultHookReturn,
    ...hookReturnOverrides,
  }),
}));

import { MergeResolutionPage } from '../components/merge-resolution/MergeResolutionPage.js';

describe('MergeResolutionPage', () => {
  const mockConfig = {
    components: {
      Heading: { render: (props: Record<string, unknown>) => <h1>{String(props.text)}</h1> },
    },
  };

  const defaultProps = {
    client: {} as Parameters<typeof MergeResolutionPage>[0]['client'],
    siteId: 'site-1',
    sourceBranchId: 'branch-source',
    targetBranchId: 'branch-target',
    sourceBranchName: 'my-feature',
    targetBranchName: 'Live',
    config: mockConfig,
    onClose: mockOnClose,
    onMergeComplete: mockOnMergeComplete,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hookReturnOverrides = {};
  });

  it('renders toolbar, document list, and detail panel', () => {
    render(<MergeResolutionPage {...defaultProps} />);

    // Toolbar should show branch names in Draft (branch-name) -> target format
    expect(screen.getByText(/Draft \(my-feature\) → Live/)).toBeDefined();

    // Document list should show document paths
    expect(screen.getByText('/home')).toBeDefined();

    // Detail panel section should exist
    expect(screen.getByTestId('merge-resolution-detail')).toBeDefined();
  });

  it('passes branch names to toolbar in correct format', () => {
    render(<MergeResolutionPage {...defaultProps} />);

    // Branch label uses "Draft (branch-name) -> Live" format
    expect(screen.getByText(/Draft \(my-feature\) → Live/)).toBeDefined();
  });

  it('shows loading state while preview is loading', () => {
    hookReturnOverrides = {
      previewLoading: true,
      documents: [],
    };

    render(<MergeResolutionPage {...defaultProps} />);

    expect(screen.getByText(/Loading merge preview/)).toBeDefined();
  });

  it('shows error state when preview fails', () => {
    hookReturnOverrides = {
      previewError: 'Failed to load preview',
      documents: [],
    };

    render(<MergeResolutionPage {...defaultProps} />);

    expect(screen.getByText(/Failed to load preview/)).toBeDefined();
  });

  it('shows merge error to the user', () => {
    hookReturnOverrides = {
      mergeError: 'Merge execution failed due to conflict',
    };

    render(<MergeResolutionPage {...defaultProps} />);

    expect(screen.getByText('Merge execution failed due to conflict')).toBeDefined();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('calls onClose when back button clicked', () => {
    render(<MergeResolutionPage {...defaultProps} />);

    const backBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(backBtn);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onMergeComplete after successful merge', () => {
    hookReturnOverrides = {
      mergeSuccess: true,
    };

    render(<MergeResolutionPage {...defaultProps} />);

    expect(mockOnMergeComplete).toHaveBeenCalledTimes(1);
  });

  // ===== New tests for config threading and diff computation =====

  it('passes diff counts to document list when documents have snapshots', () => {
    render(<MergeResolutionPage {...defaultProps} />);

    // The document has sourceSnapshot and targetSnapshot with different h1 text
    // diffPuckDataWithPositions should detect 1 modified component
    // Diff badge should appear in the list
    expect(screen.getByText('~1 modified')).toBeDefined();
  });

  it('threads config to detail panel for visual rendering', () => {
    hookReturnOverrides = {
      currentDocument: {
        ...defaultHookReturn.documents[0],
        strategy: 'unresolved' as const,
        changeType: 'conflicting' as const,
      },
    };

    render(<MergeResolutionPage {...defaultProps} />);

    // When currentDocument has both snapshots and config is provided,
    // the detail panel should show MergePreviewRenderer which shows
    // the strategy prompt
    expect(screen.getByText('Select a resolution strategy above.')).toBeDefined();
  });
});
