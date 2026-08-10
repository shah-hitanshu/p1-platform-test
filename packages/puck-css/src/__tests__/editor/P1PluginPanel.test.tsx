/**
 * Unit tests for P1PluginPanel behavior:
 * - Day grouping headers (Phase 2)
 * - All versions / Milestones filter (Phase 3)
 * - Kind tags and dots per row (Phase 4)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type React from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';

// Mock P1PuckContext so the plugin renders without a full provider
vi.mock('../../core/P1PuckContext', () => ({
  useP1Puck: () => ({
    currentDocument: { id: 'doc-1', path: '/' },
    isReturningToLatest: false,
    featureConfig: {},
    siteId: 'test-site',
    client: {},
    branchId: 'main',
    siteName: '',
  }),
  useP1PuckOptional: () => null,
}));

vi.mock('../../auth/index', () => ({ useOptionalP1Auth: () => null }));
vi.mock('../../p1/editor/hooks', () => ({ useEditorContext: () => ({ data: null }) }));
vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => () => null,
  usePuck: () => ({ dispatch: vi.fn() }),
}));
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return { ...actual, createPortal: (_node: React.ReactNode) => null };
});

// Import after mocks
import { createP1Plugin } from '../../editor/plugin/P1Plugin.js';

// ---------------------------------------------------------------------------
// Fixture versions — span two calendar days + older
// now = 2024-07-15T12:00:00 (local)
// ---------------------------------------------------------------------------
const NOW = new Date('2024-07-15T12:00:00');

function makeVersion(overrides: Partial<DocumentVersion> & { id: string; versionNumber: number; createdAt: string }): DocumentVersion {
  return {
    documentId: 'doc-1',
    branchId: 'branch-1',
    snapshot: {},
    crdtState: null,
    source: 'edit',
    createdById: 'user-1',
    createdByType: 'user',
    ...overrides,
  };
}

// Newest-first list (index 0 = current)
const vCurrent = makeVersion({ id: 'v-5', versionNumber: 5, createdAt: '2024-07-15T11:00:00' }); // Today
const vPublished = makeVersion({ id: 'v-4', versionNumber: 4, createdAt: '2024-07-15T09:00:00', isPublished: true }); // Today
const vRevert = makeVersion({ id: 'v-3', versionNumber: 3, createdAt: '2024-07-14T18:00:00', source: 'revert', sourceVersionId: 'v-1' }); // Yesterday, reverted to v1
const vAutosave = makeVersion({ id: 'v-2', versionNumber: 2, createdAt: '2024-07-14T10:00:00' }); // Yesterday
const vOld = makeVersion({ id: 'v-1', versionNumber: 1, createdAt: '2024-07-13T08:00:00' }); // Jul 13

const ALL_VERSIONS = [vCurrent, vPublished, vRevert, vAutosave, vOld];

interface RenderPanelOptions {
  onVersionSelect?: (v: DocumentVersion) => void;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPanel(
  versions = ALL_VERSIONS,
  selectedVersionId?: string,
  opts: RenderPanelOptions = {},
) {
  const plugin = createP1Plugin({
    branches: [],
    currentBranch: null,
    onBranchSwitch: () => {},
    versions,
    selectedVersionId,
    onVersionSelect: opts.onVersionSelect ?? vi.fn(),
  });

  // Render just the plugin's render() output (the panel)
  return render(plugin.render());
}

// ---------------------------------------------------------------------------
// Phase 2: Day grouping
// ---------------------------------------------------------------------------

describe('P1PluginPanel — day grouping', () => {
  it('renders a "Today" day header for versions from today', () => {
    renderPanel();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('renders a "Yesterday" day header for versions from yesterday', () => {
    renderPanel();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('renders an older date header for versions older than yesterday', () => {
    renderPanel();
    // Jul 13 — exact text depends on locale but must contain '13'
    const headers = document.querySelectorAll('.css-plugin-version-day-header');
    const texts = Array.from(headers).map((el) => el.textContent ?? '');
    expect(texts.some((t) => t.includes('13'))).toBe(true);
  });

  it('renders exactly 3 day headers for 3 distinct days', () => {
    renderPanel();
    const headers = document.querySelectorAll('.css-plugin-version-day-header');
    expect(headers.length).toBe(3);
  });

  it('renders all versions even when grouped', () => {
    renderPanel();
    expect(screen.getByText(/v5/)).toBeInTheDocument();
    expect(screen.getByText(/v4/)).toBeInTheDocument();
    expect(screen.getByText(/v3/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
    expect(screen.getAllByText(/v1/).length).toBeGreaterThan(0);
  });

  it('renders no day headers when versions list is empty', () => {
    renderPanel([]);
    const headers = document.querySelectorAll('.css-plugin-version-day-header');
    expect(headers.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: All versions / Milestones filter
// ---------------------------------------------------------------------------

describe('P1PluginPanel — filter control', () => {
  it('renders the "All versions" filter button', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /all versions/i })).toBeInTheDocument();
  });

  it('renders the "Milestones" filter button', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /milestones/i })).toBeInTheDocument();
  });

  it('"All versions" is active by default', () => {
    renderPanel();
    const allBtn = screen.getByRole('button', { name: /all versions/i });
    expect(allBtn.className).toContain('--active');
  });

  it('switching to Milestones hides autosave rows', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /milestones/i }));
    // vAutosave (v2) and vCurrent (v5, plain edit) should be hidden; vPublished and vRevert visible
    // v2 is a plain autosave — must not appear
    expect(screen.queryByText(/v2/)).not.toBeInTheDocument();
  });

  it('switching to Milestones keeps published and reverted rows', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /milestones/i }));
    expect(screen.getByText(/v4/)).toBeInTheDocument(); // published
    expect(screen.getByText(/v3/)).toBeInTheDocument(); // reverted
  });

  it('switching back to All versions restores hidden rows', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /milestones/i }));
    fireEvent.click(screen.getByRole('button', { name: /all versions/i }));
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it('"Milestones" button becomes active after click', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /milestones/i }));
    const msBtn = screen.getByRole('button', { name: /milestones/i });
    expect(msBtn.className).toContain('--active');
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Kind tags and dots
// ---------------------------------------------------------------------------

describe('P1PluginPanel — kind tags', () => {
  it('shows "Current" tag on the first (current) version row', () => {
    renderPanel();
    // The current version row should carry the CURRENT tag
    const tags = document.querySelectorAll('.css-plugin-version-kind-tag--current');
    expect(tags.length).toBeGreaterThan(0);
  });

  it('shows "Published" tag on an isPublished version', () => {
    renderPanel();
    const tags = document.querySelectorAll('.css-plugin-version-kind-tag--published');
    expect(tags.length).toBeGreaterThan(0);
  });

  it('shows "Reverted" tag on a source=revert version', () => {
    renderPanel();
    const tags = document.querySelectorAll('.css-plugin-version-kind-tag--reverted');
    expect(tags.length).toBeGreaterThan(0);
  });

  it('shows "Reverted to v#" label under byline for a revert version with sourceVersionId', () => {
    renderPanel();
    const label = document.querySelector('.css-plugin-version-revert-source');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('Reverted to v1');
  });

  it('does not show "Reverted to v#" label on non-revert versions', () => {
    renderPanel();
    const labels = document.querySelectorAll('.css-plugin-version-revert-source');
    // Only vRevert has sourceVersionId, so exactly one label
    expect(labels.length).toBe(1);
  });

  it('does not show any kind tag on plain autosave rows', () => {
    // v2 and v1 are plain autosaves — no tags
    renderPanel();
    const rows = document.querySelectorAll('.css-plugin-version-row');
    // Find the v2 row (index 3 in newest-first list)
    const v2Row = Array.from(rows).find((r) => r.textContent?.includes('v2'));
    expect(v2Row?.querySelector('.css-plugin-version-kind-tag')).toBeNull();
  });
});

describe('P1PluginPanel — kind dots', () => {
  it('applies --current modifier to the dot for the current version', () => {
    renderPanel();
    const dots = document.querySelectorAll('.css-plugin-version-dot--current');
    expect(dots.length).toBe(1);
  });

  it('applies --published modifier to the dot for a published version', () => {
    renderPanel();
    const dots = document.querySelectorAll('.css-plugin-version-dot--published');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('applies --reverted modifier to the dot for a reverted version', () => {
    renderPanel();
    const dots = document.querySelectorAll('.css-plugin-version-dot--reverted');
    expect(dots.length).toBeGreaterThan(0);
  });
});

