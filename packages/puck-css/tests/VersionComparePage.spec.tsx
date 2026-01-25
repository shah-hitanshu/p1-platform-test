/**
 * DiffHeader and VersionComparePage Component Tests
 *
 * Tests for the full-page version comparison view.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffHeader } from '../src/components/version-compare/DiffHeader.js';
import { VersionComparePage } from '../src/components/version-compare/VersionComparePage.js';
import type { ComponentDiffWithPosition } from '../src/types.js';

describe('DiffHeader', () => {
  it('should render version numbers', () => {
    render(
      <DiffHeader
        beforeVersion={3}
        afterVersion={5}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/v3/)).toBeInTheDocument();
    expect(screen.getByText(/v5/)).toBeInTheDocument();
  });

  it('should show change summary', () => {
    render(
      <DiffHeader
        beforeVersion={1}
        afterVersion={2}
        added={3}
        removed={1}
        modified={2}
        reordered={1}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/\+3/)).toBeInTheDocument();
    expect(screen.getByText(/-1/)).toBeInTheDocument();
    expect(screen.getByText(/~2/)).toBeInTheDocument();
  });

  it('should call onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <DiffHeader
        beforeVersion={1}
        afterVersion={2}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('should show arrow between versions', () => {
    render(
      <DiffHeader
        beforeVersion={1}
        afterVersion={2}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('→')).toBeInTheDocument();
  });
});

describe('VersionComparePage', () => {
  const mockDiffs: ComponentDiffWithPosition[] = [
    {
      type: 'unchanged',
      componentId: 'h1',
      componentType: 'Heading',
      path: ['content'],
      beforeIndex: 0,
      afterIndex: 0,
      before: { type: 'Heading', props: { id: 'h1', text: 'Hello' } },
      after: { type: 'Heading', props: { id: 'h1', text: 'Hello' } },
    },
    {
      type: 'modified',
      componentId: 't1',
      componentType: 'Text',
      path: ['content'],
      beforeIndex: 1,
      afterIndex: 1,
      before: { type: 'Text', props: { id: 't1', content: 'Old text' } },
      after: { type: 'Text', props: { id: 't1', content: 'New text' } },
    },
  ];

  it('should render header with version numbers', () => {
    render(
      <VersionComparePage
        beforeVersion={1}
        afterVersion={2}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/v1/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it('should render before and after trees', () => {
    render(
      <VersionComparePage
        beforeVersion={1}
        afterVersion={2}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('should render component nodes', () => {
    render(
      <VersionComparePage
        beforeVersion={1}
        afterVersion={2}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    // Both trees should show Heading and Text
    expect(screen.getAllByText('Heading')).toHaveLength(2);
    expect(screen.getAllByText('Text')).toHaveLength(2);
  });

  it('should show prop diff panel when component selected', () => {
    render(
      <VersionComparePage
        beforeVersion={1}
        afterVersion={2}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    // Click on the modified Text component
    const textNodes = screen.getAllByText('Text');
    fireEvent.click(textNodes[0]);

    // Should show prop diff panel
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('should call onClose when header close clicked', () => {
    const onClose = vi.fn();
    render(
      <VersionComparePage
        beforeVersion={1}
        afterVersion={2}
        diffs={mockDiffs}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('should show empty state when no diffs', () => {
    render(
      <VersionComparePage
        beforeVersion={1}
        afterVersion={2}
        diffs={[]}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/no changes/i)).toBeInTheDocument();
  });
});
