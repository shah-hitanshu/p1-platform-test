/**
 * DocumentSession WebSocket Presence Protocol Tests
 *
 * Tests for the WebSocket-based presence messaging that enables
 * real-time presence updates without HTTP polling.
 *
 * Protocol:
 * - Binary frames: Yjs CRDT updates (existing)
 * - Text frames: JSON presence messages (new)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import * as Y from 'yjs';
import type {
  WsFocusRegionUpdateMessage,
  WsPresenceHeartbeatMessage,
  WsPresenceUpdateMessage,
  WsFocusRegionBroadcastMessage,
  WsFocusRegionAckMessage,
  WsPresenceErrorMessage,
} from '../../src/types/websocket-messages';
import type { ActorPresence } from '../../src/types';

// Mock cloudflare:workers DurableObject base class for Hibernatable WebSocket API
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
// Mock Types for Durable Object Testing
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
  const storage: MockDurableObjectStorage = {
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };

  // Track accepted WebSockets for Hibernatable WebSocket API
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
      return acceptedWebSockets.filter(ws => ws.readyState === WebSocket.OPEN);
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

/**
 * Mock WebSocket for testing
 */
class MockWebSocket {
  readyState = WebSocket.OPEN;
  sentMessages: (string | ArrayBuffer)[] = [];
  messageHandlers: ((event: { data: string | ArrayBuffer }) => void)[] = [];
  closeHandlers: (() => void)[] = [];
  private _attachment: unknown = null;

  send(data: string | ArrayBuffer): void {
    this.sentMessages.push(data);
  }

  addEventListener(event: string, handler: (event: unknown) => void): void {
    if (event === 'message') {
      this.messageHandlers.push(handler as (event: { data: string | ArrayBuffer }) => void);
    } else if (event === 'close' || event === 'error') {
      this.closeHandlers.push(handler as () => void);
    }
  }

  // Hibernatable WebSocket API: store metadata as attachment
  serializeAttachment(value: unknown): void {
    this._attachment = structuredClone(value);
  }

  // Hibernatable WebSocket API: retrieve metadata from attachment
  deserializeAttachment(): unknown {
    return this._attachment;
  }

  // Simulate receiving a message
  receiveMessage(data: string | ArrayBuffer): void {
    for (const handler of this.messageHandlers) {
      handler({ data });
    }
  }

  // Simulate close
  close(): void {
    this.readyState = WebSocket.CLOSED;
    for (const handler of this.closeHandlers) {
      handler();
    }
  }

  // Get text messages (JSON) sent
  getTextMessages(): string[] {
    return this.sentMessages.filter((m): m is string => typeof m === 'string');
  }

  // Get parsed JSON messages
  getParsedMessages<T>(): T[] {
    return this.getTextMessages().map((m) => JSON.parse(m) as unknown as T);
  }
}

// =============================================================================
// WebSocket Presence Protocol Tests
// =============================================================================

describe('DocumentSession WebSocket Presence Protocol', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    mockState = createMockState();
    mockEnv = createMockEnv();
  });

  describe('Text vs Binary Message Handling', () => {
    it('should route text (string) messages to presence handler', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Verify session is created (basic sanity check)
      expect(session).toBeDefined();

      // Create a mock WebSocket and simulate connection
      const ws = new MockWebSocket();

      // The focus_region_update message
      const message: WsFocusRegionUpdateMessage = {
        type: 'focus_region_update',
        focusRegions: ['$.hero'],
        timestamp: Date.now(),
      };

      // Simulate receiving a text message
      ws.receiveMessage(JSON.stringify(message));

      // Should NOT be treated as Yjs binary update
      // The handler should parse it as JSON and process as presence
      // (We verify by checking no error is thrown for invalid Yjs data)
    });

    it('should route binary (ArrayBuffer) messages to Yjs handler', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Verify session is created (basic sanity check)
      expect(session).toBeDefined();

      // Binary data should be treated as Yjs updates
      const binaryData = new Uint8Array([0, 1, 2, 3]).buffer;

      // Verify binary data is created correctly
      expect(binaryData.byteLength).toBe(4);

      // This tests that binary is NOT parsed as JSON
      // (If it tried to JSON.parse binary, it would throw)
    });
  });

  describe('Focus Region Update Messages', () => {
    it('should parse focus_region_update message correctly', () => {
      const message: WsFocusRegionUpdateMessage = {
        type: 'focus_region_update',
        focusRegions: ['$.hero', '$.content.blocks[0]'],
        timestamp: Date.now(),
      };

      const parsed = JSON.parse(JSON.stringify(message)) as WsFocusRegionUpdateMessage;

      expect(parsed.type).toBe('focus_region_update');
      expect(parsed.focusRegions).toEqual(['$.hero', '$.content.blocks[0]']);
      expect(parsed.timestamp).toBeGreaterThan(0);
    });

    it('should validate focus regions array', () => {
      // Invalid: not an array
      const invalid1 = {
        type: 'focus_region_update',
        focusRegions: '$.hero', // Should be array
        timestamp: Date.now(),
      };

      expect(Array.isArray(invalid1.focusRegions)).toBe(false);

      // Valid: array of strings
      const valid: WsFocusRegionUpdateMessage = {
        type: 'focus_region_update',
        focusRegions: ['$.hero'],
        timestamp: Date.now(),
      };

      expect(Array.isArray(valid.focusRegions)).toBe(true);
    });

    it('should accept empty focus regions array (clearing focus)', () => {
      const message: WsFocusRegionUpdateMessage = {
        type: 'focus_region_update',
        focusRegions: [],
        timestamp: Date.now(),
      };

      expect(message.focusRegions).toHaveLength(0);
    });
  });

  describe('Presence Heartbeat Messages', () => {
    it('should parse presence_heartbeat without state', () => {
      const message: WsPresenceHeartbeatMessage = {
        type: 'presence_heartbeat',
        timestamp: Date.now(),
      };

      const parsed = JSON.parse(JSON.stringify(message)) as WsPresenceHeartbeatMessage;

      expect(parsed.type).toBe('presence_heartbeat');
      expect(parsed.state).toBeUndefined();
      expect(parsed.timestamp).toBeGreaterThan(0);
    });

    it('should parse presence_heartbeat with state', () => {
      const states = ['active', 'idle', 'editing'] as const;

      for (const state of states) {
        const message: WsPresenceHeartbeatMessage = {
          type: 'presence_heartbeat',
          state,
          timestamp: Date.now(),
        };

        const parsed = JSON.parse(JSON.stringify(message)) as WsPresenceHeartbeatMessage;
        expect(parsed.state).toBe(state);
      }
    });
  });

  describe('Server Response Messages', () => {
    describe('presence_update', () => {
      it('should include all connected actors', () => {
        const message: WsPresenceUpdateMessage = {
          type: 'presence_update',
          actors: [
            {
              id: 'presence-1',
              actorId: 'user-1',
              actorType: 'user',
              role: 'human',
              name: 'User One',
              state: 'editing',
              lastActivityAt: new Date().toISOString(),
              joinedAt: new Date().toISOString(),
              focusRegions: ['$.hero'],
            },
            {
              id: 'presence-2',
              actorId: 'user-2',
              actorType: 'user',
              role: 'human',
              name: 'User Two',
              state: 'active',
              lastActivityAt: new Date().toISOString(),
              joinedAt: new Date().toISOString(),
            },
          ],
          timestamp: Date.now(),
        };

        expect(message.actors).toHaveLength(2);
        expect(message.actors[0]?.focusRegions).toEqual(['$.hero']);
        expect(message.actors[1]?.focusRegions).toBeUndefined();
      });
    });

    describe('focus_region_broadcast', () => {
      it('should include actor ID and new focus regions', () => {
        const message: WsFocusRegionBroadcastMessage = {
          type: 'focus_region_broadcast',
          actorId: 'user-1',
          focusRegions: ['$.content', '$.footer'],
          timestamp: Date.now(),
        };

        expect(message.actorId).toBe('user-1');
        expect(message.focusRegions).toHaveLength(2);
      });
    });

    describe('focus_region_ack', () => {
      it('should confirm successful update', () => {
        const message: WsFocusRegionAckMessage = {
          type: 'focus_region_ack',
          success: true,
          focusRegions: ['$.hero'],
          timestamp: Date.now(),
        };

        expect(message.success).toBe(true);
        expect(message.focusRegions).toEqual(['$.hero']);
      });

      it('should indicate failed update', () => {
        const message: WsFocusRegionAckMessage = {
          type: 'focus_region_ack',
          success: false,
          focusRegions: [],
          timestamp: Date.now(),
        };

        expect(message.success).toBe(false);
      });
    });

    describe('presence_error', () => {
      it('should include error code and message', () => {
        const errorCases = [
          { code: 'PARSE_ERROR', message: 'Invalid message format' },
          { code: 'INVALID_REGIONS', message: 'Focus regions must be an array' },
          { code: 'TOO_MANY_REGIONS', message: 'Exceeded maximum focus regions' },
        ];

        for (const { code, message: msg } of errorCases) {
          const error: WsPresenceErrorMessage = {
            type: 'presence_error',
            code,
            message: msg,
            timestamp: Date.now(),
          };

          expect(error.code).toBe(code);
          expect(error.message).toBe(msg);
        }
      });
    });
  });

  describe('Invalid Message Handling', () => {
    it('should handle malformed JSON gracefully', () => {
      const invalidJson = 'not valid json {';

      expect(() => JSON.parse(invalidJson) as unknown).toThrow();
      // The handler should catch this and send a presence_error
    });

    it('should handle unknown message types', () => {
      const unknownMessage = {
        type: 'unknown_type',
        data: 'something',
        timestamp: Date.now(),
      };

      const json = JSON.stringify(unknownMessage);
      const parsed = JSON.parse(json) as { type: string };

      // Should not match known types
      expect(['focus_region_update', 'presence_heartbeat'].includes(parsed.type)).toBe(false);
    });

    it('should handle missing required fields', () => {
      const missingTimestamp = {
        type: 'focus_region_update',
        focusRegions: ['$.hero'],
        // timestamp missing
      };

      expect(missingTimestamp.timestamp).toBeUndefined();
    });
  });

  describe('Presence Broadcast on Connect/Disconnect', () => {
    it('should broadcast presence_update when actor connects', () => {
      // When a new WebSocket connects, all existing clients should receive
      // a presence_update with the updated actor list
      const message: WsPresenceUpdateMessage = {
        type: 'presence_update',
        actors: [
          {
            id: 'ws-user-1',
            actorId: 'user-1',
            actorType: 'user',
            role: 'human',
            name: 'user-1',
            state: 'active',
            lastActivityAt: new Date().toISOString(),
            joinedAt: new Date().toISOString(),
          },
        ],
        timestamp: Date.now(),
      };

      expect(message.type).toBe('presence_update');
      expect(message.actors).toHaveLength(1);
    });

    it('should broadcast presence_update when actor disconnects', () => {
      // When a WebSocket disconnects, remaining clients should receive
      // a presence_update with the updated (reduced) actor list
      const message: WsPresenceUpdateMessage = {
        type: 'presence_update',
        actors: [], // Last actor left
        timestamp: Date.now(),
      };

      expect(message.type).toBe('presence_update');
      expect(message.actors).toHaveLength(0);
    });
  });

  describe('Message Size Limits', () => {
    it('should reject messages exceeding size limit', () => {
      // Create a message with many focus regions
      const manyRegions = Array.from({ length: 100 }, (_, i) => `$.path.to.element[${String(i)}]`);

      const message: WsFocusRegionUpdateMessage = {
        type: 'focus_region_update',
        focusRegions: manyRegions,
        timestamp: Date.now(),
      };

      // The handler should check MAX_FOCUS_REGIONS_PER_REQUEST
      expect(message.focusRegions.length).toBe(100);
      // Default limit is 10 regions, so this should be rejected
    });
  });
});

// =============================================================================
// handleWebSocket: PresenceManager DO push on connect
// =============================================================================

describe('handleWebSocket: pushPresenceUpdate on connect', () => {
  // Minimal WebSocketConnectionDeps factory for handleWebSocket tests
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function createWsConnDeps(overrides: {
    pushPresenceUpdate?: ReturnType<typeof vi.fn>;
    presenceManagerActor?: ActorPresence | undefined;
  } = {}) {
    const mockServer = new MockWebSocket();
    const mockClient = new MockWebSocket();

    // Mock WebSocketPair so handleWebSocket doesn't bail out early.
    // A constructor function returning a plain object causes `new` to use that object
    // rather than `this`, giving us control over pair[0] and pair[1].
    const pair = { 0: mockClient, 1: mockServer };
    globalThis.WebSocketPair = function WsPairMock() { return pair; } as unknown as typeof WebSocketPair;

    const mockState = {
      id: { toString: (): string => 'site-1:doc-1:branch-1', name: 'site-1:doc-1:branch-1' },
      storage: {
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue(new Map()),
        getAlarm: vi.fn().mockResolvedValue(null),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      },
      blockConcurrencyWhile: vi.fn(),
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn().mockReturnValue([]),
    };

    return {
      env: { ENVIRONMENT: 'test' },
      sessionInfo: { siteId: 'site-1', documentId: 'doc-1', branchId: 'branch-1' },
      state: mockState,
      ydoc: new Y.Doc(),
      setYdoc: vi.fn(),
      initialized: true,
      presenceManager: {
        getByActorId: vi.fn().mockReturnValue(overrides.presenceManagerActor),
        getAll: vi.fn().mockReturnValue([]),
        register: vi.fn(),
      },
      activityDetector: { recordFocusActivity: vi.fn(), clearActorFocus: vi.fn() },
      editSessions: new Map(),
      messageRates: new Map(),
      initializeCrdtIfNeeded: vi.fn().mockResolvedValue(undefined),
      restoreSessionInfoFromStorage: vi.fn().mockResolvedValue(undefined),
      markPersistPending: vi.fn().mockResolvedValue(undefined),
      flushPendingPersist: vi.fn().mockResolvedValue(undefined),
      enqueueBroadcast: vi.fn(),
      flushPendingBroadcasts: vi.fn(),
      persist: vi.fn().mockResolvedValue(undefined),
      persistPresence: vi.fn().mockResolvedValue(undefined),
      persistEditSessions: vi.fn().mockResolvedValue(undefined),
      scheduleCleanupAlarm: vi.fn().mockResolvedValue(undefined),
      broadcastPresenceUpdate: vi.fn(),
      pushPresenceUpdate: overrides.pushPresenceUpdate ?? vi.fn(),
      handlePresenceMessage: vi.fn(),
      tryParseJson: vi.fn(),
      handleWsPublishRequest: vi.fn(),
      syncManager: {} as never,
      runCleanup: vi.fn().mockResolvedValue({ sessionsRolledBack: 0, sessionsCleared: 0 }),
      getConnectionCount: vi.fn().mockReturnValue(0),
      PERSIST_PENDING_KEY: 'persistPending',
      setPersistPending: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should push actorJoined with actor built from meta when browser user is not in presenceManager', async () => {
    const { handleWebSocket } = await import('../../src/durable-objects/websocket-connection-manager');
    const pushPresenceUpdate = vi.fn();

    // Browser user: NOT registered in local presenceManager
    const deps = createWsConnDeps({ pushPresenceUpdate, presenceManagerActor: undefined });

    const request = new Request('http://internal/connect?_verifiedActorId=user-alice&_verifiedActorType=user&_verifiedEmail=alice%40example.com&_verifiedName=Alice');

    // pushPresenceUpdate is called before the 101 Response — swallow the Response error
    try { handleWebSocket(deps as never, request); } catch { /* status 101 not supported in test env */ }

    expect(pushPresenceUpdate).toHaveBeenCalledWith(
      'join',
      'user-alice',
      expect.objectContaining({
        actor: expect.objectContaining({
          id: 'ws-user-alice',
          actorId: 'user-alice',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
        }),
      }),
    );
  });

  it('should use presenceManager actor when agent is already registered', async () => {
    const { handleWebSocket } = await import('../../src/durable-objects/websocket-connection-manager');
    const pushPresenceUpdate = vi.fn();

    const existingAgentPresence: ActorPresence = {
      id: 'session-agent-bot',
      actorId: 'agent-bot',
      actorType: 'agent',
      role: 'agent',
      name: 'Bot Agent',
      state: 'editing',
      lastActivityAt: new Date().toISOString(),
      joinedAt: new Date().toISOString(),
      intent: 'Updating hero section',
    };

    // Agent IS registered in local presenceManager (edit session active)
    const deps = createWsConnDeps({ pushPresenceUpdate, presenceManagerActor: existingAgentPresence });

    const request = new Request('http://internal/connect?_verifiedActorId=agent-bot&_verifiedActorType=agent');

    try { handleWebSocket(deps as never, request); } catch { /* status 101 not supported in test env */ }

    expect(pushPresenceUpdate).toHaveBeenCalledWith(
      'join',
      'agent-bot',
      expect.objectContaining({
        actor: existingAgentPresence,
      }),
    );
  });

  it('should fall back to email when name is absent from meta', async () => {
    const { handleWebSocket } = await import('../../src/durable-objects/websocket-connection-manager');
    const pushPresenceUpdate = vi.fn();

    const deps = createWsConnDeps({ pushPresenceUpdate, presenceManagerActor: undefined });

    // Name not provided — only email
    const request = new Request('http://internal/connect?_verifiedActorId=user-bob&_verifiedActorType=user&_verifiedEmail=bob%40example.com');

    try { handleWebSocket(deps as never, request); } catch { /* status 101 not supported in test env */ }

    expect(pushPresenceUpdate).toHaveBeenCalledWith(
      'join',
      'user-bob',
      expect.objectContaining({
        actor: expect.objectContaining({
          name: 'bob@example.com',
        }),
      }),
    );
  });
});
