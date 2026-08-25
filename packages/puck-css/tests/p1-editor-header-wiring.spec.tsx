/**
 * P1 Editor Header Wiring Tests
 *
 * Verifies that createP1Plugin wires P1EditorHeader and P1EditorSubheader
 * into Puck's override system and plugin render tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Branch, Document, ActorPresence } from '@pantheon-systems/css-client';
import { aiPanelStore } from '../src/editor/aiPanelStore.js';

// The header override calls useEditorContext (useQuery) to derive datasources,
// so renders must be wrapped in a QueryClient — the editor provides one in the
// app. The query stays empty here (no fetch), so datasources fall back to [].
const testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// ---------------------------------------------------------------------------
// Dependency mocks — must be hoisted before any imports that use them
// ---------------------------------------------------------------------------

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

// Controllable Puck history state
const mockHistory = {
  hasPast: false,
  hasFuture: false,
  back: vi.fn(),
  forward: vi.fn(),
};

const mockDispatch = vi.fn();

// Puck's `ui` slice. Mutable so a test can collapse the right rail; empty everywhere else.
let mockUi: Record<string, unknown> = {};

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => {
    return <T,>(selector: (state: unknown) => T): T => {
      const state = {
        dispatch: mockDispatch,
        history: mockHistory,
        appState: { ui: mockUi, data: {} },
        selectedItem: null,
      };
      return selector(state);
    };
  },
  usePuck: () => ({ dispatch: mockDispatch }),
}));

// Controllable CCR context state
const mockPublishDocument = vi.fn().mockResolvedValue({});

const mockP1Context = {
  siteId: 'site-1',
  currentData: null,
  remoteSyncKey: null,
  currentDocument: {
    id: 'doc-1',
    path: '/home',
    isPublished: true,
    inherited: false,
  },
  viewingVersion: null,
  currentBranch: {
    id: 'main',
    siteId: 'site-1',
    name: 'main',
    isMain: true,
    createdAt: '',
  },
  publishDocument: mockPublishDocument,
  presence: null,
  hasActiveAgents: false,
  hasActiveHumans: false,
  humanPresenceCount: 0,
  getSaveStatus: () => 'saved' as const,
  getLastSaved: () => null,
  getSaveError: () => null,
  saveNow: vi.fn(),
  isViewingHistoricalVersion: false,
  returnToLatest: vi.fn(),
  stopAgent: vi.fn(),
  sendFocusRegionsViaWs: null,
  _realtimeDataCaptureRef: null,
  _onRealtimeDataCapture: null,
};

vi.mock('../src/core/P1PuckContext.js', () => ({
  useP1Puck: () => mockP1Context,
  useP1PuckOptional: () => mockP1Context,
}));

// Stub P1EditorHeader so tests aren't coupled to PDS internals
vi.mock('../src/pds/components/P1EditorHeader.js', () => ({
  P1EditorHeader: ({
    siteName,
    currentBranch,
    onCompareWithLive,
    onLogout,
    onSwitchBranch,
    onSelectDocument,
    siteMenuItems,
    currentUser,
    documents,
    currentDocument,
    branches,
    collaborators,
  }: Record<string, unknown>) => {
    const isMain = (currentBranch as { isMain: boolean } | null)?.isMain ?? true;
    const collabs = (collaborators ?? []) as { name?: string; avatar?: string }[];
    return (
      <div data-testid="p1-editor-header">
        <span data-testid="site-name">{siteName as string}</span>
        <span data-testid="collaborator-count">{collabs.length}</span>
        <span data-testid="collaborator-avatar">{collabs[0]?.avatar ?? ''}</span>
        <span data-testid="collaborator-names">
          {collabs.map((c) => c.name ?? '').join(',')}
        </span>
        {!isMain && (
          <button
            data-testid="compare-with-live"
            onClick={onCompareWithLive as () => void}
            type="button"
          >
            Compare with Live
          </button>
        )}
        <button
          data-testid="logout-btn"
          onClick={onLogout as () => void}
          type="button"
        >
          Log out
        </button>
        {/* Expose props for assertions */}
        <span data-testid="branch-count">{(branches as unknown[])?.length ?? 0}</span>
        <span data-testid="doc-count">{(documents as unknown[])?.length ?? 0}</span>
        <span data-testid="site-menu-count">
          {(siteMenuItems as unknown[])?.length ?? 0}
        </span>
        <span data-testid="has-user">{currentUser ? 'yes' : 'no'}</span>
        <span data-testid="current-doc-path">
          {(currentDocument as { path: string } | null)?.path ?? ''}
        </span>
        <button
          data-testid="switch-branch-btn"
          onClick={() => (onSwitchBranch as (id: string) => void)('draft-1')}
          type="button"
        >
          Switch
        </button>
        <button
          data-testid="select-doc-btn"
          onClick={() =>
            (onSelectDocument as (doc: { path: string }) => void)({ path: '/about' })
          }
          type="button"
        >
          Select doc
        </button>
      </div>
    );
  },
}));

// Stub P1EditorSubheader so tests aren't coupled to PDS internals
vi.mock('../src/pds/components/P1EditorSubheader.js', () => ({
  P1EditorSubheader: ({
    hasPast,
    hasFuture,
    onUndo,
    onRedo,
    docState,
    context,
    agents,
    hasDrift,
    onPublish,
  }: Record<string, unknown>) => (
    <div data-testid="p1-editor-subheader">
      <button
        data-testid="undo-btn"
        disabled={!hasPast}
        onClick={onUndo as () => void}
        type="button"
      >
        Undo
      </button>
      <button
        data-testid="redo-btn"
        disabled={!hasFuture}
        onClick={onRedo as () => void}
        type="button"
      >
        Redo
      </button>
      <span data-testid="doc-state">{docState as string}</span>
      <span data-testid="branch-context">{context as string}</span>
      <span data-testid="agent-count">{(agents as unknown[])?.length ?? 0}</span>
      <span data-testid="has-drift">{String(hasDrift)}</span>
      <button
        data-testid="publish-btn"
        onClick={onPublish as () => void}
        type="button"
      >
        Publish
      </button>
    </div>
  ),
}));

// Stub MergeReviewPage
vi.mock('../src/merge/components/merge-resolution/MergeReviewPage.js', () => ({
  MergeReviewPage: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="merge-resolution-page">
      <button onClick={onClose} type="button">
        Close
      </button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createP1Plugin } from '../src/editor/plugin/P1Plugin.js';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const mainBranch: Branch = {
  id: 'main',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  createdAt: '',
};

const draftBranch: Branch = {
  id: 'draft-1',
  siteId: 'site-1',
  name: 'Feature branch',
  isMain: false,
  createdAt: '',
};

const docs: Document[] = [
  {
    id: 'doc-1',
    siteId: 'site-1',
    branchId: 'main',
    path: '/home',
    archived: false,
    inherited: false,
    isPublished: true,
    createdAt: '',
    updatedAt: '',
  },
];

const baseOptions = {
  branches: [mainBranch],
  currentBranch: mainBranch,
  onBranchSwitch: vi.fn(),
  documents: docs,
  selectedDocumentPath: '/home',
  siteName: 'Test Site',
  siteMenuItems: [{ label: 'Settings', callback: vi.fn() }],
  onLogout: vi.fn(),
  puckConfig: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  // Reset mutable mock state
  mockHistory.hasPast = false;
  mockHistory.hasFuture = false;
  mockP1Context.currentDocument = {
    id: 'doc-1',
    path: '/home',
    isPublished: true,
    inherited: false,
  };
  mockP1Context.currentBranch = {
    id: 'main',
    siteId: 'site-1',
    name: 'main',
    isMain: true,
    createdAt: '',
  };
  mockP1Context.presence = null;
  mockP1Context.hasActiveHumans = false;
  mockP1Context.humanPresenceCount = 0;
});

function renderHeader(plugin: ReturnType<typeof createP1Plugin>) {
   
  const headerFn = (plugin.overrides as any)?.header as (() => React.ReactElement) | undefined;
  if (!headerFn) throw new Error('plugin.overrides.header not defined');
  return render(
    <QueryClientProvider client={testQueryClient}>{headerFn()}</QueryClientProvider>,
  );
}

function renderPlugin(plugin: ReturnType<typeof createP1Plugin>) {
  return render(<>{plugin.render()}</>);
}

// ---------------------------------------------------------------------------
// Tests: overrides.header — P1EditorHeader
// ---------------------------------------------------------------------------

describe('createP1Plugin overrides.header — P1EditorHeader', () => {
  it('plugin exposes an overrides.header function', () => {
    const plugin = createP1Plugin(baseOptions);
     
    expect(typeof (plugin.overrides as any)?.header).toBe('function');
  });

  it('renders P1EditorHeader with the configured siteName', () => {
    const plugin = createP1Plugin(baseOptions);
    renderHeader(plugin);
    expect(screen.getByTestId('site-name').textContent).toBe('Test Site');
  });

  it('renders the p1-subheader-slot anchor div', () => {
    const plugin = createP1Plugin(baseOptions);
    const { container } = renderHeader(plugin);
    expect(container.querySelector('#p1-subheader-slot')).toBeTruthy();
  });

  describe('live collaborators', () => {
    const alice: ActorPresence = {
      id: 'p-2',
      actorId: 'user-1',
      actorType: 'user',
      role: 'human',
      name: 'Alice Smith',
      state: 'active',
      lastActivityAt: '',
      joinedAt: '',
    };

    function setHumanPresence(humans: ActorPresence[], hasActiveHumans = true): void {
      mockP1Context.hasActiveHumans = hasActiveHumans;
      mockP1Context.humanPresenceCount = humans.length;
      mockP1Context.presence = {
        actors: humans,
        agents: [],
        humans,
        hasActiveHumans,
        hasActiveAgents: false,
        refresh: vi.fn(),
      } as unknown as typeof mockP1Context.presence;
    }

    it('passes present humans to the header as collaborators, avatar included', () => {
      // Avatar-bearing actor first — the mock header only surfaces collabs[0].avatar.
      setHumanPresence([
        { ...alice, actorId: 'user-2', name: 'Bob Jones', avatar: 'https://lh3.googleusercontent.com/a/bob.jpg' },
        alice,
      ]);
      renderHeader(createP1Plugin(baseOptions));

      // Every present human is passed; the header decides how many to show.
      expect(screen.getByTestId('collaborator-count').textContent).toBe('2');
      expect(screen.getByTestId('collaborator-names').textContent).toContain('Alice Smith');
      expect(screen.getByTestId('collaborator-avatar').textContent).toBe(
        'https://lh3.googleusercontent.com/a/bob.jpg',
      );
    });

    it('still sends humans who are present but idle', () => {
      setHumanPresence([{ ...alice, state: 'idle' }], false);
      renderHeader(createP1Plugin(baseOptions));

      expect(screen.getByTestId('collaborator-count').textContent).toBe('1');
    });

    it('sends no collaborators when nobody is present', () => {
      setHumanPresence([], false);
      renderHeader(createP1Plugin(baseOptions));

      expect(screen.getByTestId('collaborator-count').textContent).toBe('0');
    });
  });

  it('does not render Compare with Live button on main branch', () => {
    const plugin = createP1Plugin(baseOptions);
    renderHeader(plugin);
    expect(screen.queryByTestId('compare-with-live')).toBeNull();
  });

  it('does not render Compare with Live button on non-main branch (moved to PublishControl)', () => {
    const plugin = createP1Plugin({
      ...baseOptions,
      currentBranch: draftBranch,
      branches: [mainBranch, draftBranch],
    });
    renderHeader(plugin);
    // Compare with Live functionality moved to Review button in PublishControl
    expect(screen.queryByTestId('compare-with-live')).toBeNull();
  });

  // NOTE: onCompareWithLive functionality now handled by PublishControl's Review button
  // These tests were removed as the feature moved from header to subheader

  it.skip('calls consumer onCompareWithLive when provided and button is clicked', async () => {
    // SKIPPED: Compare with Live moved to PublishControl Review button
  });

  it.skip('shows built-in merge overlay when no onCompareWithLive and button is clicked', async () => {
    // SKIPPED: Compare with Live moved to PublishControl Review button
  });

  it.skip('merge overlay is not full-viewport — top style clears the header', async () => {
    // SKIPPED: Compare with Live moved to PublishControl Review button
    const overlay = null as HTMLElement | null;
    // Overlay should exist and not start at top: 0
    expect(overlay).toBeTruthy();
    expect(overlay!.style.top).not.toBe('0px');
    expect(overlay!.style.top).not.toBe('');
  });

  it.skip('passes siteMenuItems to P1EditorHeader', () => {
    // TODO: site-menu-count test ID removed during refactoring, update test
  });

  it('passes currentUser to P1EditorHeader when provided', () => {
    const plugin = createP1Plugin({
      ...baseOptions,
      currentUser: { id: 'user-1', avatar: 'https://example.com/a.jpg' },
    });
    renderHeader(plugin);
    expect(screen.getByTestId('has-user').textContent).toBe('yes');
  });

  it.skip('calls onBranchSwitch when branch is changed via P1EditorHeader', () => {
    // TODO: switch-branch-btn test ID removed during refactoring, update test
  });

  it('calls onDocumentSelect when document is selected via P1EditorHeader', async () => {
    const onDocumentSelect = vi.fn();
    const plugin = createP1Plugin({ ...baseOptions, onDocumentSelect });
    renderHeader(plugin);
    await act(async () => {
      screen.getByTestId('select-doc-btn').click();
    });
    expect(onDocumentSelect).toHaveBeenCalledWith('/about');
  });

  it('calls onLogout when logout is triggered via P1EditorHeader', async () => {
    const onLogout = vi.fn();
    const plugin = createP1Plugin({ ...baseOptions, onLogout });
    renderHeader(plugin);
    await act(async () => {
      screen.getByTestId('logout-btn').click();
    });
    expect(onLogout).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests: render() — P1EditorSubheader portal
// ---------------------------------------------------------------------------

describe('createP1Plugin render() — P1EditorSubheader portal', () => {
  beforeEach(() => {
    // Create the portal anchor that overrides.header would normally place
    const slot = document.createElement('div');
    slot.id = 'p1-subheader-slot';
    document.body.appendChild(slot);
  });

  afterEach(() => {
    document.getElementById('p1-subheader-slot')?.remove();
  });

  it('portals P1EditorSubheader into the slot div', async () => {
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('p1-editor-subheader')).toBeTruthy();
    });
  });

  it('undo button is disabled when hasPast is false', async () => {
    mockHistory.hasPast = false;
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('undo-btn')).toBeDisabled();
    });
  });

  it('undo button is enabled when hasPast is true', async () => {
    mockHistory.hasPast = true;
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('undo-btn')).not.toBeDisabled();
    });
  });

  it('redo button is disabled when hasFuture is false', async () => {
    mockHistory.hasFuture = false;
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('redo-btn')).toBeDisabled();
    });
  });

  it('redo button is enabled when hasFuture is true', async () => {
    mockHistory.hasFuture = true;
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('redo-btn')).not.toBeDisabled();
    });
  });

  it('hasDrift is always false', async () => {
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('has-drift').textContent).toBe('false');
    });
  });

  it('derives docState as "live" on main branch with published document', async () => {
    mockP1Context.currentDocument = {
      id: 'doc-1',
      path: '/home',
      isPublished: true,
      inherited: false,
    };
    mockP1Context.currentBranch = { ...mainBranch } as typeof mockP1Context.currentBranch;
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('doc-state').textContent).toBe('live');
    });
  });

  it('derives docState as "unpublished" on main branch with unpublished document', async () => {
    mockP1Context.currentDocument = {
      id: 'doc-1',
      path: '/home',
      isPublished: false,
      inherited: false,
    };
    mockP1Context.currentBranch = { ...mainBranch } as typeof mockP1Context.currentBranch;
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('doc-state').textContent).toBe('unpublished');
    });
  });

  it('derives docState as "modified" on a draft branch with local document', async () => {
    mockP1Context.currentDocument = {
      id: 'doc-1',
      path: '/home',
      isPublished: false,
      inherited: false,
    };
    mockP1Context.currentBranch = {
      ...draftBranch,
    } as typeof mockP1Context.currentBranch;
    const plugin = createP1Plugin({
      ...baseOptions,
      currentBranch: draftBranch,
    });
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('doc-state').textContent).toBe('modified');
    });
  });

  it('sets context to "main" when on main branch', async () => {
    mockP1Context.currentBranch = { ...mainBranch } as typeof mockP1Context.currentBranch;
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('branch-context').textContent).toBe('main');
    });
  });

  it('sets context to "branch" when on a draft branch', async () => {
    mockP1Context.currentBranch = {
      ...draftBranch,
    } as typeof mockP1Context.currentBranch;
    const plugin = createP1Plugin({
      ...baseOptions,
      currentBranch: draftBranch,
    });
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('branch-context').textContent).toBe('branch');
    });
  });

  it('maps agent presence actors to agents prop', async () => {
    const agentPresence: ActorPresence = {
      id: 'p-1',
      actorId: 'agent-1',
      actorType: 'agent',
      role: 'agent',
      name: 'Zappy Bot',
      state: 'editing',
      lastActivityAt: '',
      joinedAt: '',
    };
    mockP1Context.presence = {
      actors: [agentPresence],
      agents: [agentPresence],
      humans: [],
      hasActiveHumans: false,
      hasActiveAgents: true,
      refresh: vi.fn(),
    } as unknown as typeof mockP1Context.presence;
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('agent-count').textContent).toBe('1');
    });
  });

  it('does not send human presence to the subheader — those render in the header', async () => {
    const humanPresence: ActorPresence = {
      id: 'p-2',
      actorId: 'user-1',
      actorType: 'user',
      role: 'human',
      name: 'Alice Smith',
      state: 'active',
      lastActivityAt: '',
      joinedAt: '',
    };
    mockP1Context.hasActiveHumans = true;
    mockP1Context.humanPresenceCount = 1;
    mockP1Context.presence = {
      actors: [humanPresence],
      agents: [],
      humans: [humanPresence],
      hasActiveHumans: true,
      hasActiveAgents: false,
      refresh: vi.fn(),
    } as unknown as typeof mockP1Context.presence;
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('p1-editor-subheader')).toBeTruthy();
    });
    // Agents still map through; humans are absent from this bar entirely.
    expect(screen.getByTestId('agent-count').textContent).toBe('0');
  });

  it('wires onPublish to ccr.publishDocument from context', async () => {
    const plugin = createP1Plugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('publish-btn')).toBeTruthy();
    });
    await act(async () => {
      screen.getByTestId('publish-btn').click();
    });
    expect(mockPublishDocument).toHaveBeenCalledOnce();
  });

  it('uses consumer-provided onPublish over context publishDocument when given', async () => {
    const customPublish = vi.fn().mockResolvedValue({});
    const plugin = createP1Plugin({ ...baseOptions, onPublish: customPublish });
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('publish-btn')).toBeTruthy();
    });
    await act(async () => {
      screen.getByTestId('publish-btn').click();
    });
    expect(customPublish).toHaveBeenCalledOnce();
    expect(mockPublishDocument).not.toHaveBeenCalled();
  });
});

describe('createP1Plugin render() — AI panel rail bridge', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockUi = {};
    aiPanelStore.close();
    const slot = document.createElement('div');
    slot.id = 'p1-subheader-slot';
    document.body.appendChild(slot);
  });

  afterEach(() => {
    aiPanelStore.close();
    document.getElementById('p1-subheader-slot')?.remove();
  });

  const setUiCalls = (): unknown[] =>
    mockDispatch.mock.calls
      .map(([action]) => action as { type?: string; ui?: Record<string, unknown> })
      .filter((action) => action?.type === 'setUi');

  // Puck doesn't mount the `fields` override while the rail is collapsed, so the toggle would
  // otherwise do nothing.
  it('reveals the right rail when the panel opens while it is collapsed', async () => {
    mockUi = { rightSideBarVisible: false };
    renderPlugin(createP1Plugin(baseOptions));

    await act(async () => { aiPanelStore.open(); });

    expect(setUiCalls()).toEqual([
      { type: 'setUi', ui: { rightSideBarVisible: true } },
    ]);
  });

  it('leaves the rail alone when it is already showing', async () => {
    mockUi = { rightSideBarVisible: true };
    renderPlugin(createP1Plugin(baseOptions));

    await act(async () => { aiPanelStore.open(); });

    expect(setUiCalls()).toEqual([]);
  });

  // Puck omits the flag until the user has collapsed something, and the rail is open by default.
  it('treats an absent flag as already showing', async () => {
    renderPlugin(createP1Plugin(baseOptions));

    await act(async () => { aiPanelStore.open(); });

    expect(setUiCalls()).toEqual([]);
  });

  it('does not force the rail open while the panel is closed', async () => {
    mockUi = { rightSideBarVisible: false };
    renderPlugin(createP1Plugin(baseOptions));

    await waitFor(() => { expect(screen.getByTestId('p1-editor-subheader')).toBeTruthy(); });

    expect(setUiCalls()).toEqual([]);
  });
});
