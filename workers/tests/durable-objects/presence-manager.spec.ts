/**
 * Phase 3.2: PresenceManager Durable Object Tests
 *
 * Tests for the site-level PresenceManager DO that aggregates presence
 * across all documents in a site. One PresenceManager per site,
 * identified by env.PRESENCE.idFromName(siteId).
 *
 * Key behaviors:
 * - RPC methods: actorJoined, actorLeft, focusChanged, stateChanged
 * - Query methods: getBranchPresence, getSitePresence, getAgentPresence
 * - Alarm-based stale presence cleanup
 * - Debounced persistence to DO storage
 * - In-memory index: Map<branchId, Map<documentId, Map<actorId, ActorPresence>>>
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Mock cloudflare:workers DurableObject base class
vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

// =============================================================================
// Mock Infrastructure
// =============================================================================

interface MockDurableObjectStorage {
  get: Mock<(key: string) => Promise<unknown>>;
  put: Mock<(key: string, value: unknown) => Promise<void>>;
  delete: Mock<(key: string) => Promise<boolean>>;
  list: Mock<() => Promise<Map<string, unknown>>>;
  getAlarm: Mock<() => Promise<number | null>>;
  setAlarm: Mock<(scheduledTime: number) => Promise<void>>;
}

interface MockDurableObjectState {
  id: { toString: () => string; name: string };
  storage: MockDurableObjectStorage;
  blockConcurrencyWhile: Mock<(callback: () => Promise<void>) => Promise<void>>;
}

function createMockState(siteId = 'site-1'): MockDurableObjectState {
  const storageData = new Map<string, unknown>();

  const storage: MockDurableObjectStorage = {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.get(key))),
    put: vi.fn().mockImplementation((key: string, value: unknown) => {
      storageData.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.delete(key))),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };

  return {
    id: { toString: () => siteId, name: siteId },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
  };
}

interface MockEnv {
  ENVIRONMENT: string;
}

function createMockEnv(): MockEnv {
  return {
    ENVIRONMENT: 'test',
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Phase 3.2: PresenceManager Durable Object', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mockState = createMockState();
    mockEnv = createMockEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('actorJoined()', () => {
    it('should register an actor in the in-memory index', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      // Verify actor is in the index by querying branch presence
      const result = await pm.getBranchPresence('branch-1');
      expect(result.actors).toHaveLength(1);
      expect(result.actors[0].actorId).toBe('user-1');
    });

    it('should support multiple actors on different documents in the same branch', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-2',
        actor: {
          id: 'p-2',
          actorId: 'user-2',
          actorType: 'user',
          role: 'human',
          name: 'Bob',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      const result = await pm.getBranchPresence('branch-1');
      expect(result.actors).toHaveLength(2);
      expect(result.documentSummary).toHaveLength(2);
    });

    it('should replace existing actor entry when the same actor joins again', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      const joinPayload = {
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user' as const,
          role: 'human' as const,
          name: 'Alice',
          state: 'active' as const,
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      };

      await pm.actorJoined(joinPayload);
      await pm.actorJoined({
        ...joinPayload,
        actor: { ...joinPayload.actor, name: 'Alice Updated' },
      });

      const result = await pm.getBranchPresence('branch-1');
      expect(result.actors).toHaveLength(1);
      expect(result.actors[0].name).toBe('Alice Updated');
    });
  });

  describe('actorLeft()', () => {
    it('should remove an actor from the in-memory index', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      await pm.actorLeft({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actorId: 'user-1',
      });

      const result = await pm.getBranchPresence('branch-1');
      expect(result.actors).toHaveLength(0);
    });

    it('should be a no-op if the actor is not present', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      // Should not throw
      await pm.actorLeft({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actorId: 'nonexistent',
      });

      const result = await pm.getBranchPresence('branch-1');
      expect(result.actors).toHaveLength(0);
    });
  });

  describe('focusChanged()', () => {
    it('should update an actor\'s focus regions', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      await pm.focusChanged({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actorId: 'user-1',
        focusRegions: ['/content/0', '/content/1'],
      });

      const result = await pm.getBranchPresence('branch-1');
      expect(result.actors[0].focusRegions).toEqual(['/content/0', '/content/1']);
    });
  });

  describe('stateChanged()', () => {
    it('should update an actor\'s presence state', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      await pm.stateChanged({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actorId: 'user-1',
        state: 'idle',
      });

      const result = await pm.getBranchPresence('branch-1');
      expect(result.actors[0].state).toBe('idle');
    });
  });

  describe('getBranchPresence()', () => {
    it('should return actors and documentSummary for a branch', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-2',
        actor: {
          id: 'p-2',
          actorId: 'agent-1',
          actorType: 'agent',
          role: 'agent',
          name: 'Bot',
          state: 'editing',
          intent: 'Updating content',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      const result = await pm.getBranchPresence('branch-1');

      expect(result.actors).toHaveLength(2);
      expect(result.documentSummary).toHaveLength(2);

      // Document summary should contain document IDs and actor counts
      const doc1Summary = result.documentSummary.find(
        (d: { documentId: string }) => d.documentId === 'doc-1',
      );
      expect(doc1Summary).toBeDefined();
      expect(doc1Summary?.actorCount).toBe(1);
    });

    it('should return empty results for a branch with no actors', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      const result = await pm.getBranchPresence('nonexistent');
      expect(result.actors).toHaveLength(0);
      expect(result.documentSummary).toHaveLength(0);
    });
  });

  describe('getSitePresence()', () => {
    it('should return all actors and branch summaries across the site', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-2',
        documentId: 'doc-1',
        actor: {
          id: 'p-2',
          actorId: 'user-2',
          actorType: 'user',
          role: 'human',
          name: 'Bob',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      const result = await pm.getSitePresence();
      expect(result.actors).toHaveLength(2);
      expect(result.branchSummary).toHaveLength(2);
    });
  });

  describe('getAgentPresence()', () => {
    it('should return locations where a specific agent is active', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'agent-1',
          actorType: 'agent',
          role: 'agent',
          name: 'Bot',
          state: 'editing',
          intent: 'Updating content',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-2',
        documentId: 'doc-3',
        actor: {
          id: 'p-2',
          actorId: 'agent-1',
          actorType: 'agent',
          role: 'agent',
          name: 'Bot',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      const result = await pm.getAgentPresence('agent-1');
      expect(result.locations).toHaveLength(2);
      expect(result.locations[0].branchId).toBe('branch-1');
      expect(result.locations[1].branchId).toBe('branch-2');
    });

    it('should return empty locations for an unknown agent', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      const result = await pm.getAgentPresence('nonexistent');
      expect(result.locations).toHaveLength(0);
    });
  });

  describe('alarm-based stale presence cleanup', () => {
    it('should schedule cleanup alarm on actorJoined', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      // Verify setAlarm was called (for cleanup or persistence)
      expect(mockState.storage.setAlarm.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should clean up stale actors when alarm fires', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      // Add an actor with an old lastActivityAt
      const oldTime = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(); // 9h ago (> 8h threshold)
      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: oldTime,
          joinedAt: oldTime,
        },
      });

      // Verify actor exists
      let result = await pm.getBranchPresence('branch-1');
      expect(result.actors).toHaveLength(1);

      // Advance time past the stale threshold and fire alarm
      await vi.advanceTimersByTimeAsync(130000); // actor is already 9h old, any advance triggers cleanup
      await pm.alarm();

      // Stale actor should be cleaned up
      result = await pm.getBranchPresence('branch-1');
      expect(result.actors).toHaveLength(0);
    });
  });

  describe('debounced persistence', () => {
    it('should persist index to DO storage when alarm fires', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');
      const pm = new PresenceManager(mockState as unknown, mockEnv);

      await pm.actorJoined({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        actor: {
          id: 'p-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      });

      // Fire alarm to flush persistence
      await pm.alarm();

      // Verify storage.put was called with presence index
      const putCalls = mockState.storage.put.mock.calls;
      const presenceIndexPuts = putCalls.filter(
        (call) => call[0] === 'presenceIndex',
      );
      expect(presenceIndexPuts.length).toBeGreaterThanOrEqual(1);
    });

    it('should restore index from DO storage on initialization', async () => {
      const { PresenceManager } = await import('../../src/durable-objects/presence-manager');

      // Pre-populate storage with index data
      const indexData = {
        'branch-1': {
          'doc-1': {
            'user-1': {
              id: 'p-1',
              actorId: 'user-1',
              actorType: 'user',
              role: 'human',
              name: 'Alice',
              state: 'active',
              lastActivityAt: new Date().toISOString(),
              joinedAt: new Date().toISOString(),
            },
          },
        },
      };
      await mockState.storage.put('presenceIndex', indexData);

      const pm = new PresenceManager(mockState as unknown, mockEnv);

      // Force initialization by calling a query
      const result = await pm.getBranchPresence('branch-1');
      expect(result.actors).toHaveLength(1);
      expect(result.actors[0].actorId).toBe('user-1');
    });
  });
});
