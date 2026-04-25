/**
 * MergePreviewRenderer and ViewModeSelector Tests (TDD - Phase 5)
 *
 * Tests for the renderer component that displays diff-highlighted content
 * in side-by-side, overlay, and slider modes.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PuckData } from '@pantheon/css-client';
import type { ComponentDiffWithPosition } from '../src/types.js';
import { MergePreviewRenderer } from '../src/components/merge-preview/MergePreviewRenderer.js';
import { ViewModeSelector } from '../src/components/merge-preview/ViewModeSelector.js';

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

const sourceData: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Source Title' } },
    { type: 'Text', props: { id: 't1', text: 'Same paragraph' } },
  ],
  root: { props: {} },
};

const targetData: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Target Title' } },
    { type: 'Text', props: { id: 't1', text: 'Same paragraph' } },
  ],
  root: { props: {} },
};

const diffs: ComponentDiffWithPosition[] = [
  {
    type: 'modified',
    componentId: 'h1',
    componentType: 'Heading',
    path: ['content'],
    beforeIndex: 0,
    afterIndex: 0,
    before: { type: 'Heading', props: { id: 'h1', text: 'Source Title' } },
    after: { type: 'Heading', props: { id: 'h1', text: 'Target Title' } },
  },
  {
    type: 'unchanged',
    componentId: 't1',
    componentType: 'Text',
    path: ['content'],
    beforeIndex: 1,
    afterIndex: 1,
    before: { type: 'Text', props: { id: 't1', text: 'Same paragraph' } },
    after: { type: 'Text', props: { id: 't1', text: 'Same paragraph' } },
  },
];

const mockConfig = {
  components: {
    Heading: { render: (props: Record<string, unknown>) => <h1>{String(props.text)}</h1> },
    Text: { render: (props: Record<string, unknown>) => <p>{String(props.text)}</p> },
  },
};

describe('MergePreviewRenderer', () => {
  it('should render in side-by-side mode by default', () => {
    const { container } = render(
      <MergePreviewRenderer
        sourceData={sourceData}
        targetData={targetData}
        diffs={diffs}
        config={mockConfig}
        viewMode="side-by-side"
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Should have two panels
    const panels = container.querySelectorAll('.merge-preview-renderer__panel');
    expect(panels.length).toBe(2);
  });

  it('should show branch labels on panels', () => {
    render(
      <MergePreviewRenderer
        sourceData={sourceData}
        targetData={targetData}
        diffs={diffs}
        config={mockConfig}
        viewMode="side-by-side"
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText('feature')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('should render in overlay mode', () => {
    const { container } = render(
      <MergePreviewRenderer
        sourceData={sourceData}
        targetData={targetData}
        diffs={diffs}
        config={mockConfig}
        viewMode="overlay"
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Overlay mode has a single layered container
    expect(container.querySelector('.merge-preview-renderer--overlay')).toBeInTheDocument();
  });

  it('should render in slider mode', () => {
    const { container } = render(
      <MergePreviewRenderer
        sourceData={sourceData}
        targetData={targetData}
        diffs={diffs}
        config={mockConfig}
        viewMode="slider"
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Slider mode has a slider control
    expect(container.querySelector('.merge-preview-renderer--slider')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('should apply diff highlighting', () => {
    const { container } = render(
      <MergePreviewRenderer
        sourceData={sourceData}
        targetData={targetData}
        diffs={diffs}
        config={mockConfig}
        viewMode="side-by-side"
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Should have diff highlighting applied via Puck Render
    const renderOutputs = container.querySelectorAll('[data-testid="puck-render"]');
    expect(renderOutputs.length).toBe(2); // One per side
  });

  it('should handle empty diffs gracefully', () => {
    render(
      <MergePreviewRenderer
        sourceData={sourceData}
        targetData={targetData}
        diffs={[]}
        config={mockConfig}
        viewMode="side-by-side"
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText(/no changes/i)).toBeInTheDocument();
  });

  it('should show change count summary', () => {
    render(
      <MergePreviewRenderer
        sourceData={sourceData}
        targetData={targetData}
        diffs={diffs}
        config={mockConfig}
        viewMode="side-by-side"
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Should show stats about the changes
    expect(screen.getByText(/1 modified/i)).toBeInTheDocument();
  });
});

describe('ViewModeSelector', () => {
  it('should render all three view mode buttons', () => {
    render(
      <ViewModeSelector
        viewMode="side-by-side"
        onViewModeChange={vi.fn()}
      />
    );

    expect(screen.getByText(/side by side/i)).toBeInTheDocument();
    expect(screen.getByText(/overlay/i)).toBeInTheDocument();
    expect(screen.getByText(/slider/i)).toBeInTheDocument();
  });

  it('should highlight the active view mode', () => {
    render(
      <ViewModeSelector
        viewMode="side-by-side"
        onViewModeChange={vi.fn()}
      />
    );

    const activeBtn = screen.getByText(/side by side/i).closest('button');
    expect(activeBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('should call onViewModeChange when a mode is selected', () => {
    const onChange = vi.fn();
    render(
      <ViewModeSelector
        viewMode="side-by-side"
        onViewModeChange={onChange}
      />
    );

    fireEvent.click(screen.getByText(/overlay/i));
    expect(onChange).toHaveBeenCalledWith('overlay');
  });

  it('should highlight newly selected mode', () => {
    const { rerender } = render(
      <ViewModeSelector
        viewMode="side-by-side"
        onViewModeChange={vi.fn()}
      />
    );

    // Rerender with overlay selected
    rerender(
      <ViewModeSelector
        viewMode="overlay"
        onViewModeChange={vi.fn()}
      />
    );

    const overlayBtn = screen.getByText(/overlay/i).closest('button');
    expect(overlayBtn).toHaveAttribute('aria-pressed', 'true');

    const sideBySideBtn = screen.getByText(/side by side/i).closest('button');
    expect(sideBySideBtn).not.toHaveAttribute('aria-pressed', 'true');
  });
});
