/**
 * ComponentNode and ComponentTree Component Tests
 *
 * Tests for the visual component tree display with diff highlighting.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentNode } from '../src/components/version-compare/ComponentNode.js';
import { ComponentTree } from '../src/components/version-compare/ComponentTree.js';
import type { ComponentDiffWithPosition } from '../src/types.js';

describe('ComponentNode', () => {
  const baseDiff: ComponentDiffWithPosition = {
    type: 'unchanged',
    componentId: 'h1',
    componentType: 'Heading',
    path: ['content'],
    beforeIndex: 0,
    afterIndex: 0,
  };

  it('should render component type', () => {
    render(<ComponentNode diff={baseDiff} />);
    expect(screen.getByText('Heading')).toBeInTheDocument();
  });

  it('should show position indicator', () => {
    render(<ComponentNode diff={baseDiff} showPosition />);
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('should apply added styling', () => {
    const diff: ComponentDiffWithPosition = {
      ...baseDiff,
      type: 'added',
      beforeIndex: undefined,
      afterIndex: 0,
    };

    const { container } = render(<ComponentNode diff={diff} />);
    expect(container.firstChild).toHaveClass('component-node--added');
  });

  it('should apply removed styling', () => {
    const diff: ComponentDiffWithPosition = {
      ...baseDiff,
      type: 'removed',
      beforeIndex: 0,
      afterIndex: undefined,
    };

    const { container } = render(<ComponentNode diff={diff} />);
    expect(container.firstChild).toHaveClass('component-node--removed');
  });

  it('should apply modified styling', () => {
    const diff: ComponentDiffWithPosition = {
      ...baseDiff,
      type: 'modified',
    };

    const { container } = render(<ComponentNode diff={diff} />);
    expect(container.firstChild).toHaveClass('component-node--modified');
  });

  it('should apply reordered styling', () => {
    const diff: ComponentDiffWithPosition = {
      ...baseDiff,
      type: 'reordered',
      beforeIndex: 0,
      afterIndex: 2,
    };

    const { container } = render(<ComponentNode diff={diff} />);
    expect(container.firstChild).toHaveClass('component-node--reordered');
  });

  it('should show move indicator for reordered components', () => {
    const diff: ComponentDiffWithPosition = {
      ...baseDiff,
      type: 'reordered',
      beforeIndex: 0,
      afterIndex: 2,
    };

    render(<ComponentNode diff={diff} showPosition />);
    expect(screen.getByText(/moved/i)).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ComponentNode diff={baseDiff} onClick={onClick} />);

    fireEvent.click(screen.getByText('Heading'));
    expect(onClick).toHaveBeenCalledWith(baseDiff);
  });

  it('should show selected state', () => {
    const { container } = render(<ComponentNode diff={baseDiff} isSelected />);
    expect(container.firstChild).toHaveClass('component-node--selected');
  });
});

describe('ComponentTree', () => {
  const diffs: ComponentDiffWithPosition[] = [
    {
      type: 'unchanged',
      componentId: 'h1',
      componentType: 'Heading',
      path: ['content'],
      beforeIndex: 0,
      afterIndex: 0,
    },
    {
      type: 'modified',
      componentId: 't1',
      componentType: 'Text',
      path: ['content'],
      beforeIndex: 1,
      afterIndex: 1,
    },
    {
      type: 'added',
      componentId: 'i1',
      componentType: 'Image',
      path: ['content'],
      afterIndex: 2,
    },
  ];

  it('should render all components', () => {
    render(<ComponentTree diffs={diffs} side="after" />);

    expect(screen.getByText('Heading')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
  });

  it('should show correct count in header', () => {
    render(<ComponentTree diffs={diffs} side="after" />);
    expect(screen.getByText(/3 components/i)).toBeInTheDocument();
  });

  it('should sort by position for after side', () => {
    render(<ComponentTree diffs={diffs} side="after" />);

    const nodes = screen.getAllByRole('button');
    // Should be in order: Heading (0), Text (1), Image (2)
    expect(nodes[0]).toHaveTextContent('Heading');
    expect(nodes[1]).toHaveTextContent('Text');
    expect(nodes[2]).toHaveTextContent('Image');
  });

  it('should filter out added components for before side', () => {
    render(<ComponentTree diffs={diffs} side="before" />);

    expect(screen.getByText('Heading')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.queryByText('Image')).not.toBeInTheDocument();
  });

  it('should call onSelectComponent when component clicked', () => {
    const onSelect = vi.fn();
    render(<ComponentTree diffs={diffs} side="after" onSelectComponent={onSelect} />);

    fireEvent.click(screen.getByText('Text'));
    expect(onSelect).toHaveBeenCalled();
    expect(onSelect.mock.calls[0][0].componentId).toBe('t1');
  });

  it('should highlight selected component', () => {
    render(
      <ComponentTree
        diffs={diffs}
        side="after"
        selectedComponentId="t1"
      />
    );

    const textNode = screen.getByText('Text').closest('.component-node');
    expect(textNode).toHaveClass('component-node--selected');
  });

  it('should show empty state when no components', () => {
    render(<ComponentTree diffs={[]} side="after" />);
    expect(screen.getByText(/no components/i)).toBeInTheDocument();
  });
});
