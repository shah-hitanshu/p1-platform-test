/**
 * useP1Plugin Hook Tests (TDD)
 *
 * Tests for the stable plugin creation hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch, PuckData, Document } from '@pantheon-systems/css-client';

// =============================================================================
// Mock useRealtime hook
// =============================================================================

vi.mock('../../src/editor/useRealtime.js', () => ({
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

const { P1PuckProvider } = await import('../../src/editor/P1PuckProvider.js');
const { useP1Plugin } = await import('../../src/editor/useP1Plugin.js');
const { useP1Puck } = await import('../../src/core/P1PuckContext.js');

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

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(): P1Client {
  return {
    branches: {
      list: vi.fn().mockResolvedValue([mockBranch]),
      get: vi.fn().mockResolvedValue(mockBranch),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getByPath: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getLatest: vi.fn().mockResolvedValue({
        id: 'v1',
        versionNumber: 1,
        snapshot: { content: [], root: { props: {} } },
        createdAt: '2026-01-01T00:00:00Z',
      }),
      create: vi.fn(),
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
  } as unknown as P1Client;
}

// =============================================================================
// Provider Wrapper
// =============================================================================

function createProviderWrapper(client: P1Client) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1PuckProvider,
      {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      },
      children
    );
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('useP1Plugin', () => {
  let client: P1Client;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should return a plugin object with correct structure', () => {
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(() => useP1Plugin(), { wrapper });

    expect(result.current).toBeDefined();
    expect(result.current.name).toBe('css');
    expect(result.current.label).toBe('History');
    expect(result.current.icon).toBeDefined();
    expect(typeof result.current.render).toBe('function');
  });

  it('should return referentially stable plugin across re-renders', () => {
    const wrapper = createProviderWrapper(client);
    const { result, rerender } = renderHook(() => useP1Plugin(), { wrapper });

    const plugin1 = result.current;
    rerender();
    const plugin2 = result.current;

    expect(plugin1).toBe(plugin2);
  });

  it('should return referentially stable plugin when context values change', async () => {
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(
      () => {
        const plugin = useP1Plugin();
        const ccr = useP1Puck();
        return { plugin, ccr };
      },
      { wrapper }
    );

    const plugin1 = result.current.plugin;

    // Trigger a context state change by loading a document
    const mockDoc = { id: 'doc-1', siteId: 'site-1', path: 'pages/home', title: 'Home', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    (client.documents.getByPath as ReturnType<typeof vi.fn>).mockResolvedValue(mockDoc);

    await act(async () => {
      await result.current.ccr.loadDocument('/pages/home');
    });

    const plugin2 = result.current.plugin;
    expect(plugin1).toBe(plugin2);
  });

  it('should accept and use additional options', () => {
    const onSelectionChange = vi.fn();
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(
      () => useP1Plugin({ onSelectionChange }),
      { wrapper }
    );

    expect(result.current).toBeDefined();
    expect(result.current.name).toBe('css');
  });

  it('should throw if used outside P1PuckProvider', () => {
    expect(() => {
      renderHook(() => useP1Plugin());
    }).toThrow('useP1Puck must be used within a P1PuckProvider');
  });
});
