/**
 * Document Create/Delete Button Tests
 *
 * Tests that the document creation (+) and deletion (×) buttons
 * are rendered in the CSS plugin panel when onDocumentCreate and
 * onDocumentDelete callbacks are provided, and that delete has
 * a confirmation step.
 *
 * Regression test: these buttons were lost when the context stopped
 * exposing createDocument/deleteDocument, so useCSSPlugin couldn't
 * wire them automatically.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createCSSPlugin } from '../plugin/index.js';
import type { Branch, Document } from '@pantheon/css-client';

// =============================================================================
// Mock Data
// =============================================================================

const mockBranch: Branch = {
  id: 'branch-1',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  createdAt: '2026-01-01T00:00:00Z',
};

function createDoc(overrides: Partial<Document> & { id: string; path: string }): Document {
  return {
    siteId: 'site-1',
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const mockDocuments: Document[] = [
  createDoc({ id: 'doc-1', path: '/home' }),
  createDoc({ id: 'doc-2', path: '/about' }),
];

// =============================================================================
// Tests: Document Creation Button
// =============================================================================

describe('Document creation button', () => {
  it('renders the "+" create button when onDocumentCreate is provided', () => {
    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      onDocumentCreate: vi.fn(),
    });

    render(<>{plugin.render()}</>);

    const createButton = screen.getByRole('button', { name: '+' });
    expect(createButton).toBeDefined();
  });

  it('does NOT render the "+" create button when onDocumentCreate is absent', () => {
    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      // onDocumentCreate intentionally omitted
    });

    render(<>{plugin.render()}</>);

    expect(screen.queryByRole('button', { name: '+' })).toBeNull();
  });

  it('shows the create form when "+" button is clicked', () => {
    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      onDocumentCreate: vi.fn(),
    });

    render(<>{plugin.render()}</>);

    fireEvent.click(screen.getByRole('button', { name: '+' }));

    expect(screen.getByPlaceholderText('/page-path')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDefined();
  });

  it('calls onDocumentCreate with the path when form is submitted', async () => {
    const onDocumentCreate = vi.fn().mockResolvedValue(undefined);

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      onDocumentCreate,
    });

    render(<>{plugin.render()}</>);

    // Open create form
    fireEvent.click(screen.getByRole('button', { name: '+' }));

    // Type a path
    const input = screen.getByPlaceholderText('/page-path');
    fireEvent.change(input, { target: { value: '/new-page' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onDocumentCreate).toHaveBeenCalledWith('new-page');
    });
  });

  it('strips leading slash from document path', async () => {
    const onDocumentCreate = vi.fn().mockResolvedValue(undefined);

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      onDocumentCreate,
    });

    render(<>{plugin.render()}</>);

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.change(screen.getByPlaceholderText('/page-path'), {
      target: { value: '/my-page' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onDocumentCreate).toHaveBeenCalledWith('my-page');
    });
  });

  it('shows error message when document creation fails', async () => {
    const onDocumentCreate = vi.fn().mockRejectedValue(new Error('Path already exists'));

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      onDocumentCreate,
    });

    render(<>{plugin.render()}</>);

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.change(screen.getByPlaceholderText('/page-path'), {
      target: { value: '/existing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText('Path already exists')).toBeDefined();
    });
  });
});

// =============================================================================
// Tests: Document Delete Button
// =============================================================================

describe('Document delete button', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, 'confirm');
  });

  it('renders delete buttons for each document when onDocumentDelete is provided', () => {
    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      onDocumentDelete: vi.fn(),
    });

    render(<>{plugin.render()}</>);

    const deleteButtons = screen.getAllByRole('button', { name: /Delete/ });
    expect(deleteButtons).toHaveLength(2);
  });

  it('does NOT render delete buttons when onDocumentDelete is absent', () => {
    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      // onDocumentDelete intentionally omitted
    });

    render(<>{plugin.render()}</>);

    expect(screen.queryAllByRole('button', { name: /Delete/ })).toHaveLength(0);
  });

  it('shows confirmation dialog before deleting', () => {
    confirmSpy.mockReturnValue(false);

    const onDocumentDelete = vi.fn();

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      onDocumentDelete,
    });

    render(<>{plugin.render()}</>);

    const deleteButtons = screen.getAllByRole('button', { name: /Delete/ });
    fireEvent.click(deleteButtons[0]!);

    expect(confirmSpy).toHaveBeenCalledWith('Delete "/home"?');
    expect(onDocumentDelete).not.toHaveBeenCalled();
  });

  it('calls onDocumentDelete when user confirms deletion', async () => {
    confirmSpy.mockReturnValue(true);

    const onDocumentDelete = vi.fn().mockResolvedValue(undefined);

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      onDocumentDelete,
    });

    render(<>{plugin.render()}</>);

    const deleteButtons = screen.getAllByRole('button', { name: /Delete/ });
    fireEvent.click(deleteButtons[0]!);

    await waitFor(() => {
      expect(onDocumentDelete).toHaveBeenCalledWith('doc-1', '/home');
    });
  });

  it('does NOT call onDocumentDelete when user cancels deletion', () => {
    confirmSpy.mockReturnValue(false);

    const onDocumentDelete = vi.fn();

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents: mockDocuments,
      onDocumentSelect: vi.fn(),
      onDocumentDelete,
    });

    render(<>{plugin.render()}</>);

    const deleteButtons = screen.getAllByRole('button', { name: /Delete/ });
    fireEvent.click(deleteButtons[1]!);

    expect(confirmSpy).toHaveBeenCalledWith('Delete "/about"?');
    expect(onDocumentDelete).not.toHaveBeenCalled();
  });
});

