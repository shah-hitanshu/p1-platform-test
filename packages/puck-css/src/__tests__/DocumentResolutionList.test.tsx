/**
 * DocumentResolutionList Tests
 *
 * Tests for the document list component - rendering, selection,
 * strategy badges, diff count badges, and keyboard navigation.
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
    changeType: 'conflicting',
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
    changeType: 'conflicting',
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
    changeType: 'draft-changed',
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
    onToggleDetail: vi.fn(),
  };

  it('renders document paths for all documents', () => {
    render(<DocumentResolutionList {...defaultProps} />);

    expect(screen.getByText('/home')).toBeDefined();
    expect(screen.getByText('/about')).toBeDefined();
    expect(screen.getByText('/contact')).toBeDefined();
  });

  it('shows strategy badge for conflicting docs and change type badge for non-conflicting', () => {
    render(<DocumentResolutionList {...defaultProps} />);

    // doc-1: changeType='conflicting', strategy='accept-draft' => shows "Draft"
    expect(screen.getByText('Draft')).toBeDefined();
    // doc-2: changeType='conflicting', strategy='unresolved' => shows "Unresolved"
    expect(screen.getByText('Unresolved')).toBeDefined();
    // doc-3: changeType='changed' => shows change type label "Changed" instead of strategy
    expect(screen.getByText('Changed')).toBeDefined();
  });

  it('highlights currently selected document', () => {
    render(<DocumentResolutionList {...defaultProps} currentIndex={1} />);

    const items = screen.getAllByRole('listitem');
    expect(items[1].getAttribute('aria-selected')).toBe('true');
    expect(items[0].getAttribute('aria-selected')).toBe('false');
  });

  it('uses semantic ul element', () => {
    const { container } = render(<DocumentResolutionList {...defaultProps} />);

    const list = container.querySelector('ul');
    expect(list).not.toBeNull();
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

  it('Enter key calls onToggleDetail', () => {
    const onToggleDetail = vi.fn();
    const { container } = render(
      <DocumentResolutionList
        {...defaultProps}
        onToggleDetail={onToggleDetail}
      />
    );

    fireEvent.keyDown(container.firstElementChild!, { key: 'Enter' });
    expect(onToggleDetail).toHaveBeenCalledTimes(1);
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

  it('keyboard shortcuts do not fire when contentEditable element is focused', () => {
    const goToNext = vi.fn();
    render(
      <DocumentResolutionList
        {...defaultProps}
        goToNext={goToNext}
      />
    );

    // Create and focus a contentEditable element
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    div.focus();

    // Fire keyboard event on the contentEditable element
    fireEvent.keyDown(div, { key: 'j' });

    expect(goToNext).not.toHaveBeenCalled();

    document.body.removeChild(div);
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

  // ===== New tests for diff count badges =====

  it('shows diff count badges when diffCounts provided', () => {
    const diffCounts = new Map([
      ['doc-1', { added: 2, removed: 0, modified: 1 }],
    ]);

    render(
      <DocumentResolutionList
        {...defaultProps}
        diffCounts={diffCounts}
      />
    );

    expect(screen.getByText('+2 added')).toBeDefined();
    expect(screen.getByText('~1 modified')).toBeDefined();
    // removed count is 0, so no badge shown
    expect(screen.queryByText(/-\d+ removed/)).toBeNull();
  });

  it('does not show diff badges for zero-count categories', () => {
    const diffCounts = new Map([
      ['doc-1', { added: 0, removed: 0, modified: 3 }],
    ]);

    render(
      <DocumentResolutionList
        {...defaultProps}
        diffCounts={diffCounts}
      />
    );

    expect(screen.getByText('~3 modified')).toBeDefined();
    expect(screen.queryByText(/added/)).toBeNull();
    expect(screen.queryByText(/removed/)).toBeNull();
  });

  it('does not show diff badges when diffCounts is not provided', () => {
    render(<DocumentResolutionList {...defaultProps} />);

    expect(screen.queryByText(/added/)).toBeNull();
    expect(screen.queryByText(/removed/)).toBeNull();
    expect(screen.queryByText(/modified/)).toBeNull();
  });
});
