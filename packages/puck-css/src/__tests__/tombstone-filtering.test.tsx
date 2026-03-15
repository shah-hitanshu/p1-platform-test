/**
 * Tombstone/Archived Document Filtering Tests
 *
 * Tests that archived (tombstoned) documents are filtered from the
 * Puck editor's document list in the CSS plugin panel.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
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

// =============================================================================
// Tests
// =============================================================================

describe('Tombstone/archived document filtering', () => {
  it('filters archived documents from the document list', () => {
    const documents: Document[] = [
      createDoc({ id: 'doc-1', path: '/home' }),
      createDoc({ id: 'doc-2', path: '/about', archived: true }),
      createDoc({ id: 'doc-3', path: '/contact' }),
    ];

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents,
      onDocumentSelect: vi.fn(),
    });

    render(<>{plugin.render()}</>);

    expect(screen.getByText('/home')).toBeDefined();
    expect(screen.getByText('/contact')).toBeDefined();
    expect(screen.queryByText('/about')).toBeNull();
  });

  it('shows all documents when none are archived', () => {
    const documents: Document[] = [
      createDoc({ id: 'doc-1', path: '/home' }),
      createDoc({ id: 'doc-2', path: '/about' }),
    ];

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents,
      onDocumentSelect: vi.fn(),
    });

    render(<>{plugin.render()}</>);

    expect(screen.getByText('/home')).toBeDefined();
    expect(screen.getByText('/about')).toBeDefined();
  });

  it('shows empty state when all documents are archived', () => {
    const documents: Document[] = [
      createDoc({ id: 'doc-1', path: '/home', archived: true }),
      createDoc({ id: 'doc-2', path: '/about', archived: true }),
    ];

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents,
      onDocumentSelect: vi.fn(),
    });

    render(<>{plugin.render()}</>);

    expect(screen.getByText('No documents yet')).toBeDefined();
  });
});
