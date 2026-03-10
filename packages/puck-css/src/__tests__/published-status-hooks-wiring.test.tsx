/**
 * Tests for published status data wiring through convenience hooks.
 *
 * Validates:
 * - useCSSEditor calls usePublishedStatus with correct params
 * - Derived publishedStatus is correct for each scenario (published, unpublished-changes, draft)
 * - publishedVersionIds flows through to useCSSPlugin options
 * - publishedStatus flows through to useCSSOverrides options
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

// ============================================================
// Mocks
// ============================================================

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

// Track what useCSSPlugin and useCSSOverrides receive
const capturedPluginOptions: Record<string, unknown>[] = [];
const capturedOverridesOptions: Record<string, unknown>[] = [];

// Mock useCSSPlugin to capture options
vi.mock('../hooks/useCSSPlugin', () => ({
  useCSSPlugin: vi.fn((options: Record<string, unknown>) => {
    capturedPluginOptions.push({ ...options });
    return { name: 'css-plugin', render: () => null };
  }),
}));

// Mock useCSSOverrides to capture options
vi.mock('../hooks/useCSSOverrides', () => ({
  useCSSOverrides: vi.fn((options: Record<string, unknown>) => {
    capturedOverridesOptions.push({ ...options });
    return {};
  }),
}));

// Mock useVersions
vi.mock('../hooks/useVersions', () => ({
  useVersions: vi.fn(() => ({
    versions: [
      { id: 'v3', versionNumber: 3 },
      { id: 'v2', versionNumber: 2 },
      { id: 'v1', versionNumber: 1 },
    ],
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock usePublishedStatus — the core of these tests
import { usePublishedStatus } from '../hooks/usePublishedStatus.js';
vi.mock('../hooks/usePublishedStatus', () => ({
  usePublishedStatus: vi.fn(),
}));
const mockUsePublishedStatus = vi.mocked(usePublishedStatus);

// Default published status return value (draft state)
const defaultPublishedStatusReturn = {
  isCurrentVersionPublished: false,
  hasPublishedVersion: false,
  latestPublishedVersionId: null,
  publishedVersionIds: new Set<string>(),
  loading: false,
  refresh: vi.fn().mockResolvedValue(undefined),
};

// Build a mock CSSPuckContextValue
const mockClient = { checkpoints: { list: vi.fn(), getDocuments: vi.fn() } };

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

// Mock CSSPuckContext — will be configured per test via mockContextValue
let mockContextValue = createMockContext();

vi.mock('../CSSPuckContext', () => ({
  useCSSPuck: () => mockContextValue,
}));

// Import after mocks are set up
import { useCSSEditor } from '../hooks/useCSSEditor.js';

beforeEach(() => {
  capturedPluginOptions.length = 0;
  capturedOverridesOptions.length = 0;
  mockContextValue = createMockContext();
  mockUsePublishedStatus.mockReturnValue({ ...defaultPublishedStatusReturn });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ============================================================
// 1. useCSSEditor calls usePublishedStatus with correct params
// ============================================================

describe('useCSSEditor calls usePublishedStatus with correct params', () => {
  it('passes client, siteId, branchId, documentId, and currentVersionId from context', () => {
    mockContextValue = createMockContext({
      viewingVersion: { id: 'v2', versionNumber: 2 },
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    expect(mockUsePublishedStatus).toHaveBeenCalled();
    const params = mockUsePublishedStatus.mock.calls[0][0];

    expect(params.client).toBe(mockClient);
    expect(params.siteId).toBe('site-1');
    expect(params.branchId).toBe('branch-1');
    expect(params.documentId).toBe('doc-1');
    // When viewingVersion is set, its id is used as currentVersionId
    expect(params.currentVersionId).toBe('v2');
  });

  it('uses first version id as currentVersionId when viewingVersion is null', () => {
    mockContextValue = createMockContext({
      viewingVersion: null,
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const params = mockUsePublishedStatus.mock.calls[0][0];
    // Falls back to versions[0].id from the mocked useVersions
    expect(params.currentVersionId).toBe('v3');
  });

  it('passes empty string as documentId when currentDocument is null', () => {
    mockContextValue = createMockContext({
      currentDocument: null,
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const params = mockUsePublishedStatus.mock.calls[0][0];
    expect(params.documentId).toBe('');
  });
});

// ============================================================
// 2. Derived publishedStatus is correct for each scenario
// ============================================================

describe('derived publishedStatus mapping', () => {
  it('maps isCurrentVersionPublished=true to "published"', () => {
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      isCurrentVersionPublished: true,
      hasPublishedVersion: true,
      latestPublishedVersionId: 'v3',
      publishedVersionIds: new Set(['v3']),
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    // The overrides should receive publishedStatus = 'published'
    expect(capturedOverridesOptions.length).toBeGreaterThan(0);
    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('published');
  });

  it('maps isCurrentVersionPublished=false, hasPublishedVersion=true to "unpublished-changes"', () => {
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      isCurrentVersionPublished: false,
      hasPublishedVersion: true,
      latestPublishedVersionId: 'v2',
      publishedVersionIds: new Set(['v2']),
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('unpublished-changes');
  });

  it('maps isCurrentVersionPublished=false, hasPublishedVersion=false to "draft"', () => {
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      isCurrentVersionPublished: false,
      hasPublishedVersion: false,
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('draft');
  });
});

// ============================================================
// 3. publishedVersionIds flows through to plugin options
// ============================================================

describe('publishedVersionIds flows to useCSSPlugin', () => {
  it('passes publishedVersionIds from usePublishedStatus to useCSSPlugin', () => {
    const versionIds = new Set(['v2', 'v1']);
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      publishedVersionIds: versionIds,
      hasPublishedVersion: true,
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    expect(capturedPluginOptions.length).toBeGreaterThan(0);
    const lastPluginCall = capturedPluginOptions[capturedPluginOptions.length - 1];
    expect(lastPluginCall.publishedVersionIds).toBe(versionIds);
  });

  it('passes empty Set when no versions are published', () => {
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      publishedVersionIds: new Set(),
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastPluginCall = capturedPluginOptions[capturedPluginOptions.length - 1];
    expect(lastPluginCall.publishedVersionIds).toEqual(new Set());
  });
});

// ============================================================
// 4. publishedStatus flows through to overrides options
// ============================================================

describe('publishedStatus flows to useCSSOverrides', () => {
  it('passes "published" status to overrides when current version is published', () => {
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      isCurrentVersionPublished: true,
      hasPublishedVersion: true,
      publishedVersionIds: new Set(['v3']),
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('published');
  });

  it('passes "unpublished-changes" status to overrides when document has published version but current is not', () => {
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      isCurrentVersionPublished: false,
      hasPublishedVersion: true,
      publishedVersionIds: new Set(['v1']),
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('unpublished-changes');
  });

  it('passes "draft" status to overrides when document has never been published', () => {
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      isCurrentVersionPublished: false,
      hasPublishedVersion: false,
      publishedVersionIds: new Set(),
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('draft');
  });

  it('does not pass publishedStatus when usePublishedStatus is still loading', () => {
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      loading: true,
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    // When loading, publishedStatus should not be set (undefined)
    expect(lastOverridesCall.publishedStatus).toBeUndefined();
  });
});

// ============================================================
// 5. Combined wiring — both plugin and overrides receive data
// ============================================================

describe('combined wiring of published status data', () => {
  it('wires both publishedVersionIds to plugin and publishedStatus to overrides in a single render', () => {
    const versionIds = new Set(['v3', 'v1']);
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      isCurrentVersionPublished: true,
      hasPublishedVersion: true,
      latestPublishedVersionId: 'v3',
      publishedVersionIds: versionIds,
    });

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
      }),
    );

    // Plugin gets publishedVersionIds
    const lastPluginCall = capturedPluginOptions[capturedPluginOptions.length - 1];
    expect(lastPluginCall.publishedVersionIds).toBe(versionIds);

    // Overrides get publishedStatus
    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('published');
  });

  it('consumer overrideOptions are merged alongside publishedStatus', () => {
    mockUsePublishedStatus.mockReturnValue({
      ...defaultPublishedStatusReturn,
      isCurrentVersionPublished: true,
      hasPublishedVersion: true,
      publishedVersionIds: new Set(['v3']),
    });

    const onPublishSuccess = vi.fn();

    renderHook(() =>
      useCSSEditor({
        documentPath: '/home',
        puckConfig: {},
        overrideOptions: { onPublishSuccess },
      }),
    );

    const lastOverridesCall = capturedOverridesOptions[capturedOverridesOptions.length - 1];
    expect(lastOverridesCall.publishedStatus).toBe('published');
    // onPublishSuccess is wrapped to also refresh published status,
    // but calling it should forward to the consumer's callback
    expect(lastOverridesCall.onPublishSuccess).toBeDefined();
    expect(lastOverridesCall.onPublishSuccess).not.toBe(onPublishSuccess);
    // Invoke the wrapper — consumer callback should be called
    const fakeCheckpoint = { id: 'cp1', name: 'test', branchId: 'b1', siteId: 's1', createdAt: '' };
    (lastOverridesCall.onPublishSuccess as (cp: unknown) => void)(fakeCheckpoint);
    expect(onPublishSuccess).toHaveBeenCalledWith(fakeCheckpoint);
  });
});
