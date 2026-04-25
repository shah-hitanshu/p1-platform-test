/**
 * Tombstone/Archived Document Filtering Tests
 *
 * Tests that archived (tombstoned) documents are filtered from the
 * PageNavigator component's visible document list.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { PageNavigator } from '../pds/components/PageNavigator.js';
import type { PageNavigatorDocument } from '../pds/components/PageNavigator.js';

// =============================================================================
// Helpers
// =============================================================================

function makeDoc(
  overrides: Partial<PageNavigatorDocument> & { id: string; path: string },
): PageNavigatorDocument {
  return { archived: false, ...overrides };
}

const noop = vi.fn();

// =============================================================================
// Tests
// =============================================================================

afterEach(() => {
  cleanup();
});

describe('Tombstone/archived document filtering', () => {
  it('filters archived documents from the document list', () => {
    const documents: PageNavigatorDocument[] = [
      makeDoc({ id: 'doc-1', path: '/home' }),
      makeDoc({ id: 'doc-2', path: '/about', archived: true }),
      makeDoc({ id: 'doc-3', path: '/contact' }),
    ];

    render(
      <PageNavigator
        documents={documents}
        currentDocument={null}
        onSelect={noop}
        onClose={noop}
        open={true}
      />,
    );

    const items = screen.getAllByTestId('page-navigator-item');
    const paths = items.map((el) => el.textContent);

    expect(paths).toContain('/home');
    expect(paths).toContain('/contact');
    expect(paths).not.toContain('/about');
  });

  it('shows all non-archived documents when none are archived', () => {
    const documents: PageNavigatorDocument[] = [
      makeDoc({ id: 'doc-1', path: '/home' }),
      makeDoc({ id: 'doc-2', path: '/about' }),
    ];

    render(
      <PageNavigator
        documents={documents}
        currentDocument={null}
        onSelect={noop}
        onClose={noop}
        open={true}
      />,
    );

    const items = screen.getAllByTestId('page-navigator-item');
    const paths = items.map((el) => el.textContent);

    expect(paths).toContain('/home');
    expect(paths).toContain('/about');
    expect(items.length).toBe(2);
  });

  it('shows "No pages found" when all documents are archived', () => {
    const documents: PageNavigatorDocument[] = [
      makeDoc({ id: 'doc-1', path: '/home', archived: true }),
      makeDoc({ id: 'doc-2', path: '/about', archived: true }),
    ];

    render(
      <PageNavigator
        documents={documents}
        currentDocument={null}
        onSelect={noop}
        onClose={noop}
        open={true}
      />,
    );

    expect(screen.queryAllByTestId('page-navigator-item')).toHaveLength(0);
    expect(screen.getByText('No pages found')).toBeDefined();
  });
});
