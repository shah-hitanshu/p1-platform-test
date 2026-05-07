/**
 * Agent Session Integration Tests (TDD)
 *
 * Tests for session-based authorization integration between
 * useAgentEdit hook and useRealtime hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useAgentEdit } from '../src/agent/index.js';
import { PresenceContext } from '../src/core/PresenceContext.js';
import type {
  CSSClient,
  AgentEditSession,
} from '@pantheon-systems/css-client';

// =============================================================================
// Mock Data
// =============================================================================

const mockSession: AgentEditSession = {
  sessionId: 'session-123',
  checkpointId: 'checkpoint-abc',
};

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(overrides: Partial<CSSClient['agentEdit']> = {}): CSSClient {
  return {
    agentEdit: {
      canEdit: vi.fn().mockResolvedValue({ allowed: true }),
      startEdit: vi.fn().mockResolvedValue(mockSession),
      completeEdit: vi.fn().mockResolvedValue({ success: true }),
      abortEdit: vi.fn().mockResolvedValue({ success: true }),
      ...overrides,
    },
    presence: {
      getSitePresence: vi.fn().mockResolvedValue({}),
      getBranchPresence: vi.fn().mockResolvedValue({ actors: [] }),
      getAgentPresence: vi.fn().mockResolvedValue({}),
    },
  } as unknown as CSSClient;
}

// =============================================================================
// Test Wrapper
// =============================================================================

function createWrapper(client: CSSClient = createMockClient(), documentPath = '/pages/home') {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      PresenceContext.Provider,
      {
        value: {
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath,
          userId: 'user-self',
        },
      },
      children
    );
  };
}

// =============================================================================
// useAgentEdit Session ID Tests
// =============================================================================

describe('useAgentEdit sessionId', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sessionId property', () => {
    it('should expose sessionId as null when no active session', () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      expect(result.current.sessionId).toBeNull();
    });

    it('should expose sessionId after startEdit', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      await act(async () => {
        await result.current.startEdit({
          trigger: 'human_requested',
          intent: 'Optimize layout',
          targetRegions: ['/content/0'],
        });
      });

      expect(result.current.sessionId).toBe('session-123');
    });

    it('should reset sessionId to null after completeEdit', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      // Start an edit
      await act(async () => {
        await result.current.startEdit({
          trigger: 'human_requested',
          intent: 'Optimize',
          targetRegions: [],
        });
      });

      expect(result.current.sessionId).toBe('session-123');

      // Complete the edit
      await act(async () => {
        await result.current.completeEdit();
      });

      expect(result.current.sessionId).toBeNull();
    });

    it('should reset sessionId to null after abortEdit', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      // Start an edit
      await act(async () => {
        await result.current.startEdit({
          trigger: 'human_requested',
          intent: 'Optimize',
          targetRegions: [],
        });
      });

      expect(result.current.sessionId).toBe('session-123');

      // Abort the edit
      await act(async () => {
        await result.current.abortEdit();
      });

      expect(result.current.sessionId).toBeNull();
    });

    it('should provide sessionId as convenience property matching session.sessionId', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      await act(async () => {
        await result.current.startEdit({
          trigger: 'human_requested',
          intent: 'Optimize',
          targetRegions: [],
        });
      });

      // sessionId should match session.sessionId
      expect(result.current.sessionId).toBe(result.current.session?.sessionId);
    });
  });
});

// =============================================================================
// useRealtime Session ID Tests
// =============================================================================

// Track connection params for verification
const connectCalls: Array<{
  siteId: string;
  branchId: string;
  documentPath: string;
  actorId: string;
  actorType: string;
  sessionId?: string;
}> = [];

// Mock RealtimeClient and Yjs binding
vi.mock('@pantheon-systems/css-client', async () => {
  const actual = await vi.importActual('@pantheon-systems/css-client');

  class MockRealtimeClient {
    private ydoc = {
      getMap: () => ({
        toJSON: () => ({}),
        observeDeep: () => {},
      }),
    };

    constructor(_config: unknown) {}

    connect(params: {
      siteId: string;
      branchId: string;
      documentPath: string;
      actorId: string;
      actorType: string;
      sessionId?: string;
    }) {
      connectCalls.push(params);
    }

    disconnect() {}

    getYDoc() {
      return this.ydoc;
    }

    getSnapshot() {
      return null;
    }
  }

  return {
    ...actual,
    RealtimeClient: MockRealtimeClient,
  };
});

// Mock puckYjsBinding to avoid Yjs issues
vi.mock('../src/editor/utils/puckYjsBinding.js', () => ({
  createPuckYjsBinding: () => ({
    applyLocalChange: () => {},
    destroy: () => {},
  }),
}));

describe('useRealtime sessionId', () => {
  beforeEach(() => {
    // Clear connection tracking
    connectCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should accept sessionId in params', async () => {
    // Import dynamically to get mocked version
    const { useRealtime } = await import('../src/editor/useRealtime.js');

    renderHook(() =>
      useRealtime({
        baseUrl: 'ws://localhost:8787',
        siteId: 'site-1',
        branchId: 'branch-1',
        documentPath: 'pages/home',
        actorId: 'agent-1',
        actorType: 'agent',
        sessionId: 'session-abc',
        enabled: true,
      })
    );

    // Check that connect was called with sessionId
    expect(connectCalls.length).toBeGreaterThan(0);
    expect(connectCalls[0].sessionId).toBe('session-abc');
  });

  it('should not include sessionId when not provided', async () => {
    const { useRealtime } = await import('../src/editor/useRealtime.js');

    renderHook(() =>
      useRealtime({
        baseUrl: 'ws://localhost:8787',
        siteId: 'site-1',
        branchId: 'branch-1',
        documentPath: 'pages/home',
        actorId: 'user-1',
        actorType: 'user',
        enabled: true,
      })
    );

    expect(connectCalls.length).toBeGreaterThan(0);
    expect(connectCalls[0].sessionId).toBeUndefined();
  });
});
