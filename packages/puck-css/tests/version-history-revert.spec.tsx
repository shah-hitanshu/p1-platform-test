/**
 * Version History Revert Tests
 *
 * TDD tests for the version revert feature:
 * 1-7:  P1PluginPanel revert button — visibility, label, spinner
 * 8-9:  createP1Plugin onRestoreVersion option wiring
 * 10-13: useP1Editor handleRestoreVersion callback sequence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import React from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';

// =============================================================================
// Module-level mocks (hoisted before imports)
// =============================================================================

vi.mock('@pantheon-systems/css-client', () => ({ P1Client: vi.fn() }));

vi.mock('../src/editor/components/PuckDataSynchronizer.js', () => ({
  PuckDataSynchronizer: () => null,
  _resetSyncTracking: () => {},
}));

vi.mock('../src/editor/components/PuckSelectionTracker.js', () => ({
  PuckSelectionTracker: () => null,
}));

vi.mock('../src/editor/components/PuckDataCapture.js', () => ({
  PuckDataCapture: () => null,
}));

// Stub createUsePuck so P1SubheaderBridge and PermissionRefresher don't crash
// when no Puck store context is provided in the test.
vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => () => undefined,
}));

// Mutable mock context — shared by tests that need P1PuckContext
const mockRestoreVersion = vi.fn();

const mockCssContext = {
  branchId: 'branch-1',
  siteId: 'site-1',
  currentDocument: { id: 'doc-1', path: '/home', siteId: 'site-1' } as {
    id: string; path: string; siteId: string;
  } | null,
  client: {
    versions: {
      restore: mockRestoreVersion,
    },
  } as unknown,
  loadDocument: vi.fn().mockResolvedValue(undefined),
  documents: [],
  documentsLoading: false,
  currentData: null,
  safeData: { content: [], root: { props: {} }, zones: {} },
  siteName: null,
  sendFocusRegions: vi.fn().mockReturnValue(false),
  isViewingHistoricalVersion: false,
  saveData: vi.fn(),
  publishDocument: vi.fn().mockResolvedValue({}),
  switchBranch: vi.fn(),
  createBranch: vi.fn(),
  returnToLatest: vi.fn().mockResolvedValue(undefined),
  loadVersion: vi.fn(),
  viewingVersion: null,
  userId: 'user-1',
  userRole: 'editor' as const,
  resolvePermissions: undefined,
  saveStatus: 'idle' as const,
  lastSaved: null,
  saveError: null,
  saveNow: vi.fn(),
  persistCurrentEdits: vi.fn().mockResolvedValue(undefined),
  createCheckpoint: vi.fn(),
  getSaveStatus: vi.fn().mockReturnValue('idle'),
  getLastSaved: vi.fn().mockReturnValue(null),
  getSaveError: vi.fn().mockReturnValue(null),
  getHasUnsavedChanges: vi.fn().mockReturnValue(false),
  getSyncData: vi.fn(),
  getDataSyncKey: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  branches: [],
  currentBranch: null,
  refreshBranches: vi.fn(),
  branchesLoading: false,
  autoSavePaused: false,
  pauseAutoSave: vi.fn(),
  resumeAutoSave: vi.fn(),
  latestVersionData: null,
  realtimeEnabled: false,
  realtimeConnected: false,
  remoteSyncKey: null,
  handleAction: vi.fn(),
  hasActiveHumans: false,
  humanPresenceCount: 0,
  hasActiveAgents: false,
  agentEdit: null,
  triggerAgent: vi.fn(),
  stopAgent: vi.fn(),
  conflicts: [],
  dismissConflict: vi.fn(),
  notifications: {
    addNotification: vi.fn(),
    notifications: [],
    dismissNotification: vi.fn(),
  },
  templates: [],
  templatesLoading: false,
  templatesError: null,
  createTemplate: vi.fn(),
  get presence() {
    return { actors: [], humans: [], agents: [], hasActiveHumans: false, hasActiveAgents: false };
  },
  _realtimeDataCaptureRef: null,
  _onRealtimeDataCapture: null,
};

vi.mock('../src/core/P1PuckContext.js', () => ({
  useP1Puck: () => mockCssContext,
  useP1PuckOptional: () => null,
}));

// Capture options passed to useP1Plugin so tests 10-13 can extract onRestoreVersion
const capturedPluginData: { options: Record<string, unknown> | null } = { options: null };

vi.mock('../src/editor/useP1Plugin.js', () => ({
  useP1Plugin: (opts: Record<string, unknown>) => {
    capturedPluginData.options = opts;
    return { name: 'css', label: 'History', icon: null, render: () => null };
  },
}));

vi.mock('../src/editor/useP1Overrides.js', () => ({
  useP1Overrides: () => ({}),
}));

// Mutable versions mock — refresh spy is replaced per-test in describe 3
const mockRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/versioning/useVersions.js', () => ({
  useVersions: () => ({
    versions: [],
    loading: false,
    refresh: mockRefresh,
  }),
}));

vi.mock('../src/editor/useComponentRegistry.js', () => ({
  useComponentRegistry: () => undefined,
}));

vi.mock('../src/editor/utils/buildThumbnailOverride.js', () => ({
  buildThumbnailOverride: () => ({}),
}));

vi.mock('../src/auth/index.js', () => ({
  useP1Auth: () => ({ user: null, logout: vi.fn() }),
}));

// =============================================================================
// Imports (after mocks)
// =============================================================================

import { VersionBannerOverride } from '../src/editor/components/VersionBannerOverride.js';
import bannerStyles from '../src/versioning/components/HistoricalVersionBanner.module.css';
import type { VersionBannerOverrideProps } from '../src/editor/components/VersionBannerOverride.js';
import { useP1Editor } from '../src/editor/useP1Editor.js';

// =============================================================================
// Shared test fixtures
// =============================================================================

const makeVersion = (id: string, versionNumber: number): DocumentVersion => ({
  id,
  documentId: 'doc-1',
  versionNumber,
  snapshot: { content: [], root: {} },
  createdAt: `2026-01-0${versionNumber}T10:00:00Z`,
  createdById: 'user-1',
  createdByType: 'user',
});

const LATEST = makeVersion('v3', 3);
const PRIOR = makeVersion('v2', 2);
const OLDEST = makeVersion('v1', 1);
const ALL_VERSIONS = [LATEST, PRIOR, OLDEST];

const BASE_OPTIONS = {
  branches: [],
  currentBranch: null,
  onBranchSwitch: vi.fn(),
};

// =============================================================================
// Describe 1: VersionBannerOverride revert button visibility and behavior (tests 1–7)
// =============================================================================

function renderBanner(props: Omit<VersionBannerOverrideProps, 'children'>) {
  return render(
    <VersionBannerOverride {...props}>
      <div />
    </VersionBannerOverride>
  );
}

describe('VersionBannerOverride: revert button', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: button appears with correct label when a non-latest version is selected
  it('shows "Revert to this version" button when a prior version is selected', () => {
    const onRestoreVersion = vi.fn().mockResolvedValue(undefined);
    renderBanner({ versions: ALL_VERSIONS, selectedVersionId: PRIOR.id, onRestoreVersion, canRevert: true });

    expect(screen.getByRole('button', { name: /revert to this version/i })).toBeInTheDocument();
  });

  // Test 2: button is absent for the latest (Current) version
  it('does NOT show the revert button for the latest version', () => {
    const onRestoreVersion = vi.fn().mockResolvedValue(undefined);
    renderBanner({ versions: ALL_VERSIONS, selectedVersionId: LATEST.id, onRestoreVersion, canRevert: true });

    expect(screen.queryByRole('button', { name: /revert to this version/i })).not.toBeInTheDocument();
  });

  // Test 3: button is absent when no version is selected
  it('does NOT show the revert button when no version is selected', () => {
    const onRestoreVersion = vi.fn().mockResolvedValue(undefined);
    renderBanner({ versions: ALL_VERSIONS, selectedVersionId: undefined, onRestoreVersion, canRevert: true });

    expect(screen.queryByRole('button', { name: /revert to this version/i })).not.toBeInTheDocument();
  });

  // Test 4: button is absent when onRestoreVersion is not provided
  it('does NOT show the revert button when onRestoreVersion is not provided', () => {
    renderBanner({ versions: ALL_VERSIONS, selectedVersionId: PRIOR.id, canRevert: true });

    expect(screen.queryByRole('button', { name: /revert to this version/i })).not.toBeInTheDocument();
  });

  // Test 5: button becomes a disabled spinner while the revert is in progress
  it('shows a spinner and disables the button while reverting is in progress', async () => {
    let resolveRevert!: () => void;
    const onRestoreVersion = vi.fn().mockReturnValue(
      new Promise<void>((res) => { resolveRevert = res; })
    );

    renderBanner({ versions: ALL_VERSIONS, selectedVersionId: PRIOR.id, onRestoreVersion, canRevert: true });

    const btn = screen.getByRole('button', { name: /revert to this version/i });
    fireEvent.click(btn);

    // During the async call the button should be disabled / replaced by spinner
    await waitFor(() => {
      const spinner = document.querySelector(`.${bannerStyles.spinner}`);
      expect(spinner).toBeInTheDocument();
    });

    // Clean up — resolve so the component can settle
    await act(async () => { resolveRevert(); });
  });

  // Test 6: spinner disappears after onRestoreVersion resolves
  it('removes the spinner after onRestoreVersion resolves', async () => {
    let resolveRevert!: () => void;
    const onRestoreVersion = vi.fn().mockReturnValue(
      new Promise<void>((res) => { resolveRevert = res; })
    );

    renderBanner({ versions: ALL_VERSIONS, selectedVersionId: PRIOR.id, onRestoreVersion, canRevert: true });

    fireEvent.click(screen.getByRole('button', { name: /revert to this version/i }));

    // Wait for spinner to appear
    await waitFor(() => {
      expect(document.querySelector(`.${bannerStyles.spinner}`)).toBeInTheDocument();
    });

    // Resolve the revert promise
    await act(async () => { resolveRevert(); });

    // Spinner gone (button returns to normal or version is no longer selected)
    await waitFor(() => {
      expect(document.querySelector(`.${bannerStyles.spinner}`)).not.toBeInTheDocument();
    });
  });

  // Test 7: onRestoreVersion is called with the correct version object on click
  it('calls onRestoreVersion with the correct version when clicked', async () => {
    const onRestoreVersion = vi.fn().mockResolvedValue(undefined);
    renderBanner({ versions: ALL_VERSIONS, selectedVersionId: PRIOR.id, onRestoreVersion, canRevert: true });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /revert to this version/i }));
    });

    expect(onRestoreVersion).toHaveBeenCalledWith(PRIOR);
  });
});

// =============================================================================
// Describe 2: VersionBannerOverride canRevert gating (tests 8–9)
// =============================================================================

describe('VersionBannerOverride: canRevert gating', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 8: when canRevert=true and onRestoreVersion is provided the button is shown
  it('shows the revert button when canRevert=true and onRestoreVersion is provided', () => {
    renderBanner({
      versions: ALL_VERSIONS,
      selectedVersionId: OLDEST.id,
      onRestoreVersion: vi.fn().mockResolvedValue(undefined),
      canRevert: true,
    });

    expect(screen.getByRole('button', { name: /revert to this version/i })).toBeInTheDocument();
  });

  // Test 9: when onRestoreVersion is absent the button is not shown even with canRevert=true
  it('omits the revert button when onRestoreVersion is not provided', () => {
    renderBanner({
      versions: ALL_VERSIONS,
      selectedVersionId: OLDEST.id,
      canRevert: true,
    });

    expect(screen.queryByRole('button', { name: /revert to this version/i })).not.toBeInTheDocument();
  });
});

// =============================================================================
// Describe 3: useP1Editor handleRestoreVersion callback (tests 10–13)
// =============================================================================

describe('useP1Editor: handleRestoreVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPluginData.options = null;
    mockCssContext.currentDocument = { id: 'doc-1', path: '/home', siteId: 'site-1' };
    mockCssContext.loadDocument = vi.fn().mockResolvedValue(undefined);
    mockRestoreVersion.mockResolvedValue({ id: 'v-new', versionNumber: 4, source: 'revert' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function getHandleRestoreVersion() {
    renderHook(() => useP1Editor({ documentPath: '/home', puckConfig: {} }));
    // Wait until useP1Plugin has been called and we've captured its options
    await waitFor(() => expect(capturedPluginData.options).not.toBeNull());
    const onRestoreVersion = capturedPluginData.options!['onRestoreVersion'] as
      ((v: DocumentVersion) => Promise<void>) | undefined;
    return onRestoreVersion;
  }

  // Test 10: calls the server-side restore endpoint with the version ID
  it('calls client.versions.restore() with siteId, branchId, documentId, and versionId', async () => {
    const onRestoreVersion = await getHandleRestoreVersion();

    expect(onRestoreVersion).toBeDefined();
    await onRestoreVersion!(PRIOR);

    expect(mockRestoreVersion).toHaveBeenCalledWith(
      'site-1',   // siteId
      'branch-1', // branchId
      'doc-1',    // documentId
      'v2',       // versionId (PRIOR.id)
    );
  });

  // Test 11: calls refreshVersions() (the useVersions refresh fn) after successful restore
  it('refreshes the versions list after a successful restore', async () => {
    const onRestoreVersion = await getHandleRestoreVersion();

    expect(onRestoreVersion).toBeDefined();
    await onRestoreVersion!(PRIOR);

    expect(mockRefresh).toHaveBeenCalled();
  });

  // Test 12: calls css.loadDocument() before refreshing versions
  it('calls loadDocument() then refreshes versions in order', async () => {
    const callOrder: string[] = [];
    mockRefresh.mockImplementation(async () => { callOrder.push('refresh'); });
    mockCssContext.loadDocument = vi.fn().mockImplementation(async () => { callOrder.push('loadDocument'); });

    const onRestoreVersion = await getHandleRestoreVersion();
    expect(onRestoreVersion).toBeDefined();

    // Clear any mount-effect calls (e.g. initial loadDocument on currentDocument load)
    callOrder.length = 0;

    await onRestoreVersion!(PRIOR);

    expect(callOrder).toEqual(['loadDocument', 'refresh']);
  });

  // Test 13: no-ops when currentDocument is null (edge case: doc unloaded mid-view)
  it('does not call versions.restore when currentDocument is null', async () => {
    mockCssContext.currentDocument = null;

    const onRestoreVersion = await getHandleRestoreVersion();

    expect(onRestoreVersion).toBeDefined();
    await onRestoreVersion!(PRIOR);

    expect(mockRestoreVersion).not.toHaveBeenCalled();
  });
});
