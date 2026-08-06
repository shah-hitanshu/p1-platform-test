/**
 * DocumentResolutionDetail Tests
 *
 * Tests for the detail panel: strategy picker, visual comparison via
 * MergePreviewRenderer, cherry-pick via CherryPickVisualPanel,
 * ViewModeSelector visibility, and delete conflict messages.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PuckData } from '@pantheon-systems/css-client';
import { DocumentResolutionDetail } from '../merge/components/merge-resolution/DocumentResolutionDetail.js';
import type { DocumentResolution } from '../merge/useMergeResolution.js';

// =============================================================================
// Mock Puck Render
// =============================================================================
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

function createDocument(overrides: Partial<DocumentResolution> = {}): DocumentResolution {
  return {
    documentId: 'doc-1',
    documentPath: '/home',
    strategy: 'unresolved',
    changeType: 'conflicting',
    cherryPickSelections: {},
    mergedSnapshot: null,
    sourceSnapshot: null,
    targetSnapshot: null,
    conflictType: 'both-modified',
    classifiedFields: null,
    ...overrides,
  };
}

const defaultCallbacks = {
  onSetStrategy: vi.fn(),
  onCherryPickSelection: vi.fn(),
  onAcceptAllComponentProps: vi.fn(),
};

// =============================================================================
// Tests
// =============================================================================

describe('DocumentResolutionDetail', () => {
  it('shows empty message when no document selected', () => {
    render(
      <DocumentResolutionDetail
        document={null}
        sourceBranchName="Draft"
        targetBranchName="Live"
        {...defaultCallbacks}
      />
    );

    expect(screen.getByText('Select a document to view details.')).toBeDefined();
  });

  it('shows delete message for deleted-in-source conflict', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({ conflictType: 'deleted-in-source' })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        {...defaultCallbacks}
      />
    );

    expect(screen.getByText('This document was deleted in Draft.')).toBeDefined();
  });

  it('shows delete message for deleted-in-target conflict', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({ conflictType: 'deleted-in-target' })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        {...defaultCallbacks}
      />
    );

    expect(screen.getByText('This document was deleted in Live.')).toBeDefined();
  });

  it('renders ComponentConflictGroup for cherry-pick strategy via CherryPickVisualPanel', () => {
    const classifiedFields = [
      {
        classification: 'conflicting' as const,
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'text',
        sourceValue: 'Source Title',
        targetValue: 'Target Title',
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
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'cherry-pick',
          classifiedFields,
          sourceSnapshot,
          targetSnapshot,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        {...defaultCallbacks}
      />
    );

    // Should show the component type from ComponentConflictGroup
    expect(screen.getByText('Heading')).toBeDefined();
    // Should show the prop name
    expect(screen.getByText('text')).toBeDefined();
    // Should show source/target values (may appear multiple times: in Render + ConflictGroup)
    expect(screen.getAllByText(/Source Title/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Target Title/).length).toBeGreaterThanOrEqual(1);
    // Should show auto-merged count (1 source-only field)
    expect(screen.getByText(/1 field auto-merged/)).toBeDefined();
  });

  it('shows Accept all from Draft/Live buttons per component in cherry-pick', () => {
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

    const onAcceptAllComponentProps = vi.fn();

    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'cherry-pick',
          classifiedFields,
          sourceSnapshot,
          targetSnapshot,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        onSetStrategy={vi.fn()}
        onCherryPickSelection={vi.fn()}
        onAcceptAllComponentProps={onAcceptAllComponentProps}
      />
    );

    const draftBtns = screen.getAllByText('Accept all from Draft');
    const liveBtns = screen.getAllByText('Accept all from Live');

    fireEvent.click(draftBtns[0]);
    expect(onAcceptAllComponentProps).toHaveBeenCalledWith('doc-1', 'h1', 'source');

    fireEvent.click(liveBtns[0]);
    expect(onAcceptAllComponentProps).toHaveBeenCalledWith('doc-1', 'h1', 'target');
  });

  it('transforms cherryPickSelections keys for ComponentConflictGroup radio buttons', () => {
    const classifiedFields = [
      {
        classification: 'conflicting' as const,
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'text',
        sourceValue: 'Source Title',
        targetValue: 'Target Title',
        path: 'content',
      },
    ];

    // cherryPickSelections use "componentId:propName" format
    const cherryPickSelections = {
      'h1:text': 'source' as const,
    };

    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'cherry-pick',
          classifiedFields,
          cherryPickSelections,
          sourceSnapshot,
          targetSnapshot,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        {...defaultCallbacks}
      />
    );

    // The radio button for source should be checked
    const sourceRadio = screen.getAllByRole('radio').find(
      (r) => (r as HTMLInputElement).value === 'source' && (r as HTMLInputElement).checked
    );
    expect(sourceRadio).toBeDefined();
  });

  // ===== New tests for visual merge resolution =====

  it('renders MergePreviewRenderer for unresolved strategy with both snapshots', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'unresolved',
          sourceSnapshot,
          targetSnapshot,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        diffs={[{
          type: 'modified',
          componentId: 'h1',
          componentType: 'Heading',
          path: ['content'],
          beforeIndex: 0,
          afterIndex: 0,
        }]}
        {...defaultCallbacks}
      />
    );

    // Should show the "Select a resolution strategy above." prompt
    expect(screen.getByText('Select a resolution strategy above.')).toBeDefined();
    // Should show ViewModeSelector
    expect(screen.getByText('Side by side')).toBeDefined();
    // MergePreviewRenderer renders Puck output
    expect(screen.getAllByTestId('puck-render').length).toBeGreaterThanOrEqual(2);
  });

  it('renders StrategyEmphasisWrapper for accept-draft with banner', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'accept-draft',
          sourceSnapshot,
          targetSnapshot,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        diffs={[{
          type: 'modified',
          componentId: 'h1',
          componentType: 'Heading',
          path: ['content'],
          beforeIndex: 0,
          afterIndex: 0,
        }]}
        {...defaultCallbacks}
      />
    );

    expect(screen.getByText('Draft version will be kept.')).toBeDefined();
    expect(screen.getByText('Side by side')).toBeDefined();
  });

  it('renders StrategyEmphasisWrapper for accept-live with banner', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'accept-live',
          sourceSnapshot,
          targetSnapshot,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        diffs={[{
          type: 'modified',
          componentId: 'h1',
          componentType: 'Heading',
          path: ['content'],
          beforeIndex: 0,
          afterIndex: 0,
        }]}
        {...defaultCallbacks}
      />
    );

    expect(screen.getByText('Live version will be kept.')).toBeDefined();
  });

  it('shows ViewModeSelector for cherry-pick strategy with both snapshots', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'cherry-pick',
          sourceSnapshot,
          targetSnapshot,
          classifiedFields: [],
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        {...defaultCallbacks}
      />
    );

    // ViewModeSelector is shown for conflicting docs with both snapshots
    expect(screen.getByText('Side by side')).toBeDefined();
  });

  it('shows single panel with "Deleted in Draft" when sourceSnapshot is null', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'accept-live',
          sourceSnapshot: null,
          targetSnapshot,
          conflictType: 'deleted-in-source',
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        {...defaultCallbacks}
      />
    );

    expect(screen.getByText('Deleted in Draft')).toBeDefined();
    // Should render Puck content for the surviving snapshot
    expect(screen.getByTestId('puck-render')).toBeDefined();
  });

  it('shows single panel with "New document" when targetSnapshot is null', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'accept-draft',
          sourceSnapshot,
          targetSnapshot: null,
          conflictType: 'deleted-in-target',
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        {...defaultCallbacks}
      />
    );

    expect(screen.getByText('New document')).toBeDefined();
    expect(screen.getByTestId('puck-render')).toBeDefined();
  });

  it('shows "No content available" when both snapshots are null', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          sourceSnapshot: null,
          targetSnapshot: null,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        {...defaultCallbacks}
      />
    );

    expect(screen.getByText('No content available')).toBeDefined();
  });

  it('renders merged preview in cherry-pick right column', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'cherry-pick',
          sourceSnapshot,
          targetSnapshot,
          classifiedFields: [{
            classification: 'conflicting' as const,
            componentId: 'h1',
            componentType: 'Heading',
            propName: 'text',
            sourceValue: 'Source',
            targetValue: 'Target',
            path: 'content',
          }],
          mergedSnapshot: null,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        config={mockConfig}
        {...defaultCallbacks}
      />
    );

    // Should show the merged preview prompt when no selections made
    expect(screen.getByText('Make selections to see the merged preview')).toBeDefined();
    expect(screen.getByText('Merged Preview')).toBeDefined();
  });
});
