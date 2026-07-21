/**
 * Tests for published status derivation and wiring through convenience hooks.
 *
 * Validates:
 * - useP1Editor derives publishedStatus from DocumentVersion.isPublished field
 * - Correct publishedStatus for each scenario (published, unpublished-changes, draft)
 * - publishedStatus flows through to useP1Overrides options
 * - versionsLoading produces undefined publishedStatus
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

// ============================================================
// Mocks
// ============================================================

// Mock css-client
vi.mock('@pantheon-systems/css-client', () => ({
  P1Client: vi.fn(),
}));

// Mock PuckDataSynchronizer and PuckSelectionTracker (used by P1Plugin)
vi.mock('../editor/components/PuckDataSynchronizer', () => ({
  PuckDataSynchronizer: () => null,
}));
vi.mock('../editor/components/PuckSelectionTracker', () => ({
  PuckSelectionTracker: () => null,
}));

// Track what useP1Plugin and useP1Overrides receive
const capturedPluginOptions: Record<string, unknown>[] = [];
const capturedOverridesOptions: Record<string, unknown>[] = [];

// Mock useP1Plugin to capture options
vi.mock('../editor/useP1Plugin', () => ({
  useP1Plugin: vi.fn((options: Record<string, unknown>) => {
    capturedPluginOptions.push({ ...options });
    return { name: 'css-plugin', render: () => null };
  }),
}));

// Mock useP1Overrides to capture options
vi.mock('../editor/useP1Overrides', () => ({
  useP1Overrides: vi.fn((options: Record<string, unknown>) => {
    capturedOverridesOptions.push({ ...options });
    return {};
  }),
}));

// Mock useVersions
import { useVersions } from '../versioning/useVersions.js';
vi.mock('../versioning/useVersions', () => ({
  useVersions: vi.fn(),
}));
const mockUseVersions = vi.mocked(useVersions);

vi.mock('../auth/index.js', () => ({
  useP1Auth: () => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    token: null,
    error: null,
    authMode: 'mock' as const,
    isSessionExpired: false,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getToken: vi.fn().mockResolvedValue(null),
  }),
}));

// Default versions return value (no published versions — draft state)
const defaultVersionsReturn = {
  versions: [
    { id: 'v3', versionNumber: 3, isPublished: false },
    { id: 'v2', versionNumber: 2, isPublished: false },
    { id: 'v1', versionNumber: 1, isPublished: false },
  ],
  loading: false,
  refresh: vi.fn().mockResolvedValue(undefined),
};

// Build a mock P1PuckContextValue
const mockClient = { checkpoints: { list: vi.fn(), getDocuments: vi.fn() }, documents: { list: vi.fn() } };

function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    client: mockClient,
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument: { id: 'doc-1', path: '/home', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    currentData: { content: [], root: { props: {} }, zones: {} },
    safeData: { content: [], root: { props: {} }, zones: {} },
    saveStatus: 'idle' as const,
    lastSaved: null,
    saveError: null,
    loadDocument: vi.fn().mockResolvedValue(undefined),
    saveData: vi.fn(),
    saveNow: vi.fn().mockResolvedValue(undefined),
    createCheckpoint: vi.fn().mockResolvedValue({}),
    publishDocument: vi.fn().mockResolvedValue({}),
    switchBranch: vi.fn().mockResolvedValue(undefined),
    branches: [],
    currentBranch: null,
    refreshBranches: vi.fn().mockResolvedValue(undefined),
    branchesLoading: false,
    autoSavePaused: false,
    pauseAutoSave: vi.fn(),
    resumeAutoSave: vi.fn(),
    viewingVersion: null,
    latestVersionData: null,
    isViewingHistoricalVersion: false,
    loadVersion: vi.fn().mockResolvedValue(undefined),
    returnToLatest: vi.fn().mockResolvedValue(undefined),
    realtimeEnabled: false,
    realtimeConnected: false,
    remoteSyncKey: null,
    sendFocusRegions: vi.fn().mockReturnValue(false),
    getSaveStatus: vi.fn().mockReturnValue('idle'),
    getLastSaved: vi.fn().mockReturnValue(null),
    getSaveError: vi.fn().mockReturnValue(null),
    getHasUnsavedChanges: vi.fn().mockReturnValue(false),
    getSyncData: vi.fn().mockReturnValue(undefined),
    getDataSyncKey: vi.fn().mockReturnValue(undefined),
    documents: [],
    documentsLoading: false,
    presence: null,
    agentEdit: null,
    triggerAgent: null,
    conflicts: [],
    dismissConflict: vi.fn(),
    notifications: {
      notifications: [],
      addNotification: vi.fn().mockReturnValue('n1'),
      removeNotification: vi.fn(),
      clearNotifications: vi.fn(),
      addError: vi.fn().mockReturnValue('n1'),
      addSuccess: vi.fn().mockReturnValue('n1'),
      addWarning: vi.fn().mockReturnValue('n1'),
      addInfo: vi.fn().mockReturnValue('n1'),
    },
    ...overrides,
  };
}

// Mock P1PuckContext — will be configured per test via mockContextValue
let mockContextValue = createMockContext();

vi.mock('../core/P1PuckContext', () => ({
  useP1Puck: () => mockContextValue,
}));

// Import after mocks are set up
import { useP1Editor } from '../editor/useP1Editor.js';

beforeEach(() => {
  capturedPluginOptions.length = 0;
  capturedOverridesOptions.length = 0;
  mockContextValue = createMockContext();
  mockUseVersions.mockReturnValue({ ...defaultVersionsReturn });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ============================================================
// 1. Derived publishedStatus from version isPublished
// ============================================================

describe('derived publishedStatus from version isPublished', () => {
  it('returns "published" when the current version has isPublished: true', () => {
    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      versions: [
        { id: 'v3', versionNumber: 3, isPublished: true },
        { id: 'v2', versionNumber: 2, isPublished: false },
        { id: 'v1', versionNumber: 1, isPublished: false },
      ],
    });

    // viewingVersion is null, so current version = versions[0] = v3
    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('published');
  });

  it('returns "unpublished-changes" when a non-current version has isPublished: true', () => {
    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      versions: [
        { id: 'v3', versionNumber: 3, isPublished: false },
        { id: 'v2', versionNumber: 2, isPublished: true },
        { id: 'v1', versionNumber: 1, isPublished: false },
      ],
    });

    // viewingVersion is null, so current version = versions[0] = v3 (not published)
    // but v2 is published, so status = 'unpublished-changes'
    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('unpublished-changes');
  });

  it('returns "draft" when no version has isPublished: true', () => {
    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      versions: [
        { id: 'v3', versionNumber: 3, isPublished: false },
        { id: 'v2', versionNumber: 2, isPublished: false },
        { id: 'v1', versionNumber: 1, isPublished: false },
      ],
    });

    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('draft');
  });

  it('returns "published" when viewing a historical version that is published', () => {
    mockContextValue = createMockContext({
      viewingVersion: { id: 'v2', versionNumber: 2 },
    });

    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      versions: [
        { id: 'v3', versionNumber: 3, isPublished: false },
        { id: 'v2', versionNumber: 2, isPublished: true },
        { id: 'v1', versionNumber: 1, isPublished: false },
      ],
    });

    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    // Current version is v2 (viewing historical), which is published
    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('published');
  });
});

// ============================================================
// 2. publishedStatus flows to useP1Overrides
// ============================================================

describe('publishedStatus flows to useP1Overrides', () => {
  it('passes "published" when current version isPublished', () => {
    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      versions: [
        { id: 'v3', versionNumber: 3, isPublished: true },
        { id: 'v2', versionNumber: 2, isPublished: false },
        { id: 'v1', versionNumber: 1, isPublished: false },
      ],
    });

    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('published');
  });

  it('passes "unpublished-changes" when older version is published', () => {
    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      versions: [
        { id: 'v3', versionNumber: 3, isPublished: false },
        { id: 'v2', versionNumber: 2, isPublished: false },
        { id: 'v1', versionNumber: 1, isPublished: true },
      ],
    });

    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('unpublished-changes');
  });

  it('passes "draft" when no version is published', () => {
    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      versions: [
        { id: 'v3', versionNumber: 3, isPublished: false },
        { id: 'v2', versionNumber: 2, isPublished: false },
        { id: 'v1', versionNumber: 1, isPublished: false },
      ],
    });

    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('draft');
  });

  it('passes undefined when versionsLoading is true', () => {
    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      loading: true,
    });

    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBeUndefined();
  });
});

// ============================================================
// 3. Combined wiring
// ============================================================

describe('combined wiring of published status data', () => {
  it('overrides receive correct publishedStatus derived from versions', () => {
    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      versions: [
        { id: 'v3', versionNumber: 3, isPublished: true },
        { id: 'v2', versionNumber: 2, isPublished: false },
        { id: 'v1', versionNumber: 1, isPublished: false },
      ],
    });

    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    // Overrides get publishedStatus
    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('published');
  });

  it('consumer onPublishSuccess callback is still forwarded', () => {
    mockUseVersions.mockReturnValue({
      ...defaultVersionsReturn,
      versions: [
        { id: 'v3', versionNumber: 3, isPublished: true },
        { id: 'v2', versionNumber: 2, isPublished: false },
        { id: 'v1', versionNumber: 1, isPublished: false },
      ],
    });

    const onPublishSuccess = vi.fn();

    renderHook(() =>
      useP1Editor({
        documentPath: '/home',
        puckConfig: {},
        overrideOptions: { onPublishSuccess },
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('published');
    // onPublishSuccess is wrapped to also refresh versions,
    // but calling it should forward to the consumer's callback
    expect(lastOverridesCall.onPublishSuccess).toBeDefined();
    expect(lastOverridesCall.onPublishSuccess).not.toBe(onPublishSuccess);
    // Invoke the wrapper — consumer callback should be called
    const fakeCheckpoint = { id: 'cp1', name: 'test', branchId: 'b1', siteId: 's1', createdAt: '' };
    (lastOverridesCall.onPublishSuccess as (cp: unknown) => void)(fakeCheckpoint);
    expect(onPublishSuccess).toHaveBeenCalledWith(fakeCheckpoint);
  });
});

