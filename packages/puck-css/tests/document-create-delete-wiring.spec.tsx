/**
 * Document Create/Delete Wiring Tests
 *
 * Integration tests verifying that useCSSPlugin automatically wires
 * createDocument and deleteDocument from CSSPuckContext, so the plugin
 * panel renders the "+" create button and "×" delete buttons without
 * consumers having to explicitly pass callbacks.
 *
 * Regression: these buttons were lost when the context stopped exposing
 * create/delete operations, leaving useCSSPlugin with no callbacks to wire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor, render, screen } from '@testing-library/react';
import React from 'react';
import type { CSSClient, Branch, PuckData } from '@pantheon/css-client';

// =============================================================================
// Mock useRealtime hook
// =============================================================================

vi.mock('../src/hooks/useRealtime.js', () => ({
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

// =============================================================================
// Import AFTER the mock
// =============================================================================

const { CSSPuckProvider } = await import('../src/CSSPuckProvider.js');
const { useCSSPlugin } = await import('../src/hooks/useCSSPlugin.js');
const { useCSSPuck } = await import('../src/CSSPuckContext.js');

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

const mockDocument = {
  id: 'doc-1',
  siteId: 'site-1',
  path: 'pages/home',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockVersionSnapshot: PuckData = {
  content: [],
  root: { props: {} },
};

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(): CSSClient {
  return {
    branches: {
      list: vi.fn().mockResolvedValue([mockBranch]),
      get: vi.fn().mockResolvedValue(mockBranch),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([mockDocument]),
      get: vi.fn(),
      getByPath: vi.fn().mockResolvedValue(mockDocument),
      create: vi.fn().mockResolvedValue({ id: 'doc-new', path: '/new-page', siteId: 'site-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getLatest: vi.fn().mockResolvedValue({
        id: 'v1',
        versionNumber: 1,
        snapshot: mockVersionSnapshot,
        createdAt: '2026-01-01T00:00:00Z',
      }),
      create: vi.fn().mockResolvedValue({ id: 'v2', versionNumber: 2 }),
    },
    checkpoints: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'cp-1', name: 'test' }),
    },
    presence: {
      getSitePresence: vi.fn(),
      getBranchPresence: vi.fn(),
      getAgentPresence: vi.fn(),
    },
    agentRegistry: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateStatus: vi.fn(),
      delete: vi.fn(),
    },
    agentEdit: {
      canEdit: vi.fn(),
      startEdit: vi.fn(),
      completeEdit: vi.fn(),
      abortEdit: vi.fn(),
    },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as CSSClient;
}

// =============================================================================
// Provider Wrapper
// =============================================================================

function createProviderWrapper(client: CSSClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      CSSPuckProvider,
      {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-1',
      },
      children
    );
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('useCSSPlugin auto-wires document create/delete from context', () => {
  let client: CSSClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
  });

  it('context exposes createDocument function', async () => {
    const wrapper = createProviderWrapper(client);

    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    await waitFor(() => {
      expect(result.current.branchId).toBe('branch-1');
    });

    expect(result.current.createDocument).toBeDefined();
    expect(typeof result.current.createDocument).toBe('function');
  });

  it('context exposes deleteDocument function', async () => {
    const wrapper = createProviderWrapper(client);

    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    await waitFor(() => {
      expect(result.current.branchId).toBe('branch-1');
    });

    expect(result.current.deleteDocument).toBeDefined();
    expect(typeof result.current.deleteDocument).toBe('function');
  });

  it('useCSSPlugin wires onDocumentCreate from context when not explicitly provided', async () => {
    const wrapper = createProviderWrapper(client);

    // Component that renders the plugin panel to actual DOM
    function PluginRenderer() {
      const plugin = useCSSPlugin();
      return <>{plugin.render()}</>;
    }

    render(
      React.createElement(wrapper, null, React.createElement(PluginRenderer))
    );

    // Wait for documents to load, then the "+" button should appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+' })).toBeDefined();
    });
  });

  it('useCSSPlugin wires onDocumentDelete from context when not explicitly provided', async () => {
    const wrapper = createProviderWrapper(client);

    function PluginRenderer() {
      const plugin = useCSSPlugin();
      return <>{plugin.render()}</>;
    }

    render(
      React.createElement(wrapper, null, React.createElement(PluginRenderer))
    );

    // Wait for documents to load, then delete buttons should appear
    await waitFor(() => {
      const deleteButtons = screen.getAllByRole('button', { name: /Delete/ });
      expect(deleteButtons.length).toBeGreaterThan(0);
    });
  });

  it('createDocument calls client.documents.create and refreshes the list', async () => {
    const wrapper = createProviderWrapper(client);

    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    await waitFor(() => {
      expect(result.current.branchId).toBe('branch-1');
    });

    await act(async () => {
      await result.current.createDocument('/new-page');
    });

    expect(client.documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-1',
        branchId: 'branch-1',
        path: '/new-page',
      })
    );
  });

  it('deleteDocument calls client.documents.delete and refreshes the list', async () => {
    const wrapper = createProviderWrapper(client);

    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    await waitFor(() => {
      expect(result.current.branchId).toBe('branch-1');
    });

    await act(async () => {
      await result.current.deleteDocument('doc-1', 'pages/home');
    });

    expect(client.documents.delete).toHaveBeenCalledWith('site-1', 'branch-1', 'doc-1');
  });
});

