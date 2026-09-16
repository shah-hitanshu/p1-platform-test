/**
 * Component 3 Tests: Role Wiring
 *
 * Tests that:
 * 1. P1Config carries no role — the backend decides
 * 2. P1PuckProvider exposes the backend roleName and permissions in context
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch } from '@pantheon-systems/css-client';

const EDITOR_PERMS = {
  canView: true, canEdit: true, canCreateBranch: true, canEditDocuments: true,
  canCreateCheckpoint: true, canProposeMerge: true, canMerge: true,
  canMergeToMain: false, canManageGrants: false, canManageTemplates: false,
};
const ADMIN_PERMS = { ...EDITOR_PERMS, canMergeToMain: true, canManageGrants: true, canManageTemplates: true };

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

  it('P1Config carries no role field', async () => {
    const { createP1Config } = await import('../../src/core/config.js');
    const config = createP1Config({
      CSS_BASE_URL: 'https://css.example.com',
      CSS_SITE_ID: 'site-1',
    });
    expect(config).not.toHaveProperty('userRole');
  });

  it('P1PuckProvider exposes the EDITOR role from the backend', async () => {
    const client = createMockClient();
    (client as any).auth = { getRole: vi.fn().mockResolvedValue({ roleName: 'EDITOR', permissions: EDITOR_PERMS }) };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });
    await waitFor(() => expect(result.current.roleName).toBe('EDITOR'));
    expect(result.current.permissions).toEqual(EDITOR_PERMS);
  });

  it('P1PuckProvider exposes the ADMIN role from the backend', async () => {
    const client = createMockClient();
    (client as any).auth = { getRole: vi.fn().mockResolvedValue({ roleName: 'ADMIN', permissions: ADMIN_PERMS }) };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });
    await waitFor(() => expect(result.current.roleName).toBe('ADMIN'));
    expect(result.current.permissions).toEqual(ADMIN_PERMS);
  });

  it('P1PuckProvider exposes the VIEWER role with canEditDocuments=false', async () => {
    const client = createMockClient();
    const viewerPerms = { ...EDITOR_PERMS, canEdit: false, canCreateBranch: false, canEditDocuments: false, canCreateCheckpoint: false, canProposeMerge: false, canMerge: false };
    (client as any).auth = { getRole: vi.fn().mockResolvedValue({ roleName: 'VIEWER', permissions: viewerPerms }) };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });
    await waitFor(() => expect(result.current.roleName).toBe('VIEWER'));
    expect(result.current.permissions?.canEditDocuments).toBe(false);
  });
});
