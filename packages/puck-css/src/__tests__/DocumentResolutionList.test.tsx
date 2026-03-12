/**
 * DocumentResolutionList Tests
 *
 * Tests for the document list component - rendering, selection,
 * strategy badges, and keyboard navigation.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentResolutionList } from '../components/merge-resolution/DocumentResolutionList.js';
import type { DocumentResolution } from '../hooks/useMergeResolution.js';

// =============================================================================
// Mock Data
// =============================================================================

const mockDocuments: DocumentResolution[] = [
  {
    documentId: 'doc-1',
    documentPath: '/home',
    strategy: 'accept-draft',
    cherryPickSelections: {},
    mergedSnapshot: null,
    crdtPreviewSnapshot: null,
    crdtPreviewLoading: false,
    crdtPreviewError: null,
    sourceSnapshot: null,
    targetSnapshot: null,
    conflictType: 'both-modified',
    classifiedFields: null,
  },
  {
    documentId: 'doc-2',
    documentPath: '/about',
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
  },
  {
    documentId: 'doc-3',
    documentPath: '/contact',
    strategy: 'accept-live',
    cherryPickSelections: {},
    mergedSnapshot: null,
    crdtPreviewSnapshot: null,
    crdtPreviewLoading: false,
    crdtPreviewError: null,
    sourceSnapshot: null,
    targetSnapshot: null,
    conflictType: 'both-modified',
    classifiedFields: null,
  },
];

describe('DocumentResolutionList', () => {
  const defaultProps = {
    documents: mockDocuments,
    currentIndex: 0,
    goToNext: vi.fn(),
    goToPrevious: vi.fn(),
    goToNextUnresolved: vi.fn(),
    goToDocument: vi.fn(),
    setStrategy: vi.fn(),
    setRemainingStrategy: vi.fn(),
  };

  it('renders document paths for all documents', () => {
    render(<DocumentResolutionList {...defaultProps} />);

    expect(screen.getByText('/home')).toBeDefined();
    expect(screen.getByText('/about')).toBeDefined();
    expect(screen.getByText('/contact')).toBeDefined();
  });

  it('shows strategy badge for each document', () => {
    render(<DocumentResolutionList {...defaultProps} />);

    expect(screen.getByText('Draft')).toBeDefined();
    expect(screen.getByText('Unresolved')).toBeDefined();
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('highlights currently selected document', () => {
    render(<DocumentResolutionList {...defaultProps} currentIndex={1} />);

    const items = screen.getAllByRole('listitem');
    expect(items[1].getAttribute('aria-selected')).toBe('true');
    expect(items[0].getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowDown/J moves selection to next document', () => {
    const goToNext = vi.fn();
    const { container } = render(
      <DocumentResolutionList {...defaultProps} goToNext={goToNext} />
    );

    fireEvent.keyDown(container.firstElementChild!, { key: 'ArrowDown' });
    expect(goToNext).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(container.firstElementChild!, { key: 'j' });
    expect(goToNext).toHaveBeenCalledTimes(2);
  });

  it('ArrowUp/K moves selection to previous document', () => {
    const goToPrevious = vi.fn();
    const { container } = render(
      <DocumentResolutionList {...defaultProps} goToPrevious={goToPrevious} />
    );

    fireEvent.keyDown(container.firstElementChild!, { key: 'ArrowUp' });
    expect(goToPrevious).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(container.firstElementChild!, { key: 'k' });
    expect(goToPrevious).toHaveBeenCalledTimes(2);
  });

  it('N key jumps to next unresolved', () => {
    const goToNextUnresolved = vi.fn();
    const { container } = render(
      <DocumentResolutionList
        {...defaultProps}
        goToNextUnresolved={goToNextUnresolved}
      />
    );

    fireEvent.keyDown(container.firstElementChild!, { key: 'n' });
    expect(goToNextUnresolved).toHaveBeenCalledTimes(1);
  });

  it('1/2/3/4 keys set strategy on current document', () => {
    const setStrategy = vi.fn();
    const { container } = render(
      <DocumentResolutionList
        {...defaultProps}
        currentIndex={0}
        setStrategy={setStrategy}
      />
    );

    fireEvent.keyDown(container.firstElementChild!, { key: '1' });
    expect(setStrategy).toHaveBeenCalledWith('doc-1', 'accept-draft');

    fireEvent.keyDown(container.firstElementChild!, { key: '2' });
    expect(setStrategy).toHaveBeenCalledWith('doc-1', 'accept-live');

    fireEvent.keyDown(container.firstElementChild!, { key: '3' });
    expect(setStrategy).toHaveBeenCalledWith('doc-1', 'cherry-pick');

    fireEvent.keyDown(container.firstElementChild!, { key: '4' });
    expect(setStrategy).toHaveBeenCalledWith('doc-1', 'crdt-preview');
  });

  it('Shift+D calls setRemainingStrategy with accept-draft', () => {
    const setRemainingStrategy = vi.fn();
    const { container } = render(
      <DocumentResolutionList
        {...defaultProps}
        setRemainingStrategy={setRemainingStrategy}
      />
    );

    fireEvent.keyDown(container.firstElementChild!, { key: 'D', shiftKey: true });
    expect(setRemainingStrategy).toHaveBeenCalledWith('accept-draft');
  });

  it('Shift+L calls setRemainingStrategy with accept-live', () => {
    const setRemainingStrategy = vi.fn();
    const { container } = render(
      <DocumentResolutionList
        {...defaultProps}
        setRemainingStrategy={setRemainingStrategy}
      />
    );

    fireEvent.keyDown(container.firstElementChild!, { key: 'L', shiftKey: true });
    expect(setRemainingStrategy).toHaveBeenCalledWith('accept-live');
  });

  it('keyboard shortcuts do not fire when input is focused', () => {
    const goToNext = vi.fn();
    const setStrategy = vi.fn();
    render(
      <DocumentResolutionList
        {...defaultProps}
        goToNext={goToNext}
        setStrategy={setStrategy}
      />
    );

    // Create and focus an input element
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Fire keyboard event on the focused input
    fireEvent.keyDown(input, { key: 'j' });
    fireEvent.keyDown(input, { key: '1' });

    expect(goToNext).not.toHaveBeenCalled();
    expect(setStrategy).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });
});
