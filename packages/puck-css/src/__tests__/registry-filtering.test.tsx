/**
 * Registry Document Filtering Tests
 *
 * Tests that /_registry/ documents are filtered from the plugin document list
 * while normal documents (including archived ones) remain handled correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { createCSSPlugin } from '../plugin/index.js';
import type { Branch, Document } from '@pantheon/css-client';

const mockBranch: Branch = {
  id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true, createdAt: '2026-01-01T00:00:00Z',
};

function createDoc(overrides: Partial<Document> & { id: string; path: string }): Document {
  return { siteId: 'site-1', archived: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides };
}

describe('Registry document filtering', () => {
  it('hides /_registry/ documents from the plugin document list', () => {
    const documents: Document[] = [
      createDoc({ id: 'doc-home', path: '/home' }),
      createDoc({ id: 'doc-about', path: '/about' }),
      createDoc({ id: 'doc-reg-index', path: '/_registry/index' }),
      createDoc({ id: 'doc-reg-hero', path: '/_registry/components/HeroBlock' }),
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
    expect(screen.queryByText('/_registry/index')).toBeNull();
    expect(screen.queryByText('/_registry/components/HeroBlock')).toBeNull();
  });

  it('still shows non-registry documents alongside normal filter (archived)', () => {
    const documents: Document[] = [
      createDoc({ id: 'doc-home', path: '/home' }),
      createDoc({ id: 'doc-archived', path: '/old', archived: true }),
      createDoc({ id: 'doc-reg', path: '/_registry/index' }),
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
    expect(screen.queryByText('/old')).toBeNull();
    expect(screen.queryByText('/_registry/index')).toBeNull();
  });
});
