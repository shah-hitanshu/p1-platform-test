/**
 * Phase 9: Provider Enhancement Tests (TDD)
 *
 * Tests for enhanced CSSPuckProvider with presence and agent features.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { CSSPuckProvider } from '../src/editor/CSSPuckProvider.js';
import { useCSSPuck } from '../src/core/CSSPuckContext.js';
import type {
  CSSClient,
  ActorPresence,
  BranchPresence,
  Branch,
  RegisteredAgent,
} from '@pantheon-systems/css-client';
import type { ConflictNotification } from '../src/merge/components/conflict-notifications/index.js';

// =============================================================================
// Mock Data
// =============================================================================

const mockActorPresence: ActorPresence = {
  id: 'presence-1',
  actorId: 'user-123',
  actorType: 'user',
  role: 'human',
  name: 'Test User',
  avatar: 'https://example.com/avatar.png',
  state: 'active',
  intent: undefined,
  focusRegions: ['/content/0'],
  lastActivityAt: '2026-01-27T10:00:00Z',
  joinedAt: '2026-01-27T09:00:00Z',
};

const mockAgentPresence: ActorPresence = {
  id: 'presence-2',
  actorId: 'agent-456',
  actorType: 'agent',
  role: 'agent',
  name: 'Layout Optimizer',
  state: 'editing',
  intent: 'Optimizing layout for mobile',
  focusRegions: ['/content/1', '/content/2'],
  lastActivityAt: '2026-01-27T10:00:00Z',
  joinedAt: '2026-01-27T09:30:00Z',
};

const mockBranchPresence: BranchPresence = {
  branchId: 'branch-1',
  branchName: 'main',
  siteId: 'site-1',
  summary: {
    totalActors: 2,
    humanCount: 1,
    agentCount: 1,
    editingCount: 1,
  },
  actors: [mockActorPresence, mockAgentPresence],
  documentSummary: [
    {
      documentId: 'doc-1',
      documentPath: '/pages/home',
      actorCount: 2,
      hasHumans: true,
      hasAgents: true,
    },
  ],
};

const mockBranch: Branch = {
  id: 'branch-1',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockAgent: RegisteredAgent = {
  id: 'agent-456',
  organizationId: 'org-1',
  name: 'Layout Optimizer',
  description: 'Optimizes page layouts',
  capabilities: ['layout', 'responsive'],
  status: 'active',
  settings: {
    canEditAutonomously: false,
    requiresHumanApproval: true,
    maxConcurrentEdits: 1,
    allowedOperations: ['layout'],
    focusRegionRestrictions: [],
  },
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
      getLatest: vi.fn().mockResolvedValue({ id: 'v1', snapshot: {} }),
      create: vi.fn(),
    },
    checkpoints: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
    },
    presence: {
      getSitePresence: vi.fn().mockResolvedValue({
        siteId: 'site-1',
        siteName: 'Test Site',
        summary: { totalActors: 2, humanCount: 1, agentCount: 1, activeBranches: 1 },
        branches: [],
      }),
      getBranchPresence: vi.fn().mockResolvedValue(mockBranchPresence),
      getAgentPresence: vi.fn().mockResolvedValue({
        agentId: 'agent-456',
        agentName: 'Layout Optimizer',
        organizationId: 'org-1',
        locations: [],
      }),
    },
    agentRegistry: {
      list: vi.fn().mockResolvedValue({ agents: [mockAgent] }),
      get: vi.fn().mockResolvedValue(mockAgent),
      create: vi.fn(),
      update: vi.fn(),
      updateStatus: vi.fn(),
      delete: vi.fn(),
    },
    agentEdit: {
      canEdit: vi.fn().mockResolvedValue({ allowed: true }),
      startEdit: vi.fn().mockResolvedValue({ sessionId: 'session-1', checkpointId: 'cp-1' }),
      completeEdit: vi.fn().mockResolvedValue({ success: true, checkpointId: 'cp-1' }),
      abortEdit: vi.fn().mockResolvedValue({ success: true }),
    },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as CSSClient;
}

// =============================================================================
// Provider Wrapper Factory
// =============================================================================

interface WrapperProps {
  children: React.ReactNode;
}

function createProviderWrapper(
  client: CSSClient,
  options: {
    siteId?: string;
    branchId?: string;
    userId?: string;
    userName?: string;
    userAvatar?: string;
    presenceEnabled?: boolean;
    presencePollingInterval?: number;
    agentModeEnabled?: boolean;
    agentId?: string;
    agentTrigger?: 'human_requested' | 'autonomous';
    onPresenceChange?: (actors: ActorPresence[]) => void;
    onAgentConflict?: (conflict: ConflictNotification) => void;
  } = {}
) {
  const {
    siteId = 'site-1',
    branchId = 'branch-1',
    userId = 'user-789',
    userName,
    userAvatar,
    presenceEnabled,
    presencePollingInterval,
    agentModeEnabled,
    agentId,
    agentTrigger,
    onPresenceChange,
    onAgentConflict,
  } = options;

  return function Wrapper({ children }: WrapperProps) {
    return React.createElement(
      CSSPuckProvider,
      {
        client,
        siteId,
        branchId,
        userId,
        userName,
        userAvatar,
        presenceEnabled,
        presencePollingInterval,
        agentModeEnabled,
        agentId,
        agentTrigger,
        onPresenceChange,
        onAgentConflict,
      },
      children
    );
  };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('CSSPuckProvider Enhancement - Phase 9', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Basic Provider Functionality (Existing)
  // ===========================================================================

  describe('basic provider functionality', () => {
    it('should provide core context values', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useCSSPuck(), {
        wrapper: createProviderWrapper(client, {
          siteId: 'site-1',
          branchId: 'branch-1',
          userId: 'user-789',
        }),
      });

      expect(result.current.siteId).toBe('site-1');
      expect(result.current.branchId).toBe('branch-1');
      expect(result.current.userId).toBe('user-789');
    });

    it('should provide client instance', () => {
      const client = createMockClient();
      const { result } = renderHook(() => useCSSPuck(), {
        wrapper: createProviderWrapper(client),
      });

      expect(result.current.client).toBeDefined();
    });
  });

  // ===========================================================================
  // Presence Feature (presenceEnabled)
  // ===========================================================================

  describe('presence feature', () => {
    describe('when presenceEnabled is false (default)', () => {
      it('should have null presence object', () => {
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, { presenceEnabled: false }),
        });

        expect(result.current.presence).toBeNull();
      });

      it('should not fetch presence data', async () => {
        const client = createMockClient();
        renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, { presenceEnabled: false }),
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });

        expect(client.presence.getBranchPresence).not.toHaveBeenCalled();
      });
    });

    describe('when presenceEnabled is true', () => {
      it('should have presence object with actors', async () => {
        vi.useRealTimers();
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, { presenceEnabled: true }),
        });

        await waitFor(() => {
          expect(result.current.presence).not.toBeNull();
        });

        expect(result.current.presence?.actors).toBeDefined();
        expect(Array.isArray(result.current.presence?.actors)).toBe(true);
      });

      it('should separate humans and agents in presence', async () => {
        vi.useRealTimers();
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, { presenceEnabled: true }),
        });

        await waitFor(() => {
          expect(result.current.presence).not.toBeNull();
        });

        expect(result.current.presence?.humans).toBeDefined();
        expect(result.current.presence?.agents).toBeDefined();
      });

      it('should provide hasActiveHumans and hasActiveAgents flags', async () => {
        vi.useRealTimers();
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, { presenceEnabled: true }),
        });

        await waitFor(() => {
          expect(result.current.presence).not.toBeNull();
        });

        expect(typeof result.current.presence?.hasActiveHumans).toBe('boolean');
        expect(typeof result.current.presence?.hasActiveAgents).toBe('boolean');
      });

      it('should provide refresh function', async () => {
        vi.useRealTimers();
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, { presenceEnabled: true }),
        });

        await waitFor(() => {
          expect(result.current.presence).not.toBeNull();
        });

        expect(typeof result.current.presence?.refresh).toBe('function');
      });

      it('should use custom polling interval', async () => {
        const client = createMockClient();
        renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, {
            presenceEnabled: true,
            presencePollingInterval: 10000,
          }),
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });

        expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

        // Advance less than custom interval - should not poll again
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });

        expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

        // Advance to reach custom interval
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });

        expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
      });
    });

    describe('onPresenceChange callback', () => {
      it('should call onPresenceChange when presence data changes', async () => {
        vi.useRealTimers();
        const client = createMockClient();
        const onPresenceChange = vi.fn();

        renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, {
            presenceEnabled: true,
            onPresenceChange,
          }),
        });

        await waitFor(() => {
          expect(onPresenceChange).toHaveBeenCalled();
        });

        expect(onPresenceChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ actorId: expect.any(String) }),
          ])
        );
      });
    });
  });

  // ===========================================================================
  // Agent Mode Feature (agentModeEnabled)
  // ===========================================================================

  describe('agent mode feature', () => {
    describe('when agentModeEnabled is false (default)', () => {
      it('should have null agentEdit', () => {
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, { agentModeEnabled: false }),
        });

        expect(result.current.agentEdit).toBeNull();
      });
    });

    describe('when agentModeEnabled is true with agentId', () => {
      it('should provide agentEdit capabilities', async () => {
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, {
            agentModeEnabled: true,
            agentId: 'agent-456',
          }),
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });

        expect(result.current.agentEdit).not.toBeNull();
        expect(result.current.agentEdit?.canEdit).toBeDefined();
        expect(result.current.agentEdit?.startEdit).toBeDefined();
        expect(result.current.agentEdit?.completeEdit).toBeDefined();
        expect(result.current.agentEdit?.abortEdit).toBeDefined();
      });

      it('should track isEditing state', async () => {
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, {
            agentModeEnabled: true,
            agentId: 'agent-456',
          }),
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });

        expect(result.current.agentEdit?.isEditing).toBe(false);
      });

      it('should provide session info', async () => {
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, {
            agentModeEnabled: true,
            agentId: 'agent-456',
          }),
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });

        expect(result.current.agentEdit?.session).toBeNull();
      });
    });

    describe('when agentModeEnabled is true without agentId (human user)', () => {
      it('should have null agentEdit but provide triggerAgent', async () => {
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, {
            agentModeEnabled: true,
            // No agentId - this is a human user
          }),
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });

        expect(result.current.agentEdit).toBeNull();
        expect(result.current.triggerAgent).not.toBeNull();
        expect(typeof result.current.triggerAgent).toBe('function');
      });
    });
  });

  // ===========================================================================
  // Trigger Agent Feature (for human users)
  // ===========================================================================

  describe('triggerAgent feature', () => {
    describe('when agentModeEnabled is false', () => {
      it('should have null triggerAgent', () => {
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, { agentModeEnabled: false }),
        });

        expect(result.current.triggerAgent).toBeNull();
      });
    });

    describe('when agentModeEnabled is true for human user', () => {
      it('should provide triggerAgent function', async () => {
        const client = createMockClient();
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, {
            agentModeEnabled: true,
          }),
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });

        expect(result.current.triggerAgent).not.toBeNull();
        expect(typeof result.current.triggerAgent).toBe('function');
      });
    });
  });

  // ===========================================================================
  // Conflict Notifications
  // ===========================================================================

  describe('conflict notifications', () => {
    it('should provide empty conflicts array initially', () => {
      const client = createMockClient();
      const { result } = renderHook(() => useCSSPuck(), {
        wrapper: createProviderWrapper(client),
      });

      expect(result.current.conflicts).toEqual([]);
    });

    it('should provide dismissConflict function', () => {
      const client = createMockClient();
      const { result } = renderHook(() => useCSSPuck(), {
        wrapper: createProviderWrapper(client),
      });

      expect(typeof result.current.dismissConflict).toBe('function');
    });

    describe('onAgentConflict callback', () => {
      it('should be available as a prop', () => {
        const client = createMockClient();
        const onAgentConflict = vi.fn();

        // Just verify the provider accepts the callback without error
        const { result } = renderHook(() => useCSSPuck(), {
          wrapper: createProviderWrapper(client, {
            onAgentConflict,
          }),
        });

        expect(result.current).toBeDefined();
      });
    });
  });

  // ===========================================================================
  // User Display Info Props
  // ===========================================================================

  describe('user display info props', () => {
    it('should accept userName prop', () => {
      const client = createMockClient();
      const { result } = renderHook(() => useCSSPuck(), {
        wrapper: createProviderWrapper(client, {
          userName: 'John Doe',
        }),
      });

      expect(result.current).toBeDefined();
    });

    it('should accept userAvatar prop', () => {
      const client = createMockClient();
      const { result } = renderHook(() => useCSSPuck(), {
        wrapper: createProviderWrapper(client, {
          userAvatar: 'https://example.com/avatar.png',
        }),
      });

      expect(result.current).toBeDefined();
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('integration', () => {
    it('should work with both presence and agent mode enabled', async () => {
      vi.useRealTimers();
      const client = createMockClient();
      const { result } = renderHook(() => useCSSPuck(), {
        wrapper: createProviderWrapper(client, {
          presenceEnabled: true,
          agentModeEnabled: true,
        }),
      });

      await waitFor(() => {
        expect(result.current.presence).not.toBeNull();
      });

      expect(result.current.presence).not.toBeNull();
      expect(result.current.triggerAgent).not.toBeNull();
      expect(result.current.conflicts).toEqual([]);
    });

    it('should maintain existing functionality with new features', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useCSSPuck(), {
        wrapper: createProviderWrapper(client, {
          presenceEnabled: true,
          agentModeEnabled: true,
        }),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // Existing functionality should still work
      expect(result.current.client).toBeDefined();
      expect(result.current.siteId).toBe('site-1');
      expect(result.current.branchId).toBe('branch-1');
      expect(result.current.userId).toBe('user-789');
      expect(result.current.saveStatus).toBeDefined();
      expect(typeof result.current.loadDocument).toBe('function');
      expect(typeof result.current.saveData).toBe('function');
      expect(typeof result.current.createCheckpoint).toBe('function');
    });
  });
});
