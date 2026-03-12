/**
 * DocumentResolutionDetail Tests
 *
 * Tests for the detail panel: strategy picker, cherry-pick UI with
 * ComponentConflictGroup, CrdtPreviewPanel integration, and delete
 * conflict messages.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentResolutionDetail } from '../components/merge-resolution/DocumentResolutionDetail.js';
import type { DocumentResolution } from '../hooks/useMergeResolution.js';
import type { PuckData } from '@pantheon/css-client';

// =============================================================================
// Helpers
// =============================================================================

function createDocument(overrides: Partial<DocumentResolution> = {}): DocumentResolution {
  return {
    documentId: 'doc-1',
    documentPath: '/home',
    strategy: 'unresolved',
    cherryPickSelections: {},
    mergedSnapshot: null,
    crdtPreviewSnapshot: null,
    crdtPreviewLoading: false,
    crdtPreviewError: null,
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
  onFetchCrdtPreview: vi.fn(),
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

  it('renders ComponentConflictGroup for cherry-pick strategy', () => {
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
          sourceSnapshot: { content: [], root: {} } as PuckData,
          targetSnapshot: { content: [], root: {} } as PuckData,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        {...defaultCallbacks}
      />
    );

    // Should show the component type from ComponentConflictGroup
    expect(screen.getByText('Heading')).toBeDefined();
    // Should show the prop name
    expect(screen.getByText('text')).toBeDefined();
    // Should show source/target values
    expect(screen.getByText(/Source Title/)).toBeDefined();
    expect(screen.getByText(/Target Title/)).toBeDefined();
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
          sourceSnapshot: { content: [], root: {} } as PuckData,
          targetSnapshot: { content: [], root: {} } as PuckData,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        onSetStrategy={vi.fn()}
        onCherryPickSelection={vi.fn()}
        onAcceptAllComponentProps={onAcceptAllComponentProps}
        onFetchCrdtPreview={vi.fn()}
      />
    );

    const draftBtn = screen.getByText('Accept all from Draft');
    const liveBtn = screen.getByText('Accept all from Live');

    fireEvent.click(draftBtn);
    expect(onAcceptAllComponentProps).toHaveBeenCalledWith('doc-1', 'h1', 'source');

    fireEvent.click(liveBtn);
    expect(onAcceptAllComponentProps).toHaveBeenCalledWith('doc-1', 'h1', 'target');
  });

  it('uses CrdtPreviewPanel for crdt-preview strategy', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'crdt-preview',
          crdtPreviewLoading: true,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        {...defaultCallbacks}
      />
    );

    // CrdtPreviewPanel renders loading state
    expect(screen.getByText('Loading CRDT merge preview...')).toBeDefined();
  });

  it('auto-fetches CRDT preview when strategy is crdt-preview and no snapshot', () => {
    const onFetchCrdtPreview = vi.fn();
    render(
      <DocumentResolutionDetail
        document={createDocument({ strategy: 'crdt-preview' })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        onSetStrategy={vi.fn()}
        onCherryPickSelection={vi.fn()}
        onAcceptAllComponentProps={vi.fn()}
        onFetchCrdtPreview={onFetchCrdtPreview}
      />
    );

    // Should auto-fetch on mount when strategy is crdt-preview
    expect(onFetchCrdtPreview).toHaveBeenCalledWith('doc-1');
  });

  it('does not auto-fetch CRDT preview when snapshot already exists', () => {
    const onFetchCrdtPreview = vi.fn();
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'crdt-preview',
          crdtPreviewSnapshot: { content: [], root: { props: {} } } as PuckData,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        onSetStrategy={vi.fn()}
        onCherryPickSelection={vi.fn()}
        onAcceptAllComponentProps={vi.fn()}
        onFetchCrdtPreview={onFetchCrdtPreview}
      />
    );

    // Should NOT auto-fetch since snapshot already exists
    expect(onFetchCrdtPreview).not.toHaveBeenCalled();
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
          sourceSnapshot: { content: [], root: {} } as PuckData,
          targetSnapshot: { content: [], root: {} } as PuckData,
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        {...defaultCallbacks}
      />
    );

    // The radio button for source should be checked
    // ComponentConflictGroup uses resolutions[field.propName], so the key
    // must be transformed from "h1:text" to "text" for the radio to show checked
    const sourceRadio = screen.getAllByRole('radio').find(
      (r) => (r as HTMLInputElement).value === 'source' && (r as HTMLInputElement).checked
    );
    expect(sourceRadio).toBeDefined();
  });

  it('shows CrdtPreviewPanel error state', () => {
    render(
      <DocumentResolutionDetail
        document={createDocument({
          strategy: 'crdt-preview',
          crdtPreviewError: 'CRDT state not available',
        })}
        sourceBranchName="Draft"
        targetBranchName="Live"
        {...defaultCallbacks}
      />
    );

    expect(screen.getByText('CRDT state not available')).toBeDefined();
  });
});
