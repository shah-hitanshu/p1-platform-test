/**
 * Component 3 Tests: User Role Wiring
 *
 * Tests that:
 * 1. P1Config accepts userRole
 * 2. P1App passes userRole through to P1PuckProvider
 * 3. Default userRole is 'editor'
 * 4. Custom userRole is respected in context
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch } from '@pantheon-systems/css-client';

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
    templates: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as P1Client;
}

// =============================================================================
// Tests
// =============================================================================

describe('User role wiring', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('P1Config accepts userRole field', async () => {
    const { createP1Config } = await import('../../src/core/config.js');
    const config = createP1Config({
      CSS_BASE_URL: 'https://css.example.com',
      CSS_SITE_ID: 'site-1',
    }, {
      overrides: { userRole: 'admin' },
    });
    expect(config.userRole).toBe('admin');
  });

  it('P1Config defaults userRole to undefined when not set', async () => {
    const { createP1Config } = await import('../../src/core/config.js');
    const config = createP1Config({
      CSS_BASE_URL: 'https://css.example.com',
      CSS_SITE_ID: 'site-1',
    });
    expect(config.userRole).toBeUndefined();
  });

  it('P1PuckProvider defaults userRole to editor', () => {
    const client = createMockClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });
    expect(result.current.userRole).toBe('editor');
  });

  it('P1PuckProvider accepts and exposes admin role', () => {
    const client = createMockClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
        userRole: 'admin',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });
    expect(result.current.userRole).toBe('admin');
  });

  it('P1PuckProvider accepts and exposes junior-editor role', () => {
    const client = createMockClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
        userRole: 'junior-editor',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });
    expect(result.current.userRole).toBe('junior-editor');
  });
});
