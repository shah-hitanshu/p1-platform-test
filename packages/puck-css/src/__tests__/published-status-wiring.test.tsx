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
vi.mock('@pantheon-systems/css-client', () => ({
  CSSClient: vi.fn(),
}));

// Mock PuckDataSynchronizer and PuckSelectionTracker (used by CSSPlugin)
vi.mock('../editor/components/PuckDataSynchronizer', () => ({
  PuckDataSynchronizer: () => null,
}));
vi.mock('../editor/components/PuckSelectionTracker', () => ({
  PuckSelectionTracker: () => null,
}));
vi.mock('../core/CSSPuckContext', () => ({
  useCSSPuck: () => ({
    currentData: null,
    remoteSyncKey: null,
    currentDocument: null,
    viewingVersion: null,
    currentBranch: null,
    presence: null,
    publishDocument: vi.fn(),
    hasActiveHumans: false,
    humanPresenceCount: 0,
    siteId: 'site-1',
    siteName: 'Test Site',
    branchId: 'branch-1',
    createBranch: vi.fn(),
    _realtimeDataCaptureRef: null,
    _onRealtimeDataCapture: null,
  }),
  useCSSPuckOptional: () => ({
    currentData: null,
    remoteSyncKey: null,
    currentDocument: null,
    viewingVersion: null,
    currentBranch: null,
    presence: null,
    publishDocument: vi.fn(),
    hasActiveHumans: false,
    humanPresenceCount: 0,
    siteId: 'site-1',
    siteName: 'Test Site',
    branchId: 'branch-1',
    createBranch: vi.fn(),
    _realtimeDataCaptureRef: null,
    _onRealtimeDataCapture: null,
  }),
}));
// Mock @puckeditor/core so createUsePuck returns a hook that safely returns undefined
// instead of crashing when Puck's internal store context is not present in tests.
vi.mock('@puckeditor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@puckeditor/core')>();
  return {
    ...actual,
    createUsePuck: () => () => undefined,
  };
});

afterEach(() => {
  cleanup();
});

// ============================================================
// Header Published Status Badge Tests
// ============================================================

import { createCSSOverrides } from '../editor/plugin/createCSSOverrides.js';

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

    expect(overrides.headerActions).toBeDefined();
    render((overrides.headerActions as (props: { children: unknown }) => React.ReactElement)({ children: null }));

    expect(screen.getByText('Published')).toBeTruthy();
    const badge = screen.getByText('Published').closest('.pds-status-badge');
    expect(badge).toBeTruthy();
  });

  it('renders PublishedStatusBadge with "unpublished-changes" status', () => {
    const overrides = createCSSOverrides({
      ...baseOptions,
      publishedStatus: 'unpublished-changes',
    });

    expect(overrides.headerActions).toBeDefined();
    render((overrides.headerActions as (props: { children: unknown }) => React.ReactElement)({ children: null }));

    expect(screen.getByText('Unpublished changes')).toBeTruthy();
  });

  it('renders PublishedStatusBadge with "draft" status', () => {
    const overrides = createCSSOverrides({
      ...baseOptions,
      publishedStatus: 'draft',
    });

    expect(overrides.headerActions).toBeDefined();
    render((overrides.headerActions as (props: { children: unknown }) => React.ReactElement)({ children: null }));

    expect(screen.getByText('Unpublished')).toBeTruthy();
  });

  it('does not render PublishedStatusBadge when publishedStatus is not set', () => {
    const overrides = createCSSOverrides(baseOptions);

    expect(overrides.headerActions).toBeDefined();
    render((overrides.headerActions as (props: { children: unknown }) => React.ReactElement)({ children: null }));

    expect(screen.queryByText('Published')).toBeNull();
    expect(screen.queryByText('Unpublished')).toBeNull();
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

    expect(overrides.headerActions).toBeDefined();
    render((overrides.headerActions as (props: { children: unknown }) => React.ReactElement)({ children: null }));

    // Should show HistoricalVersionBanner instead
    expect(screen.queryByText('Published')).toBeNull();
    expect(screen.getByText('Return to current')).toBeTruthy();
  });
});

// ============================================================
// Version List VersionPublishedBadge Tests
// ============================================================

import { createCSSPlugin } from '../editor/plugin/CSSPlugin.js';

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

    // The badge should use the PDS badge classes
    const badge = badges[0].closest('.pds-badge');
    expect(badge).toBeTruthy();
    expect((badge as Element).className).toContain('pds-badge--info');
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

import { PageNavigator } from '../pds/components/PageNavigator.js';

describe('Document list branch indicators', () => {
  const localDoc = { id: 'doc1', path: '/local-page', archived: false, inherited: false };
  const inheritedDoc = { id: 'doc2', path: '/inherited-page', archived: false, inherited: true };

  it('marks all inherited documents with data-inherited="true" on a feature branch', () => {
    const multiInherited = [
      localDoc,
      inheritedDoc,
      { id: 'doc3', path: '/also-inherited', archived: false, inherited: true },
    ];

    render(
      <PageNavigator
        open={true}
        documents={multiInherited}
        currentDocument={null}
        isMainBranch={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const items = screen.getAllByTestId('page-navigator-item');
    const inheritedItems = items.filter(
      (el) => el.getAttribute('data-inherited') === 'true',
    );
    // Both inherited docs should carry the attribute; local doc should not
    expect(inheritedItems.length).toBe(2);
    const localItem = items.find((el) => el.textContent?.includes('/local-page'));
    expect(localItem).toBeDefined();
    expect((localItem as HTMLElement).getAttribute('data-inherited')).toBeNull();
  });

  it('renders inherited and local documents together when isMainBranch is false', () => {
    render(
      <PageNavigator
        open={true}
        documents={[localDoc, inheritedDoc]}
        currentDocument={null}
        isMainBranch={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Both paths are visible in the navigator
    expect(screen.getByText('/local-page')).toBeTruthy();
    expect(screen.getByText('/inherited-page')).toBeTruthy();

    const items = screen.getAllByTestId('page-navigator-item');
    expect(items.length).toBe(2);
  });

  it('treats all documents as local (no data-inherited) when isMainBranch prop is omitted', () => {
    render(
      <PageNavigator
        open={true}
        documents={[localDoc, inheritedDoc]}
        currentDocument={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const items = screen.getAllByTestId('page-navigator-item');
    // Without isMainBranch=false, no item should be flagged as inherited
    items.forEach((el) => {
      expect(el.getAttribute('data-inherited')).toBeNull();
    });
  });
});
