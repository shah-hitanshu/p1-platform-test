/**
 * Feature Configuration Tests (TDD)
 *
 * Tests for CSSFeatureConfig type, presets, and integration with hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import type { CSSClient, Branch } from '@pantheon-systems/css-client';

// =============================================================================
// Mock useRealtime hook
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

// =============================================================================
// Import AFTER the mock
// =============================================================================

const { CSSPuckProvider } = await import('../src/editor/CSSPuckProvider.js');
const { useCSSPlugin } = await import('../src/editor/useCSSPlugin.js');
const { useCSSOverrides } = await import('../src/editor/useCSSOverrides.js');
const { CSS_PRESETS } = await import('../src/core/featureConfig.js');

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
  } as unknown as CSSClient;
}

// =============================================================================
// Test Suite
// =============================================================================

describe('CSS Feature Presets', () => {
  it('should export basic preset', () => {
    expect(CSS_PRESETS.basic).toBeDefined();
    expect(CSS_PRESETS.basic.enableAutoSave).toBe(true);
    expect(CSS_PRESETS.basic.enablePublishButton).toBe(true);
  });

  it('should export collaborative preset', () => {
    expect(CSS_PRESETS.collaborative).toBeDefined();
    expect(CSS_PRESETS.collaborative.enableRealtime).toBe(true);
    expect(CSS_PRESETS.collaborative.presenceEnabled).toBe(true);
    expect(CSS_PRESETS.collaborative.enableCollaboratorAvatars).toBe(true);
    expect(CSS_PRESETS.collaborative.enableFocusHighlighting).toBe(true);
  });

  it('should export full preset with all features enabled', () => {
    expect(CSS_PRESETS.full).toBeDefined();
    expect(CSS_PRESETS.full.enableDocumentBrowser).toBe(true);
    expect(CSS_PRESETS.full.enableBranchSelector).toBe(true);
    expect(CSS_PRESETS.full.enableVersionHistory).toBe(true);
    expect(CSS_PRESETS.full.enableMergeControl).toBe(true);
    expect(CSS_PRESETS.full.enableAutoSave).toBe(true);
    expect(CSS_PRESETS.full.enablePublishButton).toBe(true);
    expect(CSS_PRESETS.full.enableRealtime).toBe(true);
    expect(CSS_PRESETS.full.presenceEnabled).toBe(true);
    expect(CSS_PRESETS.full.enableCollaboratorAvatars).toBe(true);
    expect(CSS_PRESETS.full.enableAgentBanner).toBe(true);
    expect(CSS_PRESETS.full.enableFocusHighlighting).toBe(true);
  });

  it('presets should be usable as CSSFeatureConfig spread', () => {
    // Verify presets can be spread without type errors
    const combined = { ...CSS_PRESETS.basic, enableDocumentBrowser: true };
    expect(combined.enableAutoSave).toBe(true);
    expect(combined.enableDocumentBrowser).toBe(true);
  });
});

describe('Feature config integration with hooks', () => {
  let client: CSSClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('useCSSPlugin should accept feature flags via options', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(CSSPuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      }, children);

    const { result } = renderHook(
      () => useCSSPlugin({
        showPresenceIndicator: true,
        showAgentActivity: true,
      }),
      { wrapper }
    );

    expect(result.current).toBeDefined();
    expect(result.current.name).toBe('css');
  });

  it('useCSSOverrides should accept feature flags via options', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(CSSPuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      }, children);

    const { result } = renderHook(
      () => useCSSOverrides({
        showCollaboratorAvatars: true,
        showAgentActivityBanner: true,
      }),
      { wrapper }
    );

    expect(result.current).toBeDefined();
    expect(result.current.headerActions).toBeDefined();
  });
});
