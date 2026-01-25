/**
 * CSSPlugin Version History Tests
 *
 * Tests for the version history section of the CSS Plugin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createCSSPlugin } from '../src/plugin/index.js';
import type { Branch, DocumentVersion } from '@pantheon/css-client';

describe('CSSPlugin Version History', () => {
  const mockBranches: Branch[] = [
    { id: 'b1', name: 'main', siteId: 's1', isMain: true, createdAt: new Date().toISOString() },
  ];

  const mockVersions: DocumentVersion[] = [
    {
      id: 'v3',
      documentId: 'd1',
      versionNumber: 3,
      snapshot: {},
      createdAt: new Date('2024-01-03T12:00:00Z').toISOString(),
      createdBy: 'user1',
    },
    {
      id: 'v2',
      documentId: 'd1',
      versionNumber: 2,
      snapshot: {},
      createdAt: new Date('2024-01-02T12:00:00Z').toISOString(),
      createdBy: 'user1',
    },
    {
      id: 'v1',
      documentId: 'd1',
      versionNumber: 1,
      snapshot: {},
      createdAt: new Date('2024-01-01T12:00:00Z').toISOString(),
      createdBy: 'user1',
    },
  ];

  const baseOptions = {
    branches: mockBranches,
    currentBranch: mockBranches[0],
    onBranchSwitch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not show version section when no versions provided', () => {
    const plugin = createCSSPlugin(baseOptions);
    render(plugin.render());

    expect(screen.queryByText('Version History')).not.toBeInTheDocument();
  });

  it('should show version section when versions are provided', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      versions: mockVersions,
    });
    render(plugin.render());

    expect(screen.getByText('Version History')).toBeInTheDocument();
  });

  it('should display version numbers', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      versions: mockVersions,
    });
    render(plugin.render());

    expect(screen.getByText(/v3/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
    expect(screen.getByText(/v1/)).toBeInTheDocument();
  });

  it('should show loading state for versions', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      versions: [],
      versionsLoading: true,
    });
    render(plugin.render());

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('should show empty state when no versions and not loading', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      versions: [],
      versionsLoading: false,
      onVersionSelect: vi.fn(), // Trigger version section to show
    });
    render(plugin.render());

    expect(screen.getByText(/no versions/i)).toBeInTheDocument();
  });

  it('should call onVersionSelect when version is clicked', () => {
    const onVersionSelect = vi.fn();
    const plugin = createCSSPlugin({
      ...baseOptions,
      versions: mockVersions,
      onVersionSelect,
    });
    render(plugin.render());

    fireEvent.click(screen.getByText(/v2/));
    expect(onVersionSelect).toHaveBeenCalledWith(mockVersions[1]);
  });

  it('should highlight selected version', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      versions: mockVersions,
      selectedVersionId: 'v2',
    });
    render(plugin.render());

    const v2Item = screen.getByText(/v2/).closest('.css-plugin-version-item');
    expect(v2Item).toHaveClass('css-plugin-version-item--selected');
  });

  it('should show current badge on latest version', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      versions: mockVersions,
    });
    render(plugin.render());

    expect(screen.getByText(/current/i)).toBeInTheDocument();
  });

  it('should format version timestamps', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      versions: mockVersions,
    });
    render(plugin.render());

    // Should show some date format (we'll be flexible on exact format)
    const dateElements = screen.getAllByText(/Jan/i);
    expect(dateElements.length).toBeGreaterThan(0);
  });
});
