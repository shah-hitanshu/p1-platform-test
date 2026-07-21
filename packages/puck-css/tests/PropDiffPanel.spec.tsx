/**
 * PropDiffRow and PropDiffPanel Component Tests
 *
 * Tests for prop-level diff display components.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PropDiffRow } from '../src/versioning/components/version-compare/PropDiffRow.js';
import { PropDiffPanel } from '../src/versioning/components/version-compare/PropDiffPanel.js';
import type { PropDiff } from '../src/core/types.js';

describe('PropDiffRow', () => {
  it('should render added prop with before empty and after value', () => {
    const diff: PropDiff = {
      propName: 'color',
      type: 'added',
      before: undefined,
      after: '#ff0000',
    };

    render(<PropDiffRow diff={diff} />);

    expect(screen.getByText('color')).toBeInTheDocument();
    expect(screen.getByText('#ff0000')).toBeInTheDocument();
  });

  it('should render removed prop with before value and after empty', () => {
    const diff: PropDiff = {
      propName: 'margin',
      type: 'removed',
      before: 10,
      after: undefined,
    };

    render(<PropDiffRow diff={diff} />);

    expect(screen.getByText('margin')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('should render modified prop with both values', () => {
    const diff: PropDiff = {
      propName: 'text',
      type: 'modified',
      before: 'Hello',
      after: 'World',
    };

    render(<PropDiffRow diff={diff} />);

    expect(screen.getByText('text')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('World')).toBeInTheDocument();
  });

  it('should apply correct styling for added type', () => {
    const diff: PropDiff = {
      propName: 'newProp',
      type: 'added',
      after: 'value',
    };

    const { container } = render(<PropDiffRow diff={diff} />);
    expect(container.firstChild).toHaveClass('prop-diff-row--added');
  });

  it('should apply correct styling for removed type', () => {
    const diff: PropDiff = {
      propName: 'oldProp',
      type: 'removed',
      before: 'value',
    };

    const { container } = render(<PropDiffRow diff={diff} />);
    expect(container.firstChild).toHaveClass('prop-diff-row--removed');
  });

  it('should apply correct styling for modified type', () => {
    const diff: PropDiff = {
      propName: 'changedProp',
      type: 'modified',
      before: 'old',
      after: 'new',
    };

    const { container } = render(<PropDiffRow diff={diff} />);
    expect(container.firstChild).toHaveClass('prop-diff-row--modified');
  });
});

describe('PropDiffPanel', () => {
  it('should render component info header', () => {
    render(
      <PropDiffPanel
        componentType="Heading"
        componentId="h1"
        diffs={[]}
      />
    );

    expect(screen.getByText('Heading')).toBeInTheDocument();
  });

  it('should render all prop diffs', () => {
    const diffs: PropDiff[] = [
      { propName: 'text', type: 'modified', before: 'Hello', after: 'World' },
      { propName: 'color', type: 'added', after: '#ff0000' },
      { propName: 'size', type: 'removed', before: 'large' },
    ];

    render(
      <PropDiffPanel
        componentType="Text"
        componentId="t1"
        diffs={diffs}
      />
    );

    expect(screen.getByText('text')).toBeInTheDocument();
    expect(screen.getByText('color')).toBeInTheDocument();
    expect(screen.getByText('size')).toBeInTheDocument();
  });

  it('should show message when no changes', () => {
    render(
      <PropDiffPanel
        componentType="Image"
        componentId="i1"
        diffs={[]}
      />
    );

    expect(screen.getByText(/no prop changes/i)).toBeInTheDocument();
  });

  it('should show change summary', () => {
    const diffs: PropDiff[] = [
      { propName: 'a', type: 'added', after: 1 },
      { propName: 'b', type: 'added', after: 2 },
      { propName: 'c', type: 'removed', before: 3 },
      { propName: 'd', type: 'modified', before: 4, after: 5 },
    ];

    render(
      <PropDiffPanel
        componentType="Card"
        componentId="c1"
        diffs={diffs}
      />
    );

    // Should show summary like "2 added, 1 removed, 1 modified"
    expect(screen.getByText(/2 added/)).toBeInTheDocument();
    expect(screen.getByText(/1 removed/)).toBeInTheDocument();
    expect(screen.getByText(/1 modified/)).toBeInTheDocument();
  });
});
