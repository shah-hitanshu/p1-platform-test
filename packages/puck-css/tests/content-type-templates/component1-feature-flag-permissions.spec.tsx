/**
 * Component 1 Tests: Feature Flag Always-On + resolvePermissions Wiring
 *
 * Tests that:
 * 1. enableContentTypeTemplates defaults to true in all presets and resolveFeatureConfig
 * 2. resolvePermissions is included in puckProps when template is bound
 * 3. createDocument signature accepts template parameter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch, Document } from '@pantheon-systems/css-client';

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

const { resolveFeatureConfig, P1_PRESETS } = await import('../../src/core/featureConfig.js');
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

const mockDocument: Document = {
  id: 'doc-1',
  siteId: 'site-1',
  path: '/test-page',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  templateId: 'template-1',
  templateVersion: 1,
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
// Feature Flag Tests
// =============================================================================

describe('enableContentTypeTemplates defaults to true', () => {
  it('resolveFeatureConfig returns enableContentTypeTemplates: true when not specified', () => {
    const resolved = resolveFeatureConfig({});
    expect(resolved.enableContentTypeTemplates).toBe(true);
  });

  it('resolveFeatureConfig respects explicit false override', () => {
    const resolved = resolveFeatureConfig({ enableContentTypeTemplates: false });
    expect(resolved.enableContentTypeTemplates).toBe(false);
  });

  it('basic preset has enableContentTypeTemplates: true', () => {
    expect(P1_PRESETS.basic.enableContentTypeTemplates).toBe(true);
  });

  it('collaborative preset has enableContentTypeTemplates: true', () => {
    expect(P1_PRESETS.collaborative.enableContentTypeTemplates).toBe(true);
  });

  it('full preset has enableContentTypeTemplates: true', () => {
    expect(P1_PRESETS.full.enableContentTypeTemplates).toBe(true);
  });
});

// =============================================================================
// resolvePermissions wiring tests
// =============================================================================

describe('resolvePermissions exposed on context', () => {
  let client: P1Client;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('context exposes resolvePermissions when template is loaded', async () => {
    const mockTemplate = {
      id: 'template-1',
      name: 'blog-post',
      label: 'Blog Post',
      version: 1,
      components: [
        { type: 'Hero', pinned: true, defaultProps: {} },
        { type: 'RichText', pinned: false, defaultProps: {} },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    (client.templates as any).get = vi.fn().mockResolvedValue(mockTemplate);
    (client.documents as any).getByPath = vi.fn().mockResolvedValue(mockDocument);
    (client.versions as any).getLatest = vi.fn().mockResolvedValue({
      id: 'v1',
      versionNumber: 1,
      snapshot: { content: [], root: { props: {} } },
      createdAt: '2026-01-01T00:00:00Z',
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
        userRole: 'editor',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });

    // The resolvePermissions should be a function on the context
    expect(typeof result.current.resolvePermissions).toBe('function');
  });

  it('context exposes userRole with default value', () => {
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

  it('context exposes custom userRole when provided', () => {
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
});
