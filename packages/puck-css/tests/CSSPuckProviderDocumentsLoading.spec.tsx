/**
 * CSSPuckProvider documentsLoading Tests (TDD)
 *
 * Tests that documentsLoading and documents list are exposed from context.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useCSSPuck } from '../src/core/CSSPuckContext.js';
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
// Import CSSPuckProvider AFTER the mock
// =============================================================================

const { CSSPuckProvider } = await import('../src/editor/CSSPuckProvider.js');

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

const mockDocuments = [
  { id: 'doc-1', siteId: 'site-1', path: 'pages/home', title: 'Home', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'doc-2', siteId: 'site-1', path: 'pages/about', title: 'About', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

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
      list: vi.fn().mockResolvedValue(mockDocuments),
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
// Provider Wrapper Factory
// =============================================================================

function createProviderWrapper(client: CSSClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      CSSPuckProvider,
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

describe('CSSPuckProvider documentsLoading (Item 8)', () => {
  let client: CSSClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should expose documentsLoading in context', () => {
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    // documentsLoading should be defined
    expect(result.current.documentsLoading).toBeDefined();
    expect(typeof result.current.documentsLoading).toBe('boolean');
  });

  it('should expose documents list in context', async () => {
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    // Wait for documents to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.documents).toBeDefined();
    expect(Array.isArray(result.current.documents)).toBe(true);
  });

  it('documents should be populated after loading', async () => {
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    // Wait for documents to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.documents.length).toBe(2);
    expect(result.current.documentsLoading).toBe(false);
  });
});
