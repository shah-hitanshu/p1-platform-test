/**
 * Phase 4: Agent Edit Workflow Hooks Tests (TDD)
 *
 * Tests for useAgentEdit and useAgentTrigger hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { useAgentEdit, useAgentTrigger } from '../src/agent/index.js';
import { PresenceContext } from '../src/core/PresenceContext.js';
import type {
  P1Client,
  AgentEditPermission,
  AgentEditSession,
  AgentEditCompleteResult,
  AgentEditAbortResult,
  RegisteredAgent,
} from '@pantheon-systems/css-client';

// =============================================================================
// Mock Data
// =============================================================================

const mockPermissionAllowed: AgentEditPermission = {
  allowed: true,
};

const mockPermissionDenied: AgentEditPermission = {
  allowed: false,
  reason: 'human_actively_editing',
  conflictingRegions: ['/content/0', '/content/1'],
};

const mockSession: AgentEditSession = {
  sessionId: 'session-123',
  checkpointId: 'checkpoint-abc',
};

const mockCompleteResult: AgentEditCompleteResult = {
  success: true,
  checkpointId: 'checkpoint-abc',
};

const mockAbortResult: AgentEditAbortResult = {
  success: true,
  rolledBack: true,
};

const mockAgent: RegisteredAgent = {
  id: 'agent-123',
  organizationId: 'org-1',
  name: 'Layout Optimizer',
  description: 'Optimizes layouts for mobile',
  capabilities: ['layout', 'responsive'],
  status: 'active',
  settings: {
    maxConcurrentEdits: 1,
    requireHumanApproval: false,
    allowedTriggers: ['human_requested', 'autonomous'],
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(overrides: Partial<P1Client['agentEdit']> = {}): P1Client {
  return {
    agentEdit: {
      canEdit: vi.fn().mockResolvedValue(mockPermissionAllowed),
      startEdit: vi.fn().mockResolvedValue(mockSession),
      completeEdit: vi.fn().mockResolvedValue(mockCompleteResult),
      abortEdit: vi.fn().mockResolvedValue(mockAbortResult),
      ...overrides,
    },
    presence: {
      getSitePresence: vi.fn().mockResolvedValue({}),
      getBranchPresence: vi.fn().mockResolvedValue({ actors: [] }),
      getAgentPresence: vi.fn().mockResolvedValue({}),
    },
  } as unknown as P1Client;
}

// =============================================================================
// Test Wrapper
// =============================================================================

interface TestWrapperProps {
  client?: P1Client;
  documentPath?: string;
  children: React.ReactNode;
}

function createWrapper(client: P1Client = createMockClient(), documentPath = '/pages/home') {
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
// useAgentEdit Hook Tests
// =============================================================================

describe('useAgentEdit', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should return initial state with no session', () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      expect(result.current.session).toBeNull();
      expect(result.current.isEditing).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('canEdit', () => {
    it('should call API with correct parameters', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      await act(async () => {
        await result.current.canEdit({
          trigger: 'human_requested',
          intent: 'Optimize layout',
          targetRegions: ['/content/0'],
          requestedById: 'user-456',
        });
      });

      expect(client.agentEdit.canEdit).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        '/pages/home',
        {
          agentId: 'agent-123',
          trigger: 'human_requested',
          intent: 'Optimize layout',
          targetRegions: ['/content/0'],
          requestedById: 'user-456',
        }
      );
    });

    it('should return permission result', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      let permission: AgentEditPermission | undefined;
      await act(async () => {
        permission = await result.current.canEdit({
          trigger: 'human_requested',
          intent: 'Optimize layout',
          targetRegions: ['/content/0'],
        });
      });

      expect(permission?.allowed).toBe(true);
    });

    it('should call onDenied callback when permission denied', async () => {
      const client = createMockClient({
        canEdit: vi.fn().mockResolvedValue(mockPermissionDenied),
      });
      const onDenied = vi.fn();

      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123', onDenied }),
        { wrapper: createWrapper(client) }
      );

      await act(async () => {
        await result.current.canEdit({
          trigger: 'autonomous',
          intent: 'Auto optimize',
          targetRegions: ['/content/0'],
        });
      });

      expect(onDenied).toHaveBeenCalledWith(
        'human_actively_editing',
        ['/content/0', '/content/1']
      );
    });
  });

  describe('startEdit', () => {
    it('should call API and update session state', async () => {
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

      expect(client.agentEdit.startEdit).toHaveBeenCalled();
      expect(result.current.session).toEqual(mockSession);
      expect(result.current.isEditing).toBe(true);
    });

    it('should set loading state during request', async () => {
      vi.useFakeTimers();

      const client = createMockClient({
        startEdit: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockSession), 100))
        ),
      });

      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      // Start the request but don't complete it yet
      let startPromise: Promise<unknown>;
      await act(async () => {
        startPromise = result.current.startEdit({
          trigger: 'human_requested',
          intent: 'Optimize',
          targetRegions: [],
        });
        // Allow React to process the state update
        await Promise.resolve();
      });

      // Loading should be true during request
      expect(result.current.isLoading).toBe(true);

      // Advance time to complete the request
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      await act(async () => {
        await startPromise;
      });

      expect(result.current.isLoading).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('completeEdit', () => {
    it('should call API and clear session', async () => {
      const client = createMockClient();
      const onComplete = vi.fn();

      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123', onComplete }),
        { wrapper: createWrapper(client) }
      );

      // Start an edit first
      await act(async () => {
        await result.current.startEdit({
          trigger: 'human_requested',
          intent: 'Optimize',
          targetRegions: [],
        });
      });

      expect(result.current.isEditing).toBe(true);

      // Complete the edit
      await act(async () => {
        await result.current.completeEdit();
      });

      expect(client.agentEdit.completeEdit).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        '/pages/home',
        'agent-123'
      );
      expect(result.current.session).toBeNull();
      expect(result.current.isEditing).toBe(false);
      expect(onComplete).toHaveBeenCalledWith('checkpoint-abc');
    });

    it('should throw if no active session', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      await expect(
        act(async () => {
          await result.current.completeEdit();
        })
      ).rejects.toThrow('No active edit session');
    });
  });

  describe('abortEdit', () => {
    it('should call API with checkpoint and clear session', async () => {
      const client = createMockClient();
      const onAborted = vi.fn();

      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123', onAborted }),
        { wrapper: createWrapper(client) }
      );

      // Start an edit first
      await act(async () => {
        await result.current.startEdit({
          trigger: 'autonomous',
          intent: 'Auto optimize',
          targetRegions: ['/content/0'],
        });
      });

      // Abort the edit
      await act(async () => {
        await result.current.abortEdit();
      });

      expect(client.agentEdit.abortEdit).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        '/pages/home',
        'agent-123',
        'checkpoint-abc'
      );
      expect(result.current.session).toBeNull();
      expect(result.current.isEditing).toBe(false);
      expect(onAborted).toHaveBeenCalled();
    });

    it('should throw if no active session', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      await expect(
        act(async () => {
          await result.current.abortEdit();
        })
      ).rejects.toThrow('No active edit session');
    });
  });

  describe('error handling', () => {
    it('should capture errors and set error state', async () => {
      const error = new Error('API error');
      const client = createMockClient({
        startEdit: vi.fn().mockRejectedValue(error),
      });

      const { result } = renderHook(
        () => useAgentEdit({ agentId: 'agent-123' }),
        { wrapper: createWrapper(client) }
      );

      await act(async () => {
        try {
          await result.current.startEdit({
            trigger: 'human_requested',
            intent: 'Optimize',
            targetRegions: [],
          });
        } catch {
          // Expected
        }
      });

      expect(result.current.error).toBe(error);
      expect(result.current.isEditing).toBe(false);
    });
  });
});

// =============================================================================
// useAgentTrigger Hook Tests
// =============================================================================

describe('useAgentTrigger', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should return idle status initially', () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentTrigger({ agents: [mockAgent] }),
        { wrapper: createWrapper(client) }
      );

      expect(result.current.status).toBe('idle');
      expect(result.current.activeAction).toBeNull();
    });
  });

  describe('triggerAgent', () => {
    it('should check permission, start edit, and complete', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentTrigger({ agents: [mockAgent] }),
        { wrapper: createWrapper(client) }
      );

      let triggerResult: { success: boolean; checkpointId?: string; error?: string } | undefined;

      await act(async () => {
        triggerResult = await result.current.triggerAgent({
          agentId: 'agent-123',
          intent: 'Optimize layout',
          targetRegions: ['/content/0'],
        });
      });

      expect(client.agentEdit.canEdit).toHaveBeenCalled();
      expect(client.agentEdit.startEdit).toHaveBeenCalled();
      expect(triggerResult?.success).toBe(true);
    });

    it('should return error when permission denied', async () => {
      const client = createMockClient({
        canEdit: vi.fn().mockResolvedValue(mockPermissionDenied),
      });

      const { result } = renderHook(
        () => useAgentTrigger({ agents: [mockAgent] }),
        { wrapper: createWrapper(client) }
      );

      let triggerResult: { success: boolean; error?: string } | undefined;

      await act(async () => {
        triggerResult = await result.current.triggerAgent({
          agentId: 'agent-123',
          intent: 'Optimize layout',
          targetRegions: ['/content/0'],
        });
      });

      expect(triggerResult?.success).toBe(false);
      expect(triggerResult?.error).toBe('human_actively_editing');
      expect(client.agentEdit.startEdit).not.toHaveBeenCalled();
    });

    it('should update status through workflow stages', async () => {
      vi.useFakeTimers();

      const client = createMockClient({
        canEdit: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockPermissionAllowed), 50))
        ),
        startEdit: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockSession), 50))
        ),
      });

      const { result } = renderHook(
        () => useAgentTrigger({ agents: [mockAgent] }),
        { wrapper: createWrapper(client) }
      );

      // Start the trigger but don't complete it yet
      let triggerPromise: Promise<unknown>;
      await act(async () => {
        triggerPromise = result.current.triggerAgent({
          agentId: 'agent-123',
          intent: 'Optimize',
          targetRegions: [],
        });
        // Allow React to process the state update
        await Promise.resolve();
      });

      // Should be in checking status
      expect(result.current.status).toBe('checking');

      // Advance time to complete canEdit and startEdit
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      await act(async () => {
        await triggerPromise;
      });

      // Should return to idle after complete
      expect(result.current.status).toBe('idle');

      vi.useRealTimers();
    });

    it('should set activeAction during workflow', async () => {
      vi.useFakeTimers();

      const client = createMockClient({
        startEdit: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockSession), 100))
        ),
      });

      const { result } = renderHook(
        () => useAgentTrigger({ agents: [mockAgent] }),
        { wrapper: createWrapper(client) }
      );

      const action = {
        agentId: 'agent-123',
        intent: 'Optimize layout',
        targetRegions: ['/content/0'],
      };

      // Start the trigger but don't complete it yet
      let triggerPromise: Promise<unknown>;
      await act(async () => {
        triggerPromise = result.current.triggerAgent(action);
        // Allow React to process the state update
        await Promise.resolve();
      });

      // activeAction should be set
      expect(result.current.activeAction).toEqual(action);

      // Advance time to complete the request
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      await act(async () => {
        await triggerPromise;
      });

      expect(result.current.activeAction).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('cancelAction', () => {
    it('should abort active action and reset state', async () => {
      vi.useFakeTimers();

      const client = createMockClient({
        startEdit: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockSession), 500))
        ),
      });

      const { result } = renderHook(
        () => useAgentTrigger({ agents: [mockAgent] }),
        { wrapper: createWrapper(client) }
      );

      // Start an action but don't complete it yet
      await act(async () => {
        void result.current.triggerAgent({
          agentId: 'agent-123',
          intent: 'Optimize',
          targetRegions: [],
        });
        // Allow React to process the state update
        await Promise.resolve();
      });

      // Action should be active
      expect(result.current.activeAction).not.toBeNull();

      // Cancel it
      await act(async () => {
        await result.current.cancelAction();
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.activeAction).toBeNull();

      vi.useRealTimers();
    });

    it('should do nothing if no active action', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useAgentTrigger({ agents: [mockAgent] }),
        { wrapper: createWrapper(client) }
      );

      await act(async () => {
        await result.current.cancelAction();
      });

      expect(result.current.status).toBe('idle');
    });
  });

  describe('error handling', () => {
    it('should set error status on API error', async () => {
      const client = createMockClient({
        startEdit: vi.fn().mockRejectedValue(new Error('Network error')),
      });

      const { result } = renderHook(
        () => useAgentTrigger({ agents: [mockAgent] }),
        { wrapper: createWrapper(client) }
      );

      let triggerResult: { success: boolean; error?: string } | undefined;

      await act(async () => {
        triggerResult = await result.current.triggerAgent({
          agentId: 'agent-123',
          intent: 'Optimize',
          targetRegions: [],
        });
      });

      expect(triggerResult?.success).toBe(false);
      expect(triggerResult?.error).toBe('Network error');
      expect(result.current.status).toBe('idle');
    });
  });
});
