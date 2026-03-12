/**
 * CherryPickVisualPanel Tests
 *
 * Tests for the two-column visual cherry-pick layout with
 * side-by-side Render instances and merged preview.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { CherryPickVisualPanel } from '../components/merge-resolution/CherryPickVisualPanel.js';
import type { DocumentResolution } from '../hooks/useMergeResolution.js';
import type { PuckData } from '@pantheon/css-client';
import type { ComponentDiffWithPosition } from '../types.js';

// =============================================================================
// Mock Puck Render
// =============================================================================
vi.mock('@puckeditor/core', () => ({
  Render: ({ data, config }: { data: PuckData; config: unknown }) => (
    <div data-testid="puck-render" data-has-config={config ? 'true' : 'false'}>
      {data.content.map((c, i) => (
        <div key={i} data-component-type={c.type}>
          {c.type}: {String(c.props.text ?? c.props.id)}
        </div>
      ))}
    </div>
  ),
}));

// =============================================================================
// Helpers
// =============================================================================

const mockConfig = {
  components: {
    Heading: { render: (props: Record<string, unknown>) => <h1>{String(props.text)}</h1> },
    Text: { render: (props: Record<string, unknown>) => <p>{String(props.text)}</p> },
  },
};

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

const diffs: ComponentDiffWithPosition[] = [
  {
    type: 'modified',
    componentId: 'h1',
    componentType: 'Heading',
    path: ['content'],
    beforeIndex: 0,
    afterIndex: 0,
  },
];

function createDocument(overrides: Partial<DocumentResolution> = {}): DocumentResolution {
  return {
    documentId: 'doc-1',
    documentPath: '/home',
    strategy: 'cherry-pick',
    cherryPickSelections: {},
    mergedSnapshot: null,
    crdtPreviewSnapshot: null,
    crdtPreviewLoading: false,
    crdtPreviewError: null,
    sourceSnapshot,
    targetSnapshot,
    conflictType: 'both-modified',
    classifiedFields: null,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('CherryPickVisualPanel', () => {
  const defaultProps = {
    config: mockConfig,
    diffs,
    sourceBranchName: 'Draft',
    targetBranchName: 'Live',
    onCherryPickSelection: vi.fn(),
    onAcceptAllComponentProps: vi.fn(),
  };

  it('renders two-column layout with correct structure', () => {
    const { container } = render(
      <CherryPickVisualPanel
        document={createDocument()}
        {...defaultProps}
      />
    );

    // Left column exists
    expect(container.querySelector('.cherry-pick-visual-panel__left')).toBeDefined();
    // Right column exists
    expect(container.querySelector('.cherry-pick-visual-panel__right')).toBeDefined();

    // Two render panels in left column (Draft and Live)
    const renderPanels = container.querySelectorAll('.cherry-pick-visual-panel__render-panel');
    expect(renderPanels.length).toBe(2);

    // Three total Render instances: Draft, Live, and Merged preview prompt (no mergedSnapshot)
    // Actually with null mergedSnapshot, only 2 Render instances (Draft and Live)
    const renders = screen.getAllByTestId('puck-render');
    expect(renders.length).toBe(2);
  });

  it('shows merged preview header', () => {
    render(
      <CherryPickVisualPanel
        document={createDocument()}
        {...defaultProps}
      />
    );

    expect(screen.getByText('Merged Preview')).toBeDefined();
  });

  it('shows prompt when mergedSnapshot is null', () => {
    render(
      <CherryPickVisualPanel
        document={createDocument({ mergedSnapshot: null })}
        {...defaultProps}
      />
    );

    expect(screen.getByText('Make selections to see the merged preview')).toBeDefined();
  });

  it('renders merged preview with Render when mergedSnapshot is provided', () => {
    const mergedSnapshot: PuckData = {
      content: [{ type: 'Heading', props: { id: 'h1', text: 'Merged Title' } }],
      root: { props: {} },
    };

    render(
      <CherryPickVisualPanel
        document={createDocument({ mergedSnapshot })}
        {...defaultProps}
      />
    );

    // Three Render instances: Draft, Live, Merged
    const renders = screen.getAllByTestId('puck-render');
    expect(renders.length).toBe(3);
    expect(screen.getByText('Heading: Merged Title')).toBeDefined();
  });

  it('shows branch labels on comparison panels', () => {
    render(
      <CherryPickVisualPanel
        document={createDocument()}
        {...defaultProps}
      />
    );

    // Panel labels should show branch names
    expect(screen.getByText('Draft')).toBeDefined();
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('renders ComponentConflictGroup for conflicting fields', () => {
    const classifiedFields = [
      {
        classification: 'conflicting' as const,
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'text',
        sourceValue: 'Source',
        targetValue: 'Target',
        path: 'content',
      },
    ];

    render(
      <CherryPickVisualPanel
        document={createDocument({ classifiedFields })}
        {...defaultProps}
      />
    );

    // ComponentConflictGroup should be rendered
    expect(screen.getByText('Heading')).toBeDefined();
    expect(screen.getByText('text')).toBeDefined();
  });

  it('shows auto-merged count when non-conflicting fields exist', () => {
    const classifiedFields = [
      {
        classification: 'conflicting' as const,
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'text',
        sourceValue: 'Source',
        targetValue: 'Target',
        path: 'content',
      },
      {
        classification: 'source-only' as const,
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'color',
        sourceValue: 'red',
        targetValue: 'blue',
        path: 'content',
      },
    ];

    render(
      <CherryPickVisualPanel
        document={createDocument({ classifiedFields })}
        {...defaultProps}
      />
    );

    expect(screen.getByText('1 field auto-merged')).toBeDefined();
  });

  it('shows Accept all from Draft/Live buttons per component', () => {
    const classifiedFields = [
      {
        classification: 'conflicting' as const,
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'text',
        sourceValue: 'Source',
        targetValue: 'Target',
        path: 'content',
      },
    ];

    render(
      <CherryPickVisualPanel
        document={createDocument({ classifiedFields })}
        {...defaultProps}
      />
    );

    expect(screen.getAllByText('Accept all from Draft').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Accept all from Live').length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT use MergePreviewRenderer (no .merge-preview-renderer__panel)', () => {
    const { container } = render(
      <CherryPickVisualPanel
        document={createDocument()}
        {...defaultProps}
      />
    );

    // Should NOT have MergePreviewRenderer panel elements
    expect(container.querySelector('.merge-preview-renderer__panel')).toBeNull();
  });
});
