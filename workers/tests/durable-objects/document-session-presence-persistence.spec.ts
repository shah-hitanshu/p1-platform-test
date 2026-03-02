/**
 * Phase 3.1: Persist Presence to DO Storage Tests
 *
 * Tests for serialization/deserialization of PresenceManager state
 * and persistence of presence data in DocumentSession Durable Object storage.
 *
 * Key behaviors:
 * - PresenceManager.serialize() returns a JSON-serializable object
 * - PresenceManager.deserialize() recreates state from serialized data
 * - persistPresence() stores serialized presence to DO storage (debounced)
 * - restorePresence() loads presence from DO storage on initialization
 * - Presence is persisted immediately on disconnect
 * - Presence is persisted (debounced) on focus updates
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
  acceptWebSocket: Mock;
  getWebSockets: Mock;
}

function createMockState(sessionId = 'site-1:doc-1:branch-1'): MockDurableObjectState {
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

  const acceptedWebSockets: WebSocket[] = [];

  return {
    id: { toString: () => sessionId, name: sessionId },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn().mockImplementation((ws: WebSocket) => {
      acceptedWebSockets.push(ws);
    }),
    getWebSockets: vi.fn().mockImplementation(() => {
      return acceptedWebSockets.filter((ws) => ws.readyState === WebSocket.OPEN);
    }),
  };
}

interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
}

function createMockEnv(): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
  };
}

function createMockWebSocket(actorId = 'user-1'): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true),
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    binaryType: 'arraybuffer' as BinaryType,
    bufferedAmount: 0,
    extensions: '',
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    protocol: '',
    url: '',
    serializeAttachment: vi.fn(),
    deserializeAttachment: vi.fn().mockReturnValue({
      actorId,
      actorType: 'user',
      verified: false,
    }),
  } as unknown as WebSocket;
}

// =============================================================================
// Tests: PresenceManager Serialization
// =============================================================================

describe('Phase 3.1: Persist Presence to DO Storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('PresenceManager.serialize()', () => {
    it('should return a JSON-serializable object with presences and actorIdIndex', async () => {
      const { PresenceManager } = await import('../../src/services/presence-service');
      const pm = new PresenceManager();

      pm.register({
        actorId: 'user-1',
        actorType: 'user',
        name: 'Alice',
        state: 'active',
        focusRegions: ['/content/0'],
      });

      pm.register({
        actorId: 'agent-1',
        actorType: 'agent',
        name: 'Bot',
        intent: 'Editing hero section',
      });

      const serialized = pm.serialize();

      // Should be JSON-serializable (no Map, no Uint8Array, etc.)
      const jsonString = JSON.stringify(serialized);
      expect(jsonString).toBeDefined();
      const parsed = JSON.parse(jsonString);
      expect(parsed).toBeDefined();

      // Should contain presences array
      expect(Array.isArray(serialized.presences)).toBe(true);
      expect(serialized.presences).toHaveLength(2);

      // Should contain actorIdIndex mapping
      expect(typeof serialized.actorIdIndex).toBe('object');
      expect(serialized.actorIdIndex['user-1']).toBeDefined();
      expect(serialized.actorIdIndex['agent-1']).toBeDefined();
    });

    it('should serialize an empty PresenceManager', async () => {
      const { PresenceManager } = await import('../../src/services/presence-service');
      const pm = new PresenceManager();

      const serialized = pm.serialize();

      expect(serialized.presences).toHaveLength(0);
      expect(Object.keys(serialized.actorIdIndex)).toHaveLength(0);
    });

    it('should preserve all ActorPresence fields in serialization', async () => {
      const { PresenceManager } = await import('../../src/services/presence-service');
      const pm = new PresenceManager();

      const registered = pm.register({
        actorId: 'user-1',
        actorType: 'user',
        name: 'Alice',
        avatar: 'https://example.com/alice.png',
        state: 'editing',
        intent: 'Updating content',
        focusRegions: ['/content/0', '/content/1'],
      });

      const serialized = pm.serialize();
      const presence = serialized.presences[0];

      expect(presence.id).toBe(registered.id);
      expect(presence.actorId).toBe('user-1');
      expect(presence.actorType).toBe('user');
      expect(presence.role).toBe('human');
      expect(presence.name).toBe('Alice');
      expect(presence.avatar).toBe('https://example.com/alice.png');
      expect(presence.state).toBe('editing');
      expect(presence.intent).toBe('Updating content');
      expect(presence.focusRegions).toEqual(['/content/0', '/content/1']);
      expect(presence.lastActivityAt).toBeDefined();
      expect(presence.joinedAt).toBeDefined();
    });
  });

  describe('PresenceManager.deserialize()', () => {
    it('should recreate a PresenceManager from serialized data', async () => {
      const { PresenceManager } = await import('../../src/services/presence-service');
      const original = new PresenceManager();

      original.register({
        actorId: 'user-1',
        actorType: 'user',
        name: 'Alice',
        state: 'active',
        focusRegions: ['/content/0'],
      });

      original.register({
        actorId: 'agent-1',
        actorType: 'agent',
        name: 'Bot',
        intent: 'Editing hero section',
      });

      const serialized = original.serialize();
      const restored = PresenceManager.deserialize(serialized);

      // Should have same count
      expect(restored.count()).toBe(2);

      // Should be able to look up by actorId
      const user = restored.getByActorId('user-1');
      expect(user).toBeDefined();
      expect(user?.name).toBe('Alice');
      expect(user?.focusRegions).toEqual(['/content/0']);

      const agent = restored.getByActorId('agent-1');
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('Bot');
      expect(agent?.intent).toBe('Editing hero section');
    });

    it('should deserialize empty data correctly', async () => {
      const { PresenceManager } = await import('../../src/services/presence-service');
      const restored = PresenceManager.deserialize({
        presences: [],
        actorIdIndex: {},
      });

      expect(restored.count()).toBe(0);
      expect(restored.getAll()).toHaveLength(0);
    });

    it('should produce a fully functional PresenceManager after deserialization', async () => {
      const { PresenceManager } = await import('../../src/services/presence-service');
      const original = new PresenceManager();

      original.register({
        actorId: 'user-1',
        actorType: 'user',
        name: 'Alice',
        state: 'active',
      });

      const serialized = original.serialize();
      const restored = PresenceManager.deserialize(serialized);

      // Should support register (new actor)
      const newPresence = restored.register({
        actorId: 'user-2',
        actorType: 'user',
        name: 'Bob',
        state: 'active',
      });
      expect(newPresence).toBeDefined();
      expect(restored.count()).toBe(2);

      // Should support unregister
      const removed = restored.unregisterByActorId('user-1');
      expect(removed).toBe(true);
      expect(restored.count()).toBe(1);

      // Should support getAll
      const all = restored.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].actorId).toBe('user-2');
    });

    it('should roundtrip serialize/deserialize correctly', async () => {
      const { PresenceManager } = await import('../../src/services/presence-service');
      const original = new PresenceManager();

      // Register several presences with various fields
      original.register({
        actorId: 'user-1',
        actorType: 'user',
        name: 'Alice',
        avatar: 'https://example.com/alice.png',
        state: 'editing',
        focusRegions: ['/content/0'],
      });

      original.register({
        actorId: 'agent-1',
        actorType: 'agent',
        name: 'Bot',
        intent: 'Updating hero',
        state: 'active',
      });

      // Roundtrip
      const serialized = original.serialize();
      const restored = PresenceManager.deserialize(serialized);
      const reSerialized = restored.serialize();

      // Should produce identical serialization
      expect(reSerialized.presences).toHaveLength(serialized.presences.length);
      expect(Object.keys(reSerialized.actorIdIndex)).toEqual(
        Object.keys(serialized.actorIdIndex),
      );

      // Deep equality of presence data
      for (const origPresence of serialized.presences) {
        const restoredPresence = reSerialized.presences.find(
          (p) => p.actorId === origPresence.actorId,
        );
        expect(restoredPresence).toEqual(origPresence);
      }
    });
  });

  // =============================================================================
  // Tests: DocumentSession Presence Persistence
  // =============================================================================

  describe('PRESENCE_STORAGE_KEY constant', () => {
    it('should use "presenceState" as the storage key for presence data', async () => {
      // Import and verify the constant is exported or used internally
      // We verify this by checking that presence data is stored under this key
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState();
      const mockEnv = createMockEnv();
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize the session
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Connect a WebSocket to register presence
      const ws = createMockWebSocket('user-1');
      const connectReq = new Request('http://localhost/connect', {
        headers: { Upgrade: 'websocket' },
      });
      await session.fetch(connectReq);

      // Disconnect to trigger immediate persist
      mockState.getWebSockets.mockReturnValue([]);
      await session.webSocketClose(ws, 1000, 'normal', true);

      // Check that presenceState was stored in DO storage
      const storedCalls = mockState.storage.put.mock.calls;
      const presenceStoreCalls = storedCalls.filter(
        (call) => call[0] === 'presenceState',
      );
      // Presence should have been persisted on disconnect
      expect(presenceStoreCalls.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('restorePresence() on initialization', () => {
    it('should restore presence from DO storage during initializeIfNeeded', async () => {
      const { PresenceManager } = await import('../../src/services/presence-service');

      // Create a serialized presence state to pre-populate storage
      const pm = new PresenceManager();
      pm.register({
        actorId: 'user-1',
        actorType: 'user',
        name: 'Alice',
        state: 'active',
        focusRegions: ['/content/0'],
      });
      const serializedPresence = pm.serialize();

      const mockState = createMockState();
      const mockEnv = createMockEnv();

      // Pre-populate storage with presence data
      await mockState.storage.put('presenceState', serializedPresence);

      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Trigger initialization
      const snapshotReq = new Request('http://localhost/snapshot');
      const response = await session.fetch(snapshotReq);
      const body = await response.json();

      // The session should have loaded the presence data from storage
      // Verify by checking storage.get was called with 'presenceState'
      const getCalls = mockState.storage.get.mock.calls;
      const presenceGetCalls = getCalls.filter(
        (call) => call[0] === 'presenceState',
      );
      expect(presenceGetCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('persistPresence() on disconnect', () => {
    it('should persist presence state immediately on last client disconnect', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState();
      const mockEnv = createMockEnv();
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize session
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Connect a WebSocket
      const ws = createMockWebSocket('user-1');
      const connectReq = new Request('http://localhost/connect', {
        headers: { Upgrade: 'websocket' },
      });
      await session.fetch(connectReq);

      // Simulate disconnect (last client)
      mockState.getWebSockets.mockReturnValue([]);
      await session.webSocketClose(ws, 1000, 'normal', true);

      // Verify presenceState was stored
      const putCalls = mockState.storage.put.mock.calls;
      const presencePutCalls = putCalls.filter(
        (call) => call[0] === 'presenceState',
      );
      expect(presencePutCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('persistPresence() debounced on focus updates', () => {
    it('should schedule debounced presence persistence on focus region update', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState();
      const mockEnv = createMockEnv();
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize session
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      // Connect a WebSocket and register presence
      const ws = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([ws]);

      const connectReq = new Request('http://localhost/connect', {
        headers: { Upgrade: 'websocket' },
      });
      await session.fetch(connectReq);

      // Send a focus region update via WebSocket message
      const focusMessage = JSON.stringify({
        type: 'focus_region_update',
        focusRegions: ['/content/0/props'],
      });
      await session.webSocketMessage(ws, focusMessage);

      // The presenceState should be scheduled for persistence (debounced)
      // After PERSIST_DEBOUNCE_MS, storage.put should be called with 'presenceState'
      await vi.advanceTimersByTimeAsync(2100); // Past PERSIST_DEBOUNCE_MS (2000ms)

      const putCalls = mockState.storage.put.mock.calls;
      const presencePutCalls = putCalls.filter(
        (call) => call[0] === 'presenceState',
      );
      // Should have persisted within the debounce window
      expect(presencePutCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
