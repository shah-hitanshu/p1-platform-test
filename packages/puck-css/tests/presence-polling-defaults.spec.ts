/**
 * Presence Polling Default Interval Tests
 *
 * Verifies that all three presence hooks default to 10000ms polling interval
 * (increased from 5000ms to reduce REST API calls, since WebSocket-based
 * presence updates handle real-time needs).
 *
 * Also verifies that the pollingInterval prop override still works.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { usePresence, useBranchPresence, useSitePresence } from '../src/collaboration/index.js';
import { PresenceContext } from '../src/core/PresenceContext.js';
import type {
  ActorPresence,
  BranchPresence,
  SitePresence,
  P1Client,
} from '@pantheon-systems/css-client';

// =============================================================================
// Mock Data
// =============================================================================

const mockActorPresence: ActorPresence = {
  id: 'presence-1',
  actorId: 'user-123',
  actorType: 'user',
  role: 'human',
  name: 'Test User',
  state: 'active',
  lastActivityAt: '2026-01-27T10:00:00Z',
  joinedAt: '2026-01-27T09:00:00Z',
};

const mockBranchPresence: BranchPresence = {
  branchId: 'branch-1',
  branchName: 'main',
  siteId: 'site-1',
  summary: {
    totalActors: 1,
    humanCount: 1,
    agentCount: 0,
    editingCount: 0,
  },
  actors: [mockActorPresence],
  documentSummary: [],
};

const mockSitePresence: SitePresence = {
  siteId: 'site-1',
  siteName: 'Test Site',
  summary: {
    totalActors: 1,
    humanCount: 1,
    agentCount: 0,
    activeBranches: 1,
  },
  branches: [
    {
      branchId: 'branch-1',
      branchName: 'main',
      actorCount: 1,
      hasHumans: true,
      hasAgents: false,
    },
  ],
};

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(): P1Client {
  return {
    presence: {
      getSitePresence: vi.fn().mockResolvedValue(mockSitePresence),
      getBranchPresence: vi.fn().mockResolvedValue(mockBranchPresence),
      getAgentPresence: vi.fn().mockResolvedValue({
        agentId: 'agent-456',
        agentName: 'Agent',
        organizationId: 'org-1',
        locations: [],
      }),
    },
  } as unknown as P1Client;
}

// =============================================================================
// Test Wrapper
// =============================================================================

function createWrapper(props: {
  client: P1Client;
  siteId: string;
  branchId: string;
  documentPath?: string;
  userId?: string;
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      PresenceContext.Provider,
      {
        value: {
          client: props.client,
          siteId: props.siteId,
          branchId: props.branchId,
          documentPath: props.documentPath ?? null,
          userId: props.userId ?? 'user-self',
        },
      },
      children
    );
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Presence polling default interval (10000ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('usePresence', () => {
    it('should default to 10000ms polling interval', async () => {
      const client = createMockClient();
      renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      // Initial call
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

      // Should NOT poll at 5000ms (old default)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

      // Should poll at 10000ms (new default)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
    });

    it('should respect pollingInterval override', async () => {
      const client = createMockClient();
      renderHook(() => usePresence({ pollingInterval: 3000 }), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
    });
  });

  describe('useBranchPresence', () => {
    it('should default to 10000ms polling interval', async () => {
      const client = createMockClient();
      renderHook(() => useBranchPresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

      // Should NOT poll at 5000ms (old default)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

      // Should poll at 10000ms (new default)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
    });

    it('should respect pollingInterval override', async () => {
      const client = createMockClient();
      renderHook(() => useBranchPresence({ pollingInterval: 7000 }), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000);
      });
      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
    });
  });

  describe('useSitePresence', () => {
    it('should default to 10000ms polling interval', async () => {
      const client = createMockClient();
      renderHook(() => useSitePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(client.presence.getSitePresence).toHaveBeenCalledTimes(1);

      // Should NOT poll at 5000ms (old default)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(client.presence.getSitePresence).toHaveBeenCalledTimes(1);

      // Should poll at 10000ms (new default)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(client.presence.getSitePresence).toHaveBeenCalledTimes(2);
    });

    it('should respect pollingInterval override', async () => {
      const client = createMockClient();
      renderHook(() => useSitePresence({ pollingInterval: 20000 }), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(client.presence.getSitePresence).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
      });
      expect(client.presence.getSitePresence).toHaveBeenCalledTimes(2);
    });
  });
});
