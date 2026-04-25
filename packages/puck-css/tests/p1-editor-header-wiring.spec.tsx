/**
 * P1 Editor Header Wiring Tests
 *
 * Verifies that createCSSPlugin wires P1EditorHeader and P1EditorSubheader
 * into Puck's override system and plugin render tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Dependency mocks — must be hoisted before any imports that use them
// ---------------------------------------------------------------------------

vi.mock('@pantheon/css-client', () => ({ CSSClient: vi.fn() }));

vi.mock('../src/components/PuckDataSynchronizer.js', () => ({
  PuckDataSynchronizer: () => null,
  _resetSyncTracking: () => {},
}));

vi.mock('../src/components/PuckSelectionTracker.js', () => ({
  PuckSelectionTracker: () => null,
}));

vi.mock('../src/components/PuckDataCapture.js', () => ({
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

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => {
    return <T,>(selector: (state: unknown) => T): T => {
      const state = {
        dispatch: mockDispatch,
        history: mockHistory,
        appState: { ui: {}, data: {} },
        selectedItem: null,
      };
      return selector(state);
    };
  },
}));

// Controllable CSS context state
const mockPublishDocument = vi.fn().mockResolvedValue({});

const mockCSSContext = {
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

vi.mock('../src/CSSPuckContext.js', () => ({
  useCSSPuck: () => mockCSSContext,
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
  }: Record<string, unknown>) => {
    const isMain = (currentBranch as { isMain: boolean } | null)?.isMain ?? true;
    return (
      <div data-testid="p1-editor-header">
        <span data-testid="site-name">{siteName as string}</span>
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
    humanActors,
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
      <span data-testid="human-count">{(humanActors as unknown[])?.length ?? 0}</span>
      <span data-testid="human-actor-avatar">
        {((humanActors as Array<{ avatar?: string }>)[0]?.avatar ?? '')}
      </span>
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
vi.mock('../src/components/merge-resolution/MergeReviewPage.js', () => ({
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

import { createCSSPlugin } from '../src/plugin/CSSPlugin.js';
import type { Branch, Document, ActorPresence } from '@pantheon/css-client';

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
  // Reset mutable mock state
  mockHistory.hasPast = false;
  mockHistory.hasFuture = false;
  mockCSSContext.currentDocument = {
    id: 'doc-1',
    path: '/home',
    isPublished: true,
    inherited: false,
  };
  mockCSSContext.currentBranch = {
    id: 'main',
    siteId: 'site-1',
    name: 'main',
    isMain: true,
    createdAt: '',
  };
  mockCSSContext.presence = null;
  mockCSSContext.hasActiveHumans = false;
  mockCSSContext.humanPresenceCount = 0;
});

function renderHeader(plugin: ReturnType<typeof createCSSPlugin>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerFn = (plugin.overrides as any)?.header as (() => React.ReactElement) | undefined;
  if (!headerFn) throw new Error('plugin.overrides.header not defined');
  return render(headerFn());
}

function renderPlugin(plugin: ReturnType<typeof createCSSPlugin>) {
  return render(<>{plugin.render()}</>);
}

// ---------------------------------------------------------------------------
// Tests: overrides.header — P1EditorHeader
// ---------------------------------------------------------------------------

describe('createCSSPlugin overrides.header — P1EditorHeader', () => {
  it('plugin exposes an overrides.header function', () => {
    const plugin = createCSSPlugin(baseOptions);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (plugin.overrides as any)?.header).toBe('function');
  });

  it('renders P1EditorHeader with the configured siteName', () => {
    const plugin = createCSSPlugin(baseOptions);
    renderHeader(plugin);
    expect(screen.getByTestId('site-name').textContent).toBe('Test Site');
  });

  it('renders the p1-subheader-slot anchor div', () => {
    const plugin = createCSSPlugin(baseOptions);
    const { container } = renderHeader(plugin);
    expect(container.querySelector('#p1-subheader-slot')).toBeTruthy();
  });

  it('does not render Compare with Live button on main branch', () => {
    const plugin = createCSSPlugin(baseOptions);
    renderHeader(plugin);
    expect(screen.queryByTestId('compare-with-live')).toBeNull();
  });

  it('renders Compare with Live button on non-main branch', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      currentBranch: draftBranch,
      branches: [mainBranch, draftBranch],
    });
    renderHeader(plugin);
    expect(screen.getByTestId('compare-with-live')).toBeTruthy();
  });

  it('calls consumer onCompareWithLive when provided and button is clicked', async () => {
    const onCompareWithLive = vi.fn();
    const plugin = createCSSPlugin({
      ...baseOptions,
      currentBranch: draftBranch,
      branches: [mainBranch, draftBranch],
      onCompareWithLive,
    });
    renderHeader(plugin);
    await act(async () => {
      screen.getByTestId('compare-with-live').click();
    });
    expect(onCompareWithLive).toHaveBeenCalledOnce();
  });

  it('shows built-in merge overlay when no onCompareWithLive and button is clicked', async () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      currentBranch: draftBranch,
      branches: [mainBranch, draftBranch],
    });
    renderHeader(plugin);
    await act(async () => {
      screen.getByTestId('compare-with-live').click();
    });
    expect(screen.getByTestId('merge-resolution-page')).toBeTruthy();
  });

  it('merge overlay is not full-viewport — top style clears the header', async () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      currentBranch: draftBranch,
      branches: [mainBranch, draftBranch],
    });
    renderHeader(plugin);
    await act(async () => {
      screen.getByTestId('compare-with-live').click();
    });
    const overlay = document.querySelector('[data-testid="merge-resolution-page"]')
      ?.closest('[style*="position"]') as HTMLElement | null;
    // Overlay should exist and not start at top: 0
    expect(overlay).toBeTruthy();
    expect(overlay!.style.top).not.toBe('0px');
    expect(overlay!.style.top).not.toBe('');
  });

  it('passes siteMenuItems to P1EditorHeader', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      siteMenuItems: [{ label: 'A', callback: vi.fn() }, { label: 'B', callback: vi.fn() }],
    });
    renderHeader(plugin);
    expect(screen.getByTestId('site-menu-count').textContent).toBe('2');
  });

  it('passes currentUser to P1EditorHeader when provided', () => {
    const plugin = createCSSPlugin({
      ...baseOptions,
      currentUser: { id: 'user-1', avatar: 'https://example.com/a.jpg' },
    });
    renderHeader(plugin);
    expect(screen.getByTestId('has-user').textContent).toBe('yes');
  });

  it('calls onBranchSwitch when branch is changed via P1EditorHeader', async () => {
    const onBranchSwitch = vi.fn();
    const plugin = createCSSPlugin({ ...baseOptions, onBranchSwitch });
    renderHeader(plugin);
    await act(async () => {
      screen.getByTestId('switch-branch-btn').click();
    });
    expect(onBranchSwitch).toHaveBeenCalledWith('draft-1');
  });

  it('calls onDocumentSelect when document is selected via P1EditorHeader', async () => {
    const onDocumentSelect = vi.fn();
    const plugin = createCSSPlugin({ ...baseOptions, onDocumentSelect });
    renderHeader(plugin);
    await act(async () => {
      screen.getByTestId('select-doc-btn').click();
    });
    expect(onDocumentSelect).toHaveBeenCalledWith('/about');
  });

  it('calls onLogout when logout is triggered via P1EditorHeader', async () => {
    const onLogout = vi.fn();
    const plugin = createCSSPlugin({ ...baseOptions, onLogout });
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

describe('createCSSPlugin render() — P1EditorSubheader portal', () => {
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
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('p1-editor-subheader')).toBeTruthy();
    });
  });

  it('undo button is disabled when hasPast is false', async () => {
    mockHistory.hasPast = false;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('undo-btn')).toBeDisabled();
    });
  });

  it('undo button is enabled when hasPast is true', async () => {
    mockHistory.hasPast = true;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('undo-btn')).not.toBeDisabled();
    });
  });

  it('redo button is disabled when hasFuture is false', async () => {
    mockHistory.hasFuture = false;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('redo-btn')).toBeDisabled();
    });
  });

  it('redo button is enabled when hasFuture is true', async () => {
    mockHistory.hasFuture = true;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('redo-btn')).not.toBeDisabled();
    });
  });

  it('hasDrift is always false', async () => {
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('has-drift').textContent).toBe('false');
    });
  });

  it('derives docState as "live" on main branch with published document', async () => {
    mockCSSContext.currentDocument = {
      id: 'doc-1',
      path: '/home',
      isPublished: true,
      inherited: false,
    };
    mockCSSContext.currentBranch = { ...mainBranch } as typeof mockCSSContext.currentBranch;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('doc-state').textContent).toBe('live');
    });
  });

  it('derives docState as "unpublished" on main branch with unpublished document', async () => {
    mockCSSContext.currentDocument = {
      id: 'doc-1',
      path: '/home',
      isPublished: false,
      inherited: false,
    };
    mockCSSContext.currentBranch = { ...mainBranch } as typeof mockCSSContext.currentBranch;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('doc-state').textContent).toBe('unpublished');
    });
  });

  it('derives docState as "modified" on a draft branch with local document', async () => {
    mockCSSContext.currentDocument = {
      id: 'doc-1',
      path: '/home',
      isPublished: false,
      inherited: false,
    };
    mockCSSContext.currentBranch = {
      ...draftBranch,
    } as typeof mockCSSContext.currentBranch;
    const plugin = createCSSPlugin({
      ...baseOptions,
      currentBranch: draftBranch,
    });
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('doc-state').textContent).toBe('modified');
    });
  });

  it('sets context to "main" when on main branch', async () => {
    mockCSSContext.currentBranch = { ...mainBranch } as typeof mockCSSContext.currentBranch;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('branch-context').textContent).toBe('main');
    });
  });

  it('sets context to "branch" when on a draft branch', async () => {
    mockCSSContext.currentBranch = {
      ...draftBranch,
    } as typeof mockCSSContext.currentBranch;
    const plugin = createCSSPlugin({
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
    mockCSSContext.presence = {
      actors: [agentPresence],
      agents: [agentPresence],
      humans: [],
      hasActiveHumans: false,
      hasActiveAgents: true,
      refresh: vi.fn(),
    } as unknown as typeof mockCSSContext.presence;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('agent-count').textContent).toBe('1');
    });
  });

  it('maps human presence actors to humanActors prop', async () => {
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
    mockCSSContext.hasActiveHumans = true;
    mockCSSContext.humanPresenceCount = 1;
    mockCSSContext.presence = {
      actors: [humanPresence],
      agents: [],
      humans: [humanPresence],
      hasActiveHumans: true,
      hasActiveAgents: false,
      refresh: vi.fn(),
    } as unknown as typeof mockCSSContext.presence;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('human-count').textContent).toBe('1');
    });
  });

  it('plumbs ActorPresence.avatar through humanActors to P1EditorSubheader', async () => {
    const humanPresenceWithAvatar: ActorPresence = {
      id: 'p-3',
      actorId: 'user-2',
      actorType: 'user',
      role: 'human',
      name: 'Bob Jones',
      state: 'active',
      lastActivityAt: '',
      joinedAt: '',
      avatar: 'https://lh3.googleusercontent.com/a/bob.jpg',
    };
    mockCSSContext.hasActiveHumans = true;
    mockCSSContext.humanPresenceCount = 1;
    mockCSSContext.presence = {
      actors: [humanPresenceWithAvatar],
      agents: [],
      humans: [humanPresenceWithAvatar],
      hasActiveHumans: true,
      hasActiveAgents: false,
      refresh: vi.fn(),
    } as unknown as typeof mockCSSContext.presence;
    const plugin = createCSSPlugin(baseOptions);
    renderPlugin(plugin);
    await waitFor(() => {
      expect(screen.getByTestId('human-actor-avatar').textContent).toBe(
        'https://lh3.googleusercontent.com/a/bob.jpg',
      );
    });
  });

  it('wires onPublish to css.publishDocument from context', async () => {
    const plugin = createCSSPlugin(baseOptions);
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
    const plugin = createCSSPlugin({ ...baseOptions, onPublish: customPublish });
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
