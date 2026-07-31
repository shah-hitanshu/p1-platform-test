/**
 * P1PuckProvider Save Durability Tests
 *
 * A debounced (REST-path) save must never be dropped or misdirected:
 * - switching documents flushes the outgoing document's pending save
 * - a pending save never fires against a newly loaded document
 * - closing/hiding the tab flushes the pending save (best effort)
 * - the first edit after a load is saved even when Puck skips the
 *   identical-data onChange echo of the loaded snapshot
 * - a pin toggle (root-props _pinMap edit) reaches the saved snapshot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch, PuckData } from '@pantheon-systems/css-client';
import { useP1Puck } from '../src/core/P1PuckContext.js';

// =============================================================================
// Mock useRealtime hook (realtime disabled in these tests; REST path only)
// =============================================================================

vi.mock('../src/editor/useRealtime.js', () => ({
  useRealtime: () => ({
    connected: false,
    applyLocalChange: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(null),
    error: null,
    sendFocusRegions: vi.fn().mockReturnValue(false),
    sendHeartbeat: vi.fn(),
    presenceViaWebSocket: false,
    connectedDocumentPath: null,
  }),
}));

const { P1PuckProvider } = await import('../src/editor/P1PuckProvider.js');

// =============================================================================
// Mock Data
// =============================================================================

const mockBranch: Branch = {
  id: 'branch-1',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockDocumentHome = {
  id: 'doc-1',
  siteId: 'site-1',
  path: 'pages/home',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockDocumentOther = {
  id: 'doc-2',
  siteId: 'site-1',
  path: 'pages/other',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockTemplateDocument = {
  id: 'doc-t',
  siteId: 'site-1',
  path: '_registry/templates/blog-post',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const baseSnapshot: PuckData = {
  content: [{ type: 'HeadingBlock', props: { id: 'comp-1', title: 'Hello' } }],
  root: { props: {} },
};

const editedData: PuckData = {
  content: [{ type: 'HeadingBlock', props: { id: 'comp-1', title: 'Edited' } }],
  root: { props: {} },
};

const templateSnapshot: PuckData = {
  content: [{ type: 'HeadingBlock', props: { id: 'comp-1', title: 'Hello' } }],
  root: {
    props: {
      _template: { label: 'Blog Post', deprecated: false },
      _pinMap: {},
    },
  },
};

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(): P1Client {
  return {
    branches: {
      list: vi.fn().mockResolvedValue([mockBranch]),
      get: vi.fn().mockResolvedValue(mockBranch),
      create: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getByPath: vi.fn(async (_siteId: string, path: string) => {
        if (path === 'pages/other') return mockDocumentOther;
        if (path === '_registry/templates/blog-post') return mockTemplateDocument;
        return mockDocumentHome;
      }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getLatest: vi.fn(async (_siteId: string, _branchId: string, documentId: string) => ({
        id: `v-${documentId}`,
        versionNumber: 1,
        snapshot: documentId === 'doc-t' ? templateSnapshot : baseSnapshot,
      })),
      create: vi.fn().mockResolvedValue({ id: 'v2', versionNumber: 2 }),
    },
    checkpoints: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
    },
    presence: {
      getSitePresence: vi.fn(),
      getBranchPresence: vi.fn(),
      getAgentPresence: vi.fn(),
    },
    templates: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    agentEdit: {
      canEdit: vi.fn(),
      startEdit: vi.fn(),
      completeEdit: vi.fn(),
      abortEdit: vi.fn(),
    },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as P1Client;
}

// =============================================================================
// Provider Wrapper Factory
// =============================================================================

function createProviderWrapper(client: P1Client, autoSaveDelay = 1000) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1PuckProvider,
      {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
        enableRealtime: false,
        autoSaveDelay,
      },
      children,
    );
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('P1PuckProvider save durability', () => {
  let client: P1Client;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function renderAndLoad(path = '/pages/home') {
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(() => useP1Puck(), { wrapper });
    await act(async () => {
      await result.current.loadDocument(path);
    });
    return result;
  }

  /**
   * Loads the document and consumes the load-echo suppression the way
   * production does: Puck's setData echo fires onChange with the loaded data.
   */
  async function renderLoadAndSettle(path = '/pages/home') {
    const result = await renderAndLoad(path);
    act(() => {
      result.current.saveData(JSON.parse(JSON.stringify(baseSnapshot)) as PuckData);
    });
    return result;
  }

  // ===========================================================================
  // Load-echo suppression
  // ===========================================================================

  it('drops the onChange echo of the loaded snapshot', async () => {
    const result = await renderAndLoad();

    // Puck echoes the loaded data back through onChange (deep-equal copy).
    act(() => {
      result.current.saveData(JSON.parse(JSON.stringify(baseSnapshot)) as PuckData);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(client.versions.create).not.toHaveBeenCalled();
  });

  it('saves the first edit after a load even when the load echo is skipped', async () => {
    const result = await renderAndLoad();

    // Puck 0.21.1 skips onChange when the loaded data deep-equals its state,
    // so the FIRST onChange can be a genuine edit (e.g. a lone pin toggle).
    act(() => {
      result.current.saveData(editedData);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(client.versions.create).toHaveBeenCalledTimes(1);
    expect(client.versions.create).toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({ documentId: 'doc-1', snapshot: editedData }),
    );
  });

  it('drops the load echo even when the snapshot key order differs', async () => {
    const result = await renderAndLoad();

    // Structurally identical to the loaded snapshot, opposite key order — a
    // raw string compare would treat this as a change and save a version.
    const reordered = {
      root: { props: {} },
      content: [{ type: 'HeadingBlock', props: { title: 'Hello', id: 'comp-1' } }],
    } as PuckData;
    act(() => {
      result.current.saveData(reordered);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(client.versions.create).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // Document switch
  // ===========================================================================

  it('flushes the pending save for the outgoing document when another document loads', async () => {
    const result = await renderLoadAndSettle();

    act(() => {
      result.current.saveData(editedData);
    });
    // Switch documents inside the debounce window.
    await act(async () => {
      await result.current.loadDocument('/pages/other');
    });

    expect(client.versions.create).toHaveBeenCalledTimes(1);
    expect(client.versions.create).toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({ documentId: 'doc-1', snapshot: editedData }),
    );
  });

  it('never fires a pending save from the previous document against the newly loaded one', async () => {
    const result = await renderLoadAndSettle();

    act(() => {
      result.current.saveData(editedData);
    });
    await act(async () => {
      await result.current.loadDocument('/pages/other');
    });

    vi.mocked(client.versions.create).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(client.versions.create).not.toHaveBeenCalled();
  });

  it('retains the outgoing edit and aborts the switch when the pre-switch flush fails', async () => {
    vi.mocked(client.versions.create).mockRejectedValue(new Error('offline'));

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        P1PuckProvider,
        {
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          userId: 'user-789',
          enableRealtime: false,
          autoSaveDelay: 1000,
          maxRetries: 1,
        },
        children,
      );
    const { result } = renderHook(() => useP1Puck(), { wrapper });
    await act(async () => {
      await result.current.loadDocument('/pages/home');
    });

    act(() => {
      result.current.saveData(editedData);
    });

    // The pre-switch flush fails while switching to another document.
    await act(async () => {
      await result.current.loadDocument('/pages/other');
    });

    // Edit is retained and the switch was aborted (still on the home doc).
    expect(result.current.getHasUnsavedChanges()).toBe(true);
    expect(result.current.currentDocument?.id).toBe('doc-1');

    // The retry, still bound to the home doc, succeeds.
    vi.mocked(client.versions.create).mockResolvedValue({ id: 'v2', versionNumber: 2 } as never);
    await act(async () => {
      await result.current.saveNow();
    });

    const calls = vi.mocked(client.versions.create).mock.calls;
    expect((calls[calls.length - 1][1] as { documentId: string }).documentId).toBe('doc-1');
    expect(result.current.getHasUnsavedChanges()).toBe(false);
  });

  // ===========================================================================
  // Tab close / hide
  // ===========================================================================

  it('flushes the pending save when the page is being unloaded', async () => {
    const result = await renderLoadAndSettle();

    act(() => {
      result.current.saveData(editedData);
    });
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(client.versions.create).toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({ documentId: 'doc-1', snapshot: editedData }),
      { keepalive: true },
    );
  });

  it('flushes the pending save when the page is hidden (pagehide)', async () => {
    const result = await renderLoadAndSettle();

    act(() => {
      result.current.saveData(editedData);
    });
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(client.versions.create).toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({ documentId: 'doc-1', snapshot: editedData }),
      { keepalive: true },
    );
  });

  it('flushes the pending save when the tab becomes hidden', async () => {
    const result = await renderLoadAndSettle();

    act(() => {
      result.current.saveData(editedData);
    });

    // Shadow the prototype getter with an own property, then remove the
    // shadow to restore the original behavior.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }

    expect(client.versions.create).toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({ documentId: 'doc-1', snapshot: editedData }),
      { keepalive: true },
    );
  });

  // ===========================================================================
  // Pin persistence (root-props _pinMap edits ride the document autosave)
  // ===========================================================================

  it('persists a pin toggle into the saved snapshot', async () => {
    const result = await renderAndLoad('/_registry/templates/blog-post');

    const pinnedData: PuckData = {
      ...templateSnapshot,
      root: {
        props: {
          ...templateSnapshot.root.props,
          _pinMap: { 'comp-1': true },
        },
      },
    };
    act(() => {
      result.current.saveData(pinnedData);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(client.versions.create).toHaveBeenCalledTimes(1);
    const call = vi.mocked(client.versions.create).mock.calls[0];
    expect((call[1] as { documentId: string }).documentId).toBe('doc-t');
    const snapshot = (call[1] as { snapshot: PuckData }).snapshot;
    expect(snapshot.root.props._pinMap).toEqual({ 'comp-1': true });
  });

  it('exposes a pin from a loaded snapshot on the provider data', async () => {
    const pinnedSnapshot: PuckData = {
      ...templateSnapshot,
      root: {
        props: {
          ...templateSnapshot.root.props,
          _pinMap: { 'comp-1': true },
        },
      },
    };
    vi.mocked(client.versions.getLatest).mockResolvedValue({
      id: 'v-doc-t',
      versionNumber: 2,
      snapshot: pinnedSnapshot,
    } as never);

    const result = await renderAndLoad('/_registry/templates/blog-post');

    expect(
      (result.current.currentData?.root.props as Record<string, unknown>)._pinMap,
    ).toEqual({ 'comp-1': true });
  });
});
