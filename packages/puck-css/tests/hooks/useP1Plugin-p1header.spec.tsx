/**
 * useP1Plugin P1 Header Props Tests (TDD)
 *
 * Verifies that P1 editor header props passed to useP1Plugin are forwarded
 * through the stable Proxy to createP1Plugin. Tests are red until
 * UseP1PluginOptions and pluginOptions wiring are updated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch } from '@pantheon-systems/css-client';
import type { P1PluginOptions } from '../../src/editor/plugin/P1Plugin.js';

// =============================================================================
// Mocks — declared BEFORE dynamic imports
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

// Capture options proxy so tests can read from it
let capturedOptions: P1PluginOptions | null = null;

vi.mock('../../src/editor/plugin/P1Plugin.js', () => ({
  createP1Plugin: vi.fn((options: P1PluginOptions) => {
    capturedOptions = options;
    return {
      name: 'css',
      label: 'CCR',
      icon: null,
      render: vi.fn(),
      overrides: {},
    };
  }),
}));

// =============================================================================
// Imports AFTER mocks
// =============================================================================

const { P1PuckProvider } = await import('../../src/editor/P1PuckProvider.js');
const { useP1Plugin } = await import('../../src/editor/useP1Plugin.js');

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
// Mock Client
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

function createWrapper(client: P1Client) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1PuckProvider,
      { client, siteId: 'site-1', branchId: 'branch-1', userId: 'user-1' },
      children,
    );
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('useP1Plugin — P1 header props forwarding', () => {
  let client: P1Client;

  beforeEach(() => {
    vi.useFakeTimers();
    capturedOptions = null;
    client = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('forwards siteName through the stable proxy', () => {
    const wrapper = createWrapper(client);
     
    renderHook(() => useP1Plugin({ siteName: 'Acme Corp' } as any), { wrapper });

    expect(capturedOptions).not.toBeNull();
    expect((capturedOptions as unknown as Record<string, unknown>).siteName).toBe('Acme Corp');
  });

  // UseP1PluginOptions restates every field by hand, so an option can stop at this boundary.
  it('forwards showAIPanelToggle through the stable proxy', () => {
    const wrapper = createWrapper(client);
     
    renderHook(() => useP1Plugin({ showAIPanelToggle: true } as any), { wrapper });

    expect((capturedOptions as unknown as Record<string, unknown>).showAIPanelToggle).toBe(true);
  });

  it('forwards siteMenuItems through the stable proxy', () => {
    const siteMenuItems = [{ label: 'Settings', callback: vi.fn() }];
    const wrapper = createWrapper(client);
     
    renderHook(() => useP1Plugin({ siteMenuItems } as any), { wrapper });

    expect(capturedOptions).not.toBeNull();
    expect((capturedOptions as unknown as Record<string, unknown>).siteMenuItems).toBe(siteMenuItems);
  });

  it('forwards currentUser through the stable proxy', () => {
    const currentUser = { id: 'user-42', avatar: 'https://example.com/avatar.png' };
    const wrapper = createWrapper(client);
     
    renderHook(() => useP1Plugin({ currentUser } as any), { wrapper });

    expect(capturedOptions).not.toBeNull();
    expect((capturedOptions as unknown as Record<string, unknown>).currentUser).toBe(currentUser);
  });

  it('forwards onLogout through the stable proxy', () => {
    const onLogout = vi.fn();
    const wrapper = createWrapper(client);
     
    renderHook(() => useP1Plugin({ onLogout } as any), { wrapper });

    expect(capturedOptions).not.toBeNull();
    expect((capturedOptions as unknown as Record<string, unknown>).onLogout).toBe(onLogout);
  });

  it('forwards onCompareWithLive through the stable proxy', () => {
    const onCompareWithLive = vi.fn();
    const wrapper = createWrapper(client);
     
    renderHook(() => useP1Plugin({ onCompareWithLive } as any), { wrapper });

    expect(capturedOptions).not.toBeNull();
    expect((capturedOptions as unknown as Record<string, unknown>).onCompareWithLive).toBe(onCompareWithLive);
  });

  it('forwards onPublish through the stable proxy', () => {
    const onPublish = vi.fn();
    const wrapper = createWrapper(client);
     
    renderHook(() => useP1Plugin({ onPublish } as any), { wrapper });

    expect(capturedOptions).not.toBeNull();
    expect((capturedOptions as unknown as Record<string, unknown>).onPublish).toBe(onPublish);
  });

  it('forwards onReviewAndPublish through the stable proxy', () => {
    const onReviewAndPublish = vi.fn();
    const wrapper = createWrapper(client);
     
    renderHook(() => useP1Plugin({ onReviewAndPublish } as any), { wrapper });

    expect(capturedOptions).not.toBeNull();
    expect((capturedOptions as unknown as Record<string, unknown>).onReviewAndPublish).toBe(onReviewAndPublish);
  });

  it('forwards onCreateWorkstream through the stable proxy', () => {
    const onCreateWorkstream = vi.fn();
    const wrapper = createWrapper(client);
     
    renderHook(() => useP1Plugin({ onCreateWorkstream } as any), { wrapper });

    expect(capturedOptions).not.toBeNull();
    expect((capturedOptions as unknown as Record<string, unknown>).onCreateWorkstream).toBe(onCreateWorkstream);
  });

  it('proxy reflects updated siteName after re-render', () => {
    const wrapper = createWrapper(client);
     
    const { rerender } = renderHook(({ name }: { name: string }) => useP1Plugin({ siteName: name } as any), {
      wrapper,
      initialProps: { name: 'Acme Corp' },
    });

    expect((capturedOptions as unknown as Record<string, unknown>).siteName).toBe('Acme Corp');

    rerender({ name: 'Beta Corp' });

    // Proxy reads from optionsRef.current — should reflect new value
    expect((capturedOptions as unknown as Record<string, unknown>).siteName).toBe('Beta Corp');
  });
});
