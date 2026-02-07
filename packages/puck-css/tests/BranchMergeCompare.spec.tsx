/**
 * BranchMergeCompare and BranchDiffHeader Component Tests (TDD - Phase 4)
 *
 * Tests for the branch merge comparison components that show
 * branch names instead of version numbers.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentDiffWithPosition } from '../src/types.js';
import { BranchDiffHeader } from '../src/components/version-compare/BranchDiffHeader.js';
import { BranchMergeCompare } from '../src/components/version-compare/BranchMergeCompare.js';

describe('BranchDiffHeader', () => {
  it('should render source and target branch names', () => {
    render(
      <BranchDiffHeader
        sourceBranchName="feature-branch"
        targetBranchName="main"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('feature-branch')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('should show change count summary', () => {
    render(
      <BranchDiffHeader
        sourceBranchName="feature"
        targetBranchName="main"
        added={2}
        removed={1}
        modified={3}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(screen.getByText('~3')).toBeInTheDocument();
  });

  it('should hide stats when all counts are zero', () => {
    const { container } = render(
      <BranchDiffHeader
        sourceBranchName="feature"
        targetBranchName="main"
        onClose={vi.fn()}
      />
    );

    expect(container.querySelector('.branch-diff-header__summary')).not.toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <BranchDiffHeader
        sourceBranchName="feature"
        targetBranchName="main"
        onClose={onClose}
      />
    );

    const closeBtn = screen.getByRole('button', { name: /close/i });
    closeBtn.click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should show arrow between branch names', () => {
    render(
      <BranchDiffHeader
        sourceBranchName="feature"
        targetBranchName="main"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('→')).toBeInTheDocument();
  });
});

describe('BranchMergeCompare', () => {
  const diffs: ComponentDiffWithPosition[] = [
    {
      type: 'modified',
      componentId: 'h1',
      componentType: 'Heading',
      path: ['content'],
      beforeIndex: 0,
      afterIndex: 0,
      before: { type: 'Heading', props: { id: 'h1', text: 'Old' } },
      after: { type: 'Heading', props: { id: 'h1', text: 'New' } },
    },
    {
      type: 'added',
      componentId: 't1',
      componentType: 'Text',
      path: ['content'],
      afterIndex: 1,
      after: { type: 'Text', props: { id: 't1', text: 'Hello' } },
    },
  ];

  it('should render with branch names instead of version numbers', () => {
    render(
      <BranchMergeCompare
        sourceBranchName="feature-redesign"
        targetBranchName="main"
        diffs={diffs}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('feature-redesign')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('should show component trees for both sides', () => {
    render(
      <BranchMergeCompare
        sourceBranchName="feature"
        targetBranchName="main"
        diffs={diffs}
        onClose={vi.fn()}
      />
    );

    // Should render component names in the trees
    expect(screen.getAllByText('Heading').length).toBeGreaterThan(0);
  });

  it('should show empty state when no changes', () => {
    render(
      <BranchMergeCompare
        sourceBranchName="feature"
        targetBranchName="main"
        diffs={[]}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/no changes/i)).toBeInTheDocument();
  });

  it('should show prop diff panel when component selected', () => {
    render(
      <BranchMergeCompare
        sourceBranchName="feature"
        targetBranchName="main"
        diffs={diffs}
        onClose={vi.fn()}
      />
    );

    // Click a component to select it
    const headingNodes = screen.getAllByText('Heading');
    headingNodes[0].click();

    // Should show prop diff panel with the prop name
    expect(screen.getByText('text')).toBeInTheDocument();
  });
});
