/**
 * Visual Version Compare Tests
 *
 * Tests for the visual side-by-side version comparison with rendered Puck pages.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisualVersionCompare } from '../src/components/version-compare/VisualVersionCompare.js';
import type { ComponentDiffWithPosition } from '../src/types.js';

// Mock Puck's Render component - simulate using the config's render functions
vi.mock('@puckeditor/core', () => ({
  Render: ({ data, config }: { data: unknown; config: { components: Record<string, { render: (props: Record<string, unknown>) => React.ReactNode }> } }) => {
    const puckData = data as { content: Array<{ type: string; props: Record<string, unknown> & { id: string } }> };
    return (
      <div data-testid="puck-render">
        {puckData.content.map((component) => {
          const componentConfig = config.components[component.type];
          if (componentConfig && componentConfig.render) {
            // Use the config's render function (which may be wrapped with highlighting)
            return (
              <div key={component.props.id}>
                {componentConfig.render(component.props)}
              </div>
            );
          }
          return (
            <div key={component.props.id} data-component-id={component.props.id}>
              {component.type}
            </div>
          );
        })}
      </div>
    );
  },
}));

// Sample Puck config for testing
const mockConfig = {
  components: {
    Heading: {
      label: 'Heading',
      render: ({ text }: { text: string }) => <h2>{text}</h2>,
    },
    Text: {
      label: 'Text',
      render: ({ content }: { content: string }) => <p>{content}</p>,
    },
  },
};

// Sample PuckData for testing
const beforeData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Hello World' } },
    { type: 'Text', props: { id: 't1', content: 'Original text' } },
  ],
  root: { props: {} },
};

const afterData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Hello World' } },
    { type: 'Text', props: { id: 't1', content: 'Modified text' } },
    { type: 'Text', props: { id: 't2', content: 'New component' } },
  ],
  root: { props: {} },
};

const mockDiffs: ComponentDiffWithPosition[] = [
  {
    type: 'unchanged',
    componentId: 'h1',
    componentType: 'Heading',
    path: ['content'],
    beforeIndex: 0,
    afterIndex: 0,
    before: beforeData.content[0],
    after: afterData.content[0],
  },
  {
    type: 'modified',
    componentId: 't1',
    componentType: 'Text',
    path: ['content'],
    beforeIndex: 1,
    afterIndex: 1,
    before: beforeData.content[1],
    after: afterData.content[1],
  },
  {
    type: 'added',
    componentId: 't2',
    componentType: 'Text',
    path: ['content'],
    beforeIndex: -1,
    afterIndex: 2,
    before: undefined,
    after: afterData.content[2],
  },
];

describe('VisualVersionCompare', () => {
  it('should render header with version numbers', () => {
    render(
      <VisualVersionCompare
        beforeVersion={3}
        afterVersion={5}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    // Version numbers appear in both header and panel labels
    expect(screen.getAllByText(/v3/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/v5/).length).toBeGreaterThan(0);
  });

  it('should render two preview panels with Before and After labels', () => {
    render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('should render Puck content in both panels', () => {
    render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    // Should have two render areas (before and after)
    const renderAreas = screen.getAllByTestId('puck-render');
    expect(renderAreas).toHaveLength(2);
  });

  it('should show change summary in header', () => {
    render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    // Should show +1 added, ~1 modified
    expect(screen.getByText(/\+1/)).toBeInTheDocument();
    expect(screen.getByText(/~1/)).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('should show empty state when no changes', () => {
    render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={beforeData}
        config={mockConfig}
        diffs={[]}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/no changes/i)).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={() => {}}
        className="custom-class"
      />
    );

    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('should render with arrow between version numbers', () => {
    render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('→')).toBeInTheDocument();
  });
});

describe('VisualVersionCompare - Diff Highlighting', () => {
  it('should mark added components with added indicator', () => {
    const { container } = render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    // The after panel should contain a component with added styling
    const addedIndicators = container.querySelectorAll('[data-diff-type="added"]');
    expect(addedIndicators.length).toBeGreaterThan(0);
  });

  it('should mark modified components with modified indicator', () => {
    const { container } = render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    const modifiedIndicators = container.querySelectorAll('[data-diff-type="modified"]');
    expect(modifiedIndicators.length).toBeGreaterThan(0);
  });

  it('should mark removed components with removed indicator in before panel', () => {
    const removedDiffs: ComponentDiffWithPosition[] = [
      {
        type: 'removed',
        componentId: 'deleted-1',
        componentType: 'Text',
        path: ['content'],
        beforeIndex: 0,
        afterIndex: -1,
        before: { type: 'Text', props: { id: 'deleted-1', content: 'Deleted' } },
        after: undefined,
      },
    ];

    const beforeWithRemoved = {
      content: [
        { type: 'Text', props: { id: 'deleted-1', content: 'Deleted' } },
      ],
      root: { props: {} },
    };

    const afterWithRemoved = {
      content: [],
      root: { props: {} },
    };

    const { container } = render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeWithRemoved}
        afterData={afterWithRemoved}
        config={mockConfig}
        diffs={removedDiffs}
        onClose={() => {}}
      />
    );

    const removedIndicators = container.querySelectorAll('[data-diff-type="removed"]');
    expect(removedIndicators.length).toBeGreaterThan(0);
  });

  it('should not mark unchanged components', () => {
    const unchangedDiffs: ComponentDiffWithPosition[] = [
      {
        type: 'unchanged',
        componentId: 'h1',
        componentType: 'Heading',
        path: ['content'],
        beforeIndex: 0,
        afterIndex: 0,
        before: beforeData.content[0],
        after: beforeData.content[0],
      },
    ];

    const { container } = render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={beforeData}
        config={mockConfig}
        diffs={unchangedDiffs}
        onClose={() => {}}
      />
    );

    // Should not have any diff indicators for unchanged components
    const diffIndicators = container.querySelectorAll('[data-diff-type]');
    expect(diffIndicators.length).toBe(0);
  });
});

describe('VisualVersionCompare - Legend', () => {
  it('should show a legend explaining diff colors', () => {
    const { container } = render(
      <VisualVersionCompare
        beforeVersion={1}
        afterVersion={2}
        beforeData={beforeData}
        afterData={afterData}
        config={mockConfig}
        diffs={mockDiffs}
        onClose={() => {}}
      />
    );

    // Check for legend items by their specific class
    const legend = container.querySelector('.visual-version-compare__legend');
    expect(legend).toBeInTheDocument();
    expect(container.querySelector('.visual-version-compare__legend-item--added')).toBeInTheDocument();
    expect(container.querySelector('.visual-version-compare__legend-item--modified')).toBeInTheDocument();
    expect(container.querySelector('.visual-version-compare__legend-item--removed')).toBeInTheDocument();
  });
});
