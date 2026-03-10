/**
 * Tests for usePublishedStatus hook and PublishedStatusBadge component.
 *
 * Validates:
 * - Hook correctly determines if current version is published
 * - Hook identifies which versions have been published
 * - Hook handles loading and error states
 * - Badge renders correct PDS status-badge markup and classes
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import React from 'react';

// Mock css-client
vi.mock('@pantheon/css-client', () => ({
  CSSClient: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

// ============================================================
// usePublishedStatus Hook Tests
// ============================================================

import { usePublishedStatus } from '../hooks/usePublishedStatus.js';

function createMockClient(overrides: {
  listCheckpoints?: () => Promise<unknown[]>;
  getCheckpointDocuments?: () => Promise<unknown[]>;
} = {}) {
  return {
    checkpoints: {
      list: overrides.listCheckpoints ?? vi.fn().mockResolvedValue([]),
      getDocuments: overrides.getCheckpointDocuments ?? vi.fn().mockResolvedValue([]),
    },
  } as never;
}

const baseParams = {
  siteId: 'site1',
  branchId: 'branch1',
  documentId: 'doc1',
};

describe('usePublishedStatus', () => {
  it('returns loading true initially', () => {
    const client = createMockClient({
      listCheckpoints: () => new Promise(() => {}), // never resolves
    });

    const { result } = renderHook(() =>
      usePublishedStatus({ client, ...baseParams })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.isCurrentVersionPublished).toBe(false);
    expect(result.current.hasPublishedVersion).toBe(false);
  });

  it('returns not published when no checkpoints exist', async () => {
    const client = createMockClient({
      listCheckpoints: vi.fn().mockResolvedValue([]),
    });

    const { result } = renderHook(() =>
      usePublishedStatus({ client, ...baseParams })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isCurrentVersionPublished).toBe(false);
    expect(result.current.hasPublishedVersion).toBe(false);
    expect(result.current.latestPublishedVersionId).toBeNull();
    expect(result.current.publishedVersionIds).toEqual(new Set());
  });

  it('returns published when latest checkpoint contains the document with matching version', async () => {
    const client = createMockClient({
      listCheckpoints: vi.fn().mockResolvedValue([
        { id: 'cp1', branchId: 'branch1', createdAt: '2026-01-01T00:00:00Z' },
      ]),
      getCheckpointDocuments: vi.fn().mockResolvedValue([
        { documentId: 'doc1', documentPath: '/page1', versionId: 'v5', versionNumber: 5 },
      ]),
    });

    const { result } = renderHook(() =>
      usePublishedStatus({ client, ...baseParams, currentVersionId: 'v5' })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isCurrentVersionPublished).toBe(true);
    expect(result.current.hasPublishedVersion).toBe(true);
    expect(result.current.latestPublishedVersionId).toBe('v5');
    expect(result.current.publishedVersionIds.has('v5')).toBe(true);
  });

  it('returns unpublished when latest checkpoint has a different version', async () => {
    const client = createMockClient({
      listCheckpoints: vi.fn().mockResolvedValue([
        { id: 'cp1', branchId: 'branch1', createdAt: '2026-01-01T00:00:00Z' },
      ]),
      getCheckpointDocuments: vi.fn().mockResolvedValue([
        { documentId: 'doc1', documentPath: '/page1', versionId: 'v3', versionNumber: 3 },
      ]),
    });

    const { result } = renderHook(() =>
      usePublishedStatus({ client, ...baseParams, currentVersionId: 'v5' })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isCurrentVersionPublished).toBe(false);
    expect(result.current.hasPublishedVersion).toBe(true);
    expect(result.current.latestPublishedVersionId).toBe('v3');
  });

  it('returns not published when checkpoint does not contain the document', async () => {
    const client = createMockClient({
      listCheckpoints: vi.fn().mockResolvedValue([
        { id: 'cp1', branchId: 'branch1', createdAt: '2026-01-01T00:00:00Z' },
      ]),
      getCheckpointDocuments: vi.fn().mockResolvedValue([
        { documentId: 'other-doc', documentPath: '/other', versionId: 'v1', versionNumber: 1 },
      ]),
    });

    const { result } = renderHook(() =>
      usePublishedStatus({ client, ...baseParams, currentVersionId: 'v5' })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isCurrentVersionPublished).toBe(false);
    expect(result.current.hasPublishedVersion).toBe(false);
    expect(result.current.latestPublishedVersionId).toBeNull();
  });

  it('collects published version IDs across multiple checkpoints', async () => {
    const getDocsMock = vi.fn()
      .mockResolvedValueOnce([
        { documentId: 'doc1', documentPath: '/page1', versionId: 'v5', versionNumber: 5 },
      ])
      .mockResolvedValueOnce([
        { documentId: 'doc1', documentPath: '/page1', versionId: 'v3', versionNumber: 3 },
      ]);

    const client = createMockClient({
      listCheckpoints: vi.fn().mockResolvedValue([
        { id: 'cp2', branchId: 'branch1', createdAt: '2026-01-02T00:00:00Z' },
        { id: 'cp1', branchId: 'branch1', createdAt: '2026-01-01T00:00:00Z' },
      ]),
      getCheckpointDocuments: getDocsMock,
    });

    const { result } = renderHook(() =>
      usePublishedStatus({ client, ...baseParams, currentVersionId: 'v5' })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.publishedVersionIds.has('v5')).toBe(true);
    expect(result.current.publishedVersionIds.has('v3')).toBe(true);
    expect(result.current.publishedVersionIds.size).toBe(2);
  });

  it('refresh re-fetches checkpoint data', async () => {
    const listMock = vi.fn().mockResolvedValue([]);
    const client = createMockClient({ listCheckpoints: listMock });

    const { result } = renderHook(() =>
      usePublishedStatus({ client, ...baseParams })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('does not fetch when documentId is empty', async () => {
    const listMock = vi.fn().mockResolvedValue([]);
    const client = createMockClient({ listCheckpoints: listMock });

    const { result } = renderHook(() =>
      usePublishedStatus({ client, siteId: 'site1', branchId: 'branch1', documentId: '' })
    );

    // Should not be loading when documentId is empty
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// PublishedStatusBadge Tests
// ============================================================

import { PublishedStatusBadge } from '../components/PublishedStatusBadge.js';

describe('PublishedStatusBadge', () => {
  it('renders "Published" badge with success status dot when published', () => {
    render(<PublishedStatusBadge status="published" />);

    const badge = screen.getByText('Published').closest('.pds-status-badge');
    expect(badge).toBeTruthy();
    expect(badge!.querySelector('.pds-status-badge__status--success')).toBeTruthy();
  });

  it('renders "Unpublished changes" badge with warning status dot', () => {
    render(<PublishedStatusBadge status="unpublished-changes" />);

    const badge = screen.getByText('Unpublished changes').closest('.pds-status-badge');
    expect(badge).toBeTruthy();
    expect(badge!.querySelector('.pds-status-badge__status--warning')).toBeTruthy();
  });

  it('renders "Draft" badge without status dot when never published', () => {
    render(<PublishedStatusBadge status="draft" />);

    const badge = screen.getByText('Draft').closest('.pds-status-badge');
    expect(badge).toBeTruthy();
    // Draft should not have a status dot
    expect(badge!.querySelector('.pds-status-badge__status')).toBeNull();
  });

  it('applies pds-status-badge--transparent class by default', () => {
    render(<PublishedStatusBadge status="published" />);

    const badge = screen.getByText('Published').closest('.pds-status-badge');
    expect(badge!.className).toContain('pds-status-badge--transparent');
  });

  it('accepts custom className', () => {
    render(<PublishedStatusBadge status="published" className="my-custom" />);

    const badge = screen.getByText('Published').closest('.pds-status-badge');
    expect(badge!.className).toContain('my-custom');
  });

  it('includes accessible status indicator text for screen readers', () => {
    render(<PublishedStatusBadge status="published" />);

    const srText = screen.getByText('Published')
      .closest('.pds-status-badge')!
      .querySelector('.visually-hidden');
    expect(srText).toBeTruthy();
  });
});

// ============================================================
// Version Published Indicator Badge Tests
// ============================================================

import { VersionPublishedBadge } from '../components/VersionPublishedBadge.js';

describe('VersionPublishedBadge', () => {
  it('renders indicator badge with success color and "Published" label', () => {
    render(<VersionPublishedBadge />);

    const badge = screen.getByText('Published').closest('.pds-indicator-badge');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('pds-indicator-badge--success');
    expect(badge!.className).toContain('pds-indicator-badge--sm');
  });

  it('renders nothing when isPublished is false', () => {
    const { container } = render(<VersionPublishedBadge isPublished={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders badge when isPublished is true (default)', () => {
    const { container } = render(<VersionPublishedBadge isPublished={true} />);
    expect(container.innerHTML).not.toBe('');
  });
});
