/**
 * Registry Document Filtering Tests
 *
 * Tests that /_registry/ documents (and any path starting with `_` after
 * normalizing a leading slash) are filtered from the PageNavigator's visible
 * list while normal documents remain visible.
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

describe('Registry document filtering', () => {
  it('hides /_registry/ documents from the list', () => {
    const documents: PageNavigatorDocument[] = [
      makeDoc({ id: 'doc-home', path: '/home' }),
      makeDoc({ id: 'doc-about', path: '/about' }),
      makeDoc({ id: 'doc-reg-index', path: '/_registry/index' }),
      makeDoc({ id: 'doc-reg-hero', path: '/_registry/components/HeroBlock' }),
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
    expect(paths).not.toContain('/_registry/index');
    expect(paths).not.toContain('/_registry/components/HeroBlock');
    expect(items.length).toBe(2);
  });

  it('still shows non-registry documents when registry and archived docs are also present', () => {
    const documents: PageNavigatorDocument[] = [
      makeDoc({ id: 'doc-home', path: '/home' }),
      makeDoc({ id: 'doc-archived', path: '/old', archived: true }),
      makeDoc({ id: 'doc-reg', path: '/_registry/index' }),
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
    expect(paths).not.toContain('/old');
    expect(paths).not.toContain('/_registry/index');
    expect(items.length).toBe(1);
  });
});
