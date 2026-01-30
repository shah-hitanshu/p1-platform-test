/**
 * Phase 2: Presence Hooks Tests (TDD)
 *
 * Tests for usePresence, useBranchPresence, useSitePresence hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { usePresence, useBranchPresence, useSitePresence } from '../src/hooks/index.js';
import { PresenceContext } from '../src/PresenceContext.js';
import type {
  ActorPresence,
  BranchPresence,
  SitePresence,
  CSSClient,
} from '@pantheon/css-client';

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

const mockSitePresence: SitePresence = {
  siteId: 'site-1',
  siteName: 'Test Site',
  summary: {
    totalActors: 3,
    humanCount: 2,
    agentCount: 1,
    activeBranches: 2,
  },
  branches: [
    {
      branchId: 'branch-1',
      branchName: 'main',
      actorCount: 2,
      hasHumans: true,
      hasAgents: true,
    },
    {
      branchId: 'branch-2',
      branchName: 'feature-x',
      actorCount: 1,
      hasHumans: true,
      hasAgents: false,
    },
  ],
};

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(overrides: Partial<CSSClient['presence']> = {}): CSSClient {
  return {
    presence: {
      getSitePresence: vi.fn().mockResolvedValue(mockSitePresence),
      getBranchPresence: vi.fn().mockResolvedValue(mockBranchPresence),
      getAgentPresence: vi.fn().mockResolvedValue({
        agentId: 'agent-456',
        agentName: 'Layout Optimizer',
        organizationId: 'org-1',
        locations: [],
      }),
      ...overrides,
    },
  } as unknown as CSSClient;
}

// =============================================================================
// Test Wrapper
// =============================================================================

interface PresenceProviderProps {
  client: CSSClient;
  siteId: string;
  branchId: string;
  documentPath?: string;
  userId?: string;
  children: React.ReactNode;
}

// Use the imported PresenceContext from the implementation
function PresenceProvider({
  client,
  siteId,
  branchId,
  documentPath,
  userId = 'user-self',
  children,
}: PresenceProviderProps) {
  return React.createElement(
    PresenceContext.Provider,
    { value: { client, siteId, branchId, documentPath: documentPath ?? null, userId } },
    children
  );
}

function createWrapper(props: Omit<PresenceProviderProps, 'children'>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(PresenceProvider, props, children);
  };
}

// =============================================================================
// usePresence Hook Tests
// =============================================================================

describe('usePresence', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    it('should return empty actors initially', () => {
      const client = createMockClient();
      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      expect(result.current.actors).toEqual([]);
      expect(result.current.isLoading).toBe(true);
    });

    it('should start loading on mount', () => {
      const client = createMockClient();
      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('data fetching', () => {
    it('should fetch presence data from branch and filter by document', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledWith('site-1', 'branch-1');
      expect(result.current.actors.length).toBeGreaterThan(0);
    });

    it('should separate humans and agents', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.humans.every((a) => a.role === 'human')).toBe(true);
      expect(result.current.agents.every((a) => a.role === 'agent')).toBe(true);
    });

    it('should identify editing actors', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.editingActors.every((a) => a.state === 'editing')).toBe(true);
    });

    it('should set hasActiveHumans correctly', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasActiveHumans).toBe(true);
    });

    it('should set hasActiveAgents correctly', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasActiveAgents).toBe(true);
    });
  });

  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should poll at the configured interval', async () => {
      const client = createMockClient();
      renderHook(() => usePresence({ pollingInterval: 5000 }), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      // Initial call - flush promises for the initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

      // Advance timer for another poll
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
    });

    it('should use default polling interval of 5000ms', async () => {
      const client = createMockClient();
      renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      // Initial call - flush promises
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
    });
  });

  describe('self filtering', () => {
    it('should exclude self by default', async () => {
      const selfPresence: ActorPresence = {
        ...mockActorPresence,
        id: 'presence-self',
        actorId: 'user-self',
      };
      const client = createMockClient({
        getBranchPresence: vi.fn().mockResolvedValue({
          ...mockBranchPresence,
          actors: [selfPresence, mockAgentPresence],
        }),
      });

      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
          userId: 'user-self',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.actors.find((a) => a.actorId === 'user-self')).toBeUndefined();
    });

    it('should include self when includeSelf is true', async () => {
      const selfPresence: ActorPresence = {
        ...mockActorPresence,
        id: 'presence-self',
        actorId: 'user-self',
      };
      const client = createMockClient({
        getBranchPresence: vi.fn().mockResolvedValue({
          ...mockBranchPresence,
          actors: [selfPresence, mockAgentPresence],
        }),
      });

      const { result } = renderHook(() => usePresence({ includeSelf: true }), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
          userId: 'user-self',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.actors.find((a) => a.actorId === 'user-self')).toBeDefined();
    });
  });

  describe('refresh', () => {
    it('should provide a refresh function', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(typeof result.current.refresh).toBe('function');

      await act(async () => {
        await result.current.refresh();
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should capture errors', async () => {
      const error = new Error('Network error');
      const client = createMockClient({
        getBranchPresence: vi.fn().mockRejectedValue(error),
      });

      const { result } = renderHook(() => usePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/pages/home',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe(error);
    });
  });
});

// =============================================================================
// useBranchPresence Hook Tests
// =============================================================================

describe('useBranchPresence', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    it('should return null presence initially', () => {
      const client = createMockClient();
      const { result } = renderHook(() => useBranchPresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      expect(result.current.presence).toBeNull();
      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('data fetching', () => {
    it('should fetch branch presence data', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useBranchPresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledWith('site-1', 'branch-1');
      expect(result.current.presence).toEqual(mockBranchPresence);
    });

    it('should provide active documents summary', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useBranchPresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeDocuments).toEqual(mockBranchPresence.documentSummary);
    });

    it('should provide total actor count', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useBranchPresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.totalActors).toBe(2);
    });
  });

  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should poll at the configured interval', async () => {
      const client = createMockClient();
      renderHook(() => useBranchPresence({ pollingInterval: 10000 }), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      // Initial call - flush promises
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
    });
  });

  describe('refresh', () => {
    it('should provide a refresh function', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useBranchPresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should capture errors', async () => {
      const error = new Error('API error');
      const client = createMockClient({
        getBranchPresence: vi.fn().mockRejectedValue(error),
      });

      const { result } = renderHook(() => useBranchPresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe(error);
    });
  });
});

// =============================================================================
// useSitePresence Hook Tests
// =============================================================================

describe('useSitePresence', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    it('should return null presence initially', () => {
      const client = createMockClient();
      const { result } = renderHook(() => useSitePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      expect(result.current.presence).toBeNull();
      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('data fetching', () => {
    it('should fetch site presence data', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useSitePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(client.presence.getSitePresence).toHaveBeenCalledWith('site-1');
      expect(result.current.presence).toEqual(mockSitePresence);
    });

    it('should provide active branches summary', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useSitePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeBranches).toEqual(mockSitePresence.branches);
    });

    it('should provide total actor count', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useSitePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.totalActors).toBe(3);
    });
  });

  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should poll at the configured interval', async () => {
      const client = createMockClient();
      renderHook(() => useSitePresence({ pollingInterval: 15000 }), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      // Initial call - flush promises
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(client.presence.getSitePresence).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });

      expect(client.presence.getSitePresence).toHaveBeenCalledTimes(2);
    });
  });

  describe('refresh', () => {
    it('should provide a refresh function', async () => {
      const client = createMockClient();
      const { result } = renderHook(() => useSitePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(client.presence.getSitePresence).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should capture errors', async () => {
      const error = new Error('Site not found');
      const client = createMockClient({
        getSitePresence: vi.fn().mockRejectedValue(error),
      });

      const { result } = renderHook(() => useSitePresence(), {
        wrapper: createWrapper({
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
        }),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe(error);
    });
  });
});
