/**
 * Tests for published status indicator wiring into header and version list.
 *
 * Validates:
 * - PublishedStatusBadge appears in header between SaveIndicator and PublishButton
 * - VersionPublishedBadge appears next to published versions in the version list
 * - Document list shows main-only documents with dimmed styling
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
// Mock css-client
vi.mock('@pantheon/css-client', () => ({
  CSSClient: vi.fn(),
}));

// Mock PuckDataSynchronizer and PuckSelectionTracker (used by CSSPlugin)
vi.mock('../components/PuckDataSynchronizer', () => ({
  PuckDataSynchronizer: () => null,
}));
vi.mock('../components/PuckSelectionTracker', () => ({
  PuckSelectionTracker: () => null,
}));
vi.mock('../CSSPuckContext', () => ({
  useCSSPuck: () => ({
    currentData: null,
    remoteSyncKey: null,
    currentDocument: null,
    viewingVersion: null,
  }),
}));

afterEach(() => {
  cleanup();
});

// ============================================================
// Header Published Status Badge Tests
// ============================================================

import { createCSSOverrides } from '../plugin/createCSSOverrides.js';

describe('Header PublishedStatusBadge wiring', () => {
  const baseOptions = {
    onRetrySave: vi.fn(),
    onPublish: vi.fn().mockResolvedValue({} as never),
  };

  it('renders PublishedStatusBadge with "published" status in header', () => {
    const overrides = createCSSOverrides({
      ...baseOptions,
      publishedStatus: 'published',
    });

    render(overrides.headerActions!({ children: null }));

    expect(screen.getByText('Published')).toBeTruthy();
    const badge = screen.getByText('Published').closest('.pds-status-badge');
    expect(badge).toBeTruthy();
  });

  it('renders PublishedStatusBadge with "unpublished-changes" status', () => {
    const overrides = createCSSOverrides({
      ...baseOptions,
      publishedStatus: 'unpublished-changes',
    });

    render(overrides.headerActions!({ children: null }));

    expect(screen.getByText('Unpublished changes')).toBeTruthy();
  });

  it('renders PublishedStatusBadge with "draft" status', () => {
    const overrides = createCSSOverrides({
      ...baseOptions,
      publishedStatus: 'draft',
    });

    render(overrides.headerActions!({ children: null }));

    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('does not render PublishedStatusBadge when publishedStatus is not set', () => {
    const overrides = createCSSOverrides(baseOptions);

    render(overrides.headerActions!({ children: null }));

    expect(screen.queryByText('Published')).toBeNull();
    expect(screen.queryByText('Draft')).toBeNull();
    expect(screen.queryByText('Unpublished changes')).toBeNull();
  });

  it('does not render PublishedStatusBadge when viewing historical version', () => {
    const overrides = createCSSOverrides({
      ...baseOptions,
      publishedStatus: 'published',
      isViewingHistoricalVersion: true,
      viewingVersion: {
        id: 'v1',
        versionNumber: 1,
        createdAt: '2024-01-01T00:00:00Z',
        documentId: 'doc1',
        branchId: 'branch1',
        snapshot: {},
        crdtState: null,
        source: 'edit' as const,
        createdById: 'user1',
        createdByType: 'user' as const,
      },
      onReturnToLatest: vi.fn(),
    });

    render(overrides.headerActions!({ children: null }));

    // Should show HistoricalVersionBanner instead
    expect(screen.queryByText('Published')).toBeNull();
    expect(screen.getByText('Return to current')).toBeTruthy();
  });
});

// ============================================================
// Version List VersionPublishedBadge Tests
// ============================================================

import { createCSSPlugin } from '../plugin/CSSPlugin.js';

describe('Version list VersionPublishedBadge wiring', () => {
  it('shows Published badge next to published versions', () => {
    const plugin = createCSSPlugin({
      branches: [],
      currentBranch: null,
      onBranchSwitch: vi.fn(),
      versions: [
        {
          id: 'v3',
          documentId: 'doc1',
          branchId: 'b1',
          versionNumber: 3,
          snapshot: {},
          crdtState: null,
          source: 'edit' as const,
          createdById: 'user1',
          createdByType: 'user' as const,
          createdAt: '2026-01-03T00:00:00Z',
          isPublished: false,
        },
        {
          id: 'v2',
          documentId: 'doc1',
          branchId: 'b1',
          versionNumber: 2,
          snapshot: {},
          crdtState: null,
          source: 'edit' as const,
          createdById: 'user1',
          createdByType: 'user' as const,
          createdAt: '2026-01-02T00:00:00Z',
          isPublished: true,
        },
      ],
    });

    render(plugin.render());

    // v2 should have a Published badge
    const badges = screen.getAllByText('Published');
    expect(badges.length).toBe(1);

    // The badge should be an indicator badge
    const badge = badges[0].closest('.pds-indicator-badge');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('pds-indicator-badge--success');
  });

  it('does not show Published badge when no version is published', () => {
    const plugin = createCSSPlugin({
      branches: [],
      currentBranch: null,
      onBranchSwitch: vi.fn(),
      versions: [
        {
          id: 'v1',
          documentId: 'doc1',
          branchId: 'b1',
          versionNumber: 1,
          snapshot: {},
          crdtState: null,
          source: 'edit' as const,
          createdById: 'user1',
          createdByType: 'user' as const,
          createdAt: '2026-01-01T00:00:00Z',
          isPublished: false,
        },
      ],
    });

    render(plugin.render());

    expect(screen.queryByText('Published')).toBeNull();
  });
});

// ============================================================
// Document List Branch Indicator Tests
// ============================================================

describe('Document list branch indicators', () => {
  it('renders inherited documents with dimmed styling on feature branch', () => {
    const plugin = createCSSPlugin({
      branches: [],
      currentBranch: { id: 'b1', name: 'feature', isMain: false, siteId: 's1', createdAt: '' },
      onBranchSwitch: vi.fn(),
      onDocumentSelect: vi.fn(),
      documents: [
        { id: 'doc1', path: '/local-page', siteId: 's1', archived: false, createdAt: '', updatedAt: '', inherited: false },
        { id: 'doc2', path: '/inherited-page', siteId: 's1', archived: false, createdAt: '', updatedAt: '', inherited: true },
      ],
    });

    render(plugin.render());

    // Both documents should render
    expect(screen.getByText('/local-page')).toBeTruthy();
    expect(screen.getByText('/inherited-page')).toBeTruthy();

    // The inherited document should have the dimmed class
    const inheritedItem = screen.getByText('/inherited-page').closest('.css-plugin-doc-item');
    expect(inheritedItem).toBeTruthy();
    expect(inheritedItem!.className).toContain('css-plugin-doc-item--main-only');

    // The local document should not
    const localItem = screen.getByText('/local-page').closest('.css-plugin-doc-item');
    expect(localItem!.className).not.toContain('css-plugin-doc-item--main-only');
  });

  it('shows status indicator label for inherited documents', () => {
    const plugin = createCSSPlugin({
      branches: [],
      currentBranch: { id: 'b1', name: 'feature', isMain: false, siteId: 's1', createdAt: '' },
      onBranchSwitch: vi.fn(),
      onDocumentSelect: vi.fn(),
      documents: [
        { id: 'doc2', path: '/inherited-page', siteId: 's1', archived: false, createdAt: '', updatedAt: '', inherited: true },
      ],
    });

    render(plugin.render());

    // Should show a "main only" label
    expect(screen.getByText('main only')).toBeTruthy();
    const indicator = screen.getByText('main only').closest('.pds-status-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator!.className).toContain('pds-status-indicator--neutral');
  });

  it('does not apply inherited styling when on the main branch', () => {
    const plugin = createCSSPlugin({
      branches: [],
      currentBranch: { id: 'b1', name: 'main', isMain: true, siteId: 's1', createdAt: '' },
      onBranchSwitch: vi.fn(),
      onDocumentSelect: vi.fn(),
      documents: [
        { id: 'doc1', path: '/page', siteId: 's1', archived: false, createdAt: '', updatedAt: '', inherited: true },
      ],
    });

    render(plugin.render());

    // On main branch, inherited flag should be ignored
    const item = screen.getByText('/page').closest('.css-plugin-doc-item');
    expect(item!.className).not.toContain('css-plugin-doc-item--main-only');
  });
});
