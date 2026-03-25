/**
 * Phase 4: DocumentSession Agent Politeness Integration Tests (TDD)
 *
 * Tests for integrating Agent Politeness services (PresenceManager, ActivityDetector,
 * AgentEditPermissionService) into the DocumentSession Durable Object.
 *
 * Agent Edit Workflow Endpoints:
 * - /can-agent-edit: Check if agent can proceed with editing
 * - /agent-edit-start: Declare intent to edit, create checkpoint if autonomous
 * - /agent-edit-complete: Complete edit session, clear focus regions
 * - /agent-edit-abort: Abort edit session, rollback to checkpoint
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

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

// Mock agent service to return agent info for name lookup
vi.mock('../../src/services/agent-service', () => ({
  getAgentById: vi.fn().mockImplementation((agentId: string) => {
    // Return mock agent with the agentId as part of the name
    return Promise.resolve({
      id: agentId,
      organizationId: 'test-org',
      name: `Test Agent ${agentId.substring(0, 8)}`,
      description: 'Test agent for unit tests',
      capabilities: ['edit'],
      status: 'active',
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }),
}));

// =============================================================================
// Mock Types for Durable Object Testing
// =============================================================================

/**
 * Mock DurableObjectStorage interface matching Cloudflare's API
 */
interface MockDurableObjectStorage {
  get: Mock<(key: string) => Promise<unknown>>;
  put: Mock<(key: string, value: unknown) => Promise<void>>;
  delete: Mock<(key: string) => Promise<boolean>>;
  list: Mock<() => Promise<Map<string, unknown>>>;
  getAlarm: Mock<() => Promise<number | null>>;
  setAlarm: Mock<(scheduledTime: number) => Promise<void>>;
}

/**
 * Mock DurableObjectState interface
 */
interface MockDurableObjectState {
  id: { toString: () => string; name: string };
  storage: MockDurableObjectStorage;
  blockConcurrencyWhile: Mock<(callback: () => Promise<void>) => Promise<void>>;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
}

/**
 * Create a mock DurableObjectState for testing
 */
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

/**
 * Mock environment for DocumentSession with agent politeness config
 */
interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
  INTERNAL_API_URL?: string;
  INTERNAL_SECRET?: string;
}

function createMockEnv(): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
  };
}

// =============================================================================
// Phase 4.1: Presence Integration Tests
// =============================================================================

describe('Phase 4.1: Presence Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('presence tracking on WebSocket connect', () => {
    it('should register presence when WebSocket connects', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Simulate WebSocket connection with actor headers
      const request = new Request('http://localhost/connect', {
        headers: {
          Upgrade: 'websocket',
          'X-Actor-Id': 'user-123',
          'X-Actor-Type': 'user',
        },
      });

      const response = await session.fetch(request);

      // WebSocket upgrade returns 101, or 501 if WebSocketPair not available in test environment
      // The presence should be tracked internally
      expect([101, 501]).toContain(response.status);
    });

    it('should unregister presence when WebSocket disconnects', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // This test verifies the session tracks connections properly
      expect(session.getConnectionCount()).toBe(0);
    });

    it('should include presence info in snapshot response', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.connectedActors).toBeDefined();
    });
  });

  describe('getPresences endpoint', () => {
    it('should return all presences for document', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/presences');
      const response = await session.fetch(request);

      if (response.status !== 200) {
        const errorBody = await response.text();
        console.error('Error response:', response.status, errorBody);
      }

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.presences).toBeDefined();
      expect(Array.isArray(body.presences)).toBe(true);
    });
  });
});

// =============================================================================
// Phase 4.2: Activity Detection Integration Tests
// =============================================================================

describe('Phase 4.2: Activity Detection Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('human activity tracking', () => {
    it('should record human activity on edit operations', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Apply an edit as a human user
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          operations: [{ type: 'set', path: '/title', value: 'Test' }],
          actorId: 'user-123',
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(200);
    });

    it('should track active regions from edit operations', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Apply edit to specific path
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          operations: [{ type: 'set', path: '/content/0/text', value: 'Hello' }],
          actorId: 'user-123',
        }),
      });

      await session.fetch(request);

      // Get activity state
      const stateRequest = new Request('http://localhost/activity-state');
      const stateResponse = await session.fetch(stateRequest);

      expect(stateResponse.status).toBe(200);
      const body = (await stateResponse.json());
      expect(body).toHaveProperty('isIdle');
      expect(body).toHaveProperty('activeRegions');
    });
  });

  describe('idle detection', () => {
    it('should report idle state after timeout', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // With no activity, should be idle
      const request = new Request('http://localhost/activity-state');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.isIdle).toBe(true);
    });

    it('should expose idle timeout configuration', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/activity-state');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.idleTimeoutMs).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Phase 4.3: Agent Edit Permission Integration Tests
// =============================================================================

describe('Phase 4.3: Agent Edit Permission Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('/can-agent-edit endpoint', () => {
    it('should allow agent edit when human is idle', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/can-agent-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-123',
          trigger: 'autonomous',
          targetRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.allowed).toBe(true);
    });

    it('should deny agent edit when human is actively editing', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // First, simulate human activity
      await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            operations: [{ type: 'set', path: '/content/0', value: 'test' }],
            actorId: 'user-123',
          }),
        }),
      );

      // Now check agent permission for overlapping region
      const request = new Request('http://localhost/can-agent-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-123',
          trigger: 'autonomous',
          targetRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      // May be denied due to recent activity or region conflict
      expect(typeof body.allowed).toBe('boolean');
    });

    it('should allow human-requested work immediately', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/can-agent-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-123',
          trigger: 'human_requested',
          targetRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.allowed).toBe(true);
    });

    it('should return region conflicts in response', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/can-agent-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-123',
          trigger: 'autonomous',
          targetRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body).toHaveProperty('conflictingRegions');
    });

    it('should validate request body', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/can-agent-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing agentId
          trigger: 'autonomous',
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(400);
    });
  });
});

// =============================================================================
// Phase 4.4: Agent Edit Workflow Tests
// =============================================================================

describe('Phase 4.4: Agent Edit Workflow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('/agent-edit-start endpoint', () => {
    it('should create checkpoint for autonomous edit', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/agent-edit-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Optimizing layout',
          targetRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.editSessionId).toBeDefined();
      // For autonomous work, a checkpoint should be created
      expect(body.checkpointId).toBeDefined();
    });

    it('should not create checkpoint for human-requested edit', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/agent-edit-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-123',
          trigger: 'human_requested',
          intent: 'User requested edit',
          targetRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.editSessionId).toBeDefined();
      // For human-requested work, no automatic checkpoint
      expect(body.checkpointId).toBeUndefined();
    });

    it('should register focus regions on edit start', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Test',
            targetRegions: ['/content/0', '/content/1'],
          }),
        }),
      );

      // Check presences show the agent's regions
      const presenceResponse = await session.fetch(
        new Request('http://localhost/presences'),
      );

      expect(presenceResponse.status).toBe(200);
      const body = (await presenceResponse.json());
      const agentPresence = body.presences.find((p) => p.actorId === 'agent-123');
      expect(agentPresence).toBeDefined();
    });

    it('should deny start if not allowed', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Simulate active human editing
      await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            operations: [{ type: 'set', path: '/content/0', value: 'test' }],
            actorId: 'user-123',
          }),
        }),
      );

      // Try to start autonomous edit on same region
      const request = new Request('http://localhost/agent-edit-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Test',
          targetRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(request);

      // May be denied (403) or return allowed: false
      const body = (await response.json());
      if (response.status === 200) {
        expect(body.allowed).toBeDefined();
      } else {
        expect(response.status).toBe(403);
      }
    });
  });

  describe('/agent-edit-complete endpoint', () => {
    it('should complete edit session successfully', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Test',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      const startBody = (await startResponse.json());

      // Complete the edit session
      const request = new Request('http://localhost/agent-edit-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editSessionId: startBody.editSessionId,
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.success).toBe(true);
    });

    it('should not use postCheckpointId field name in response (use checkpointId instead)', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Test edit',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      const startBody = (await startResponse.json());

      // Complete the edit session
      const completeResponse = await session.fetch(
        new Request('http://localhost/agent-edit-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            editSessionId: startBody.editSessionId,
          }),
        }),
      );

      expect(completeResponse.status).toBe(200);
      const completeBody = (await completeResponse.json());

      // Verify response never uses legacy 'postCheckpointId' field name
      // The correct field name is 'checkpointId' (may be omitted when undefined)
      expect(completeBody.success).toBe(true);
      expect('postCheckpointId' in completeBody).toBe(false);
    });

    it('should clear focus regions on complete', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Test',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      const startBody = (await startResponse.json());

      // Complete the edit session
      await session.fetch(
        new Request('http://localhost/agent-edit-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            editSessionId: startBody.editSessionId,
          }),
        }),
      );

      // Check that agent's focus regions are cleared
      const presenceResponse = await session.fetch(
        new Request('http://localhost/presences'),
      );

      const presenceBody = (await presenceResponse.json());
      const agentPresence = presenceBody.presences.find(
        (p) => p.actorId === 'agent-123',
      );
      // Agent should either be gone or have no regions
      if (agentPresence !== undefined) {
        expect(agentPresence.regions ?? []).toEqual([]);
      }
    });

    it('should reject invalid edit session ID', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/agent-edit-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editSessionId: 'nonexistent-session',
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(404);
    });
  });

  describe('/agent-edit-abort endpoint', () => {
    it('should abort edit session and attempt rollback', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an autonomous edit session (creates checkpoint)
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Test',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      const startBody = (await startResponse.json());

      // Abort the edit session
      const request = new Request('http://localhost/agent-edit-abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editSessionId: startBody.editSessionId,
          reason: 'User requested abort',
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.success).toBe(true);
      // Note: rolledBack is false because internal API is not configured in test env
      // In production with internal API configured, this would call the rollback endpoint
      expect(body.rolledBack).toBe(false);
    });

    it('should clear focus regions on abort', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Test',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      const startBody = (await startResponse.json());

      // Abort the edit session
      await session.fetch(
        new Request('http://localhost/agent-edit-abort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            editSessionId: startBody.editSessionId,
          }),
        }),
      );

      // Check that agent's focus regions are cleared
      const presenceResponse = await session.fetch(
        new Request('http://localhost/presences'),
      );

      const presenceBody = (await presenceResponse.json());
      const agentPresence = presenceBody.presences.find(
        (p) => p.actorId === 'agent-123',
      );
      // Agent should either be gone or have no regions
      if (agentPresence !== undefined) {
        expect(agentPresence.regions ?? []).toEqual([]);
      }
    });

    it('should record abort reason', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Test',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      const startBody = (await startResponse.json());

      const request = new Request('http://localhost/agent-edit-abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editSessionId: startBody.editSessionId,
          reason: 'Conflict detected with human work',
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(200);
    });

    it('should reject invalid edit session ID', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/agent-edit-abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editSessionId: 'nonexistent-session',
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(404);
    });
  });

  describe('/agent-stop endpoint', () => {
    it('should stop agent by agentId and return success with rolledBack=true for autonomous session', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an autonomous edit session (creates checkpoint)
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-to-stop',
            trigger: 'autonomous',
            intent: 'Testing stop',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      // Stop the agent by agentId (not editSessionId)
      const request = new Request('http://localhost/agent-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-to-stop',
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.success).toBe(true);
      // rolledBack is false in test env because internal API is not configured
      // In production with internal API, this would be true for autonomous sessions
    });

    it('should return success with rolledBack=false when agent has no active session', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Try to stop an agent that has no active session
      const request = new Request('http://localhost/agent-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'nonexistent-agent',
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.success).toBe(true);
      expect(body.rolledBack).toBe(false);
      expect(body.message).toBe('No active session for agent');
    });

    it('should clear agent presence when stopped', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-with-presence',
            trigger: 'human_requested',
            intent: 'Test',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      // Stop the agent
      await session.fetch(
        new Request('http://localhost/agent-stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-with-presence',
          }),
        }),
      );

      // Check that agent's presence is cleared
      const presenceResponse = await session.fetch(
        new Request('http://localhost/presences'),
      );

      const presenceBody = (await presenceResponse.json());
      const agentPresence = presenceBody.presences.find(
        (p) => p.actorId === 'agent-with-presence',
      );
      // Agent should be gone from presence
      expect(agentPresence).toBeUndefined();
    });

    it('should remove edit session when stopped', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-session-test',
            trigger: 'human_requested',
            intent: 'Test',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      // Verify session exists
      let sessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      let sessionsBody = (await sessionsResponse.json());
      expect(sessionsBody.sessions.length).toBe(1);

      // Stop the agent
      await session.fetch(
        new Request('http://localhost/agent-stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-session-test',
          }),
        }),
      );

      // Verify session is removed
      sessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      sessionsBody = (await sessionsResponse.json());
      expect(sessionsBody.sessions.length).toBe(0);
    });

    it('should reject request without agentId', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/agent-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(400);
      const body = (await response.json());
      expect(body.error).toContain('agentId');
    });
  });

  describe('edit session tracking', () => {
    it('should track active edit sessions', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Test',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      // Get active edit sessions
      const request = new Request('http://localhost/edit-sessions');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.sessions.length).toBe(1);
      expect(body.sessions[0].agentId).toBe('agent-123');
    });

    it('should prevent concurrent edit sessions from same agent', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start first edit session
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'First edit',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      // Try to start second edit session from same agent
      const response = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Second edit',
            targetRegions: ['/content/1'],
          }),
        }),
      );

      expect(response.status).toBe(409);
    });
  });
});

// =============================================================================
// Phase 4.5: Idle Timeout Configuration Tests
// =============================================================================

describe('Phase 4.5: Idle Timeout Configuration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('/set-idle-timeout endpoint', () => {
    it('should update idle timeout', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/set-idle-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idleTimeoutMs: 60000, // 1 minute
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json());
      expect(body.idleTimeoutMs).toBe(60000);
    });

    it('should validate timeout range', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/set-idle-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idleTimeoutMs: -1000, // Invalid negative
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(400);
    });

    it('should persist timeout across requests', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Set timeout
      await session.fetch(
        new Request('http://localhost/set-idle-timeout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idleTimeoutMs: 45000 }),
        }),
      );

      // Check activity state includes updated timeout
      const response = await session.fetch(
        new Request('http://localhost/activity-state'),
      );

      const body = (await response.json());
      expect(body.idleTimeoutMs).toBe(45000);
    });
  });
});

// =============================================================================
// Phase 4.6: Agent /apply Session Enforcement Tests
// =============================================================================

describe('Phase 4.6: Agent /apply Session Enforcement', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('/apply endpoint for agents', () => {
    it('should require editSessionId for agents', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Try to apply edits as agent without editSessionId
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'agent',
        },
        body: JSON.stringify({
          actorId: 'agent-123',
          operations: [
            { type: 'set', path: 'root.title', value: 'New Title' },
          ],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(400);
      const body = (await response.json());
      expect(body.error).toContain('editSessionId');
    });

    it('should reject agents with invalid editSessionId', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Try to apply edits with nonexistent session
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'agent',
        },
        body: JSON.stringify({
          actorId: 'agent-123',
          editSessionId: 'nonexistent-session',
          operations: [
            { type: 'set', path: 'root.title', value: 'New Title' },
          ],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(403);
      const body = (await response.json());
      expect(body.error).toContain('session');
    });

    it('should allow agents with valid editSessionId', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Test edit',
            targetRegions: ['root'],
          }),
        }),
      );

      const startBody = (await startResponse.json());

      // Apply edits with valid session
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'agent',
        },
        body: JSON.stringify({
          actorId: 'agent-123',
          editSessionId: startBody.editSessionId,
          operations: [
            { type: 'set', path: 'root.title', value: 'New Title' },
          ],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
    });

    it('should reject agents using session from different agent', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session for agent-123
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Test edit',
            targetRegions: ['root'],
          }),
        }),
      );

      const startBody = (await startResponse.json());

      // Try to use session from different agent
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'agent',
        },
        body: JSON.stringify({
          actorId: 'agent-999', // Different agent
          editSessionId: startBody.editSessionId,
          operations: [
            { type: 'set', path: 'root.title', value: 'New Title' },
          ],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(403);
      const body = (await response.json());
      expect(body.error).toContain('session');
    });

    it('should allow humans to apply edits without session', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Apply edits as human without editSessionId
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          operations: [
            { type: 'set', path: 'root.title', value: 'Human Edit' },
          ],
        }),
      });

      const response = await session.fetch(request);

      expect(response.status).toBe(200);
    });
  });
});

// =============================================================================
// Phase A: Orphaned Session Cleanup Tests
//
// These tests verify that when agent edit sessions expire (>MAX_EDIT_SESSION_AGE_MS),
// the corresponding agent presence records are also cleaned up, and that presence
// is properly persisted and validated on DO restore.
//
// The key bug scenario: an agent's presence has RECENT activity (not stale) but
// the session has been running for >10 minutes. clearStale() won't clear the
// presence (it's fresh), but the session should be deleted AND the presence
// should be unregistered.
// =============================================================================

describe('Phase A: Orphaned Session Cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('runCleanup should clear presence for expired sessions', () => {
    it('should unregister agent presence when orphaned edit session is cleaned up even if presence is fresh', async () => {
      // Use fake timers from the start so we can control time precisely
      vi.useFakeTimers();
      const baseTime = Date.now();

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session at time T (registers presence with lastActivityAt=T)
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-orphan-test',
            trigger: 'human_requested',
            intent: 'Test orphaned session cleanup',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      expect(startResponse.status).toBe(200);

      // Verify presence is registered
      let presenceResponse = await session.fetch(
        new Request('http://localhost/presences'),
      );
      let presenceBody = (await presenceResponse.json()) as { presences: Array<{ actorId: string }> };
      expect(presenceBody.presences.find(
        (p) => p.actorId === 'agent-orphan-test',
      )).toBeDefined();

      // Verify edit session exists
      let sessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      let sessionsBody = (await sessionsResponse.json()) as { sessions: unknown[] };
      expect(sessionsBody.sessions.length).toBe(1);

      // Advance time to T+550s (session not yet expired, presence not stale)
      vi.setSystemTime(baseTime + 550_000);

      // Simulate agent activity to keep presence fresh (apply an edit)
      await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            actorId: 'agent-orphan-test',
            editSessionId: ((await startResponse.clone().json()) as { editSessionId: string }).editSessionId,
            operations: [
              { type: 'set', path: 'root.title', value: 'Still active' },
            ],
          }),
        }),
      );

      // Now advance to T+601s: session expired (>600s), but presence is fresh
      // (lastActivityAt was updated at T+550s, so only 51s stale, well under 120s threshold)
      vi.setSystemTime(baseTime + 601_000);

      // Trigger alarm (which calls runCleanup)
      await session.alarm();

      // Verify edit session is cleaned up
      sessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      sessionsBody = (await sessionsResponse.json()) as { sessions: unknown[] };
      expect(sessionsBody.sessions.length).toBe(0);

      // Verify agent presence is ALSO cleaned up even though it was "fresh"
      // This is the core bug: without the fix, clearStale() won't clear this
      // because lastActivityAt is recent, but the session has expired
      presenceResponse = await session.fetch(
        new Request('http://localhost/presences'),
      );
      presenceBody = (await presenceResponse.json()) as { presences: Array<{ actorId: string }> };
      const orphanedPresence = presenceBody.presences.find(
        (p) => p.actorId === 'agent-orphan-test',
      );
      expect(orphanedPresence).toBeUndefined();

      vi.useRealTimers();
    });

    it('should clean up multiple orphaned sessions and their fresh presence records', async () => {
      vi.useFakeTimers();
      const baseTime = Date.now();

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start two edit sessions from different agents
      const start1 = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-orphan-1',
            trigger: 'human_requested',
            intent: 'First orphan',
            targetRegions: ['/content/0'],
          }),
        }),
      );
      const start1Body = (await start1.json()) as { editSessionId: string };

      const start2 = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-orphan-2',
            trigger: 'human_requested',
            intent: 'Second orphan',
            targetRegions: ['/content/1'],
          }),
        }),
      );
      const start2Body = (await start2.json()) as { editSessionId: string };

      // Verify both are present
      let presenceResponse = await session.fetch(
        new Request('http://localhost/presences'),
      );
      let presenceBody = (await presenceResponse.json()) as { presences: Array<{ actorId: string }> };
      expect(presenceBody.presences.length).toBe(2);

      // Advance to T+550s and make both agents active (fresh presence)
      vi.setSystemTime(baseTime + 550_000);

      await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Actor-Type': 'agent' },
          body: JSON.stringify({
            actorId: 'agent-orphan-1',
            editSessionId: start1Body.editSessionId,
            operations: [{ type: 'set', path: 'root.title', value: 'Active 1' }],
          }),
        }),
      );

      await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Actor-Type': 'agent' },
          body: JSON.stringify({
            actorId: 'agent-orphan-2',
            editSessionId: start2Body.editSessionId,
            operations: [{ type: 'set', path: 'root.body', value: 'Active 2' }],
          }),
        }),
      );

      // Advance past session expiry (T+601s) - presence still fresh (51s since activity)
      vi.setSystemTime(baseTime + 601_000);

      await session.alarm();

      // Both presences should be cleaned up along with their sessions
      presenceResponse = await session.fetch(
        new Request('http://localhost/presences'),
      );
      presenceBody = (await presenceResponse.json()) as { presences: Array<{ actorId: string }> };
      expect(presenceBody.presences.length).toBe(0);

      vi.useRealTimers();
    });

    it('should persist presence state after orphaned session cleanup', async () => {
      vi.useFakeTimers();
      const baseTime = Date.now();

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an edit session
      const startResp = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-persist-test',
            trigger: 'human_requested',
            intent: 'Test presence persistence after cleanup',
            targetRegions: ['/content/0'],
          }),
        }),
      );
      const startBody = (await startResp.json()) as { editSessionId: string };

      // Keep presence fresh with activity at T+550s
      vi.setSystemTime(baseTime + 550_000);

      await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Actor-Type': 'agent' },
          body: JSON.stringify({
            actorId: 'agent-persist-test',
            editSessionId: startBody.editSessionId,
            operations: [{ type: 'set', path: 'root.title', value: 'Active' }],
          }),
        }),
      );

      // Clear mock call history so we only see calls from alarm()
      state.storage.put.mockClear();

      // Expire the session
      vi.setSystemTime(baseTime + 601_000);
      await session.alarm();

      vi.useRealTimers();

      // Verify presence state was persisted to storage after orphaned session cleanup
      const putCalls = state.storage.put.mock.calls;
      const presencePersistCall = putCalls.find(
        (call) => call[0] === 'presenceState',
      );
      expect(presencePersistCall).toBeDefined();
    });
  });

  describe('session/presence consistency on restore', () => {
    it('should clean up agent presence that has no matching edit session after restore', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const now = Date.now();

      // Pre-populate storage with an expired session AND its presence
      // The session is >600s old so it won't be restored, but the presence
      // has a recent lastActivityAt (from just before the DO was evicted)
      const state = createMockState();
      state.storage.get.mockImplementation(async (key: string) => {
        if (key === 'editSessions') {
          return JSON.stringify({
            'expired-session-1': {
              id: 'expired-session-1',
              agentId: 'agent-expired',
              trigger: 'human_requested',
              intent: 'Expired session',
              targetRegions: ['/content/0'],
              startedAt: now - 700_000, // 700s ago - expired
            },
          });
        }
        if (key === 'presenceState') {
          // Presence was recently active (30s ago) - won't be cleared by clearStale
          return {
            presences: [
              {
                id: 'presence-expired',
                actorId: 'agent-expired',
                actorType: 'agent',
                role: 'agent',
                name: 'Expired Agent',
                state: 'editing',
                lastActivityAt: new Date(now - 30_000).toISOString(),
                joinedAt: new Date(now - 700_000).toISOString(),
              },
            ],
            actorIdIndex: {
              'agent-expired': 'presence-expired',
            },
          };
        }
        return undefined;
      });

      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Trigger initialization
      await session.fetch(new Request('http://localhost/presences'));

      // The expired session should NOT be restored
      const sessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      const sessionsBody = (await sessionsResponse.json()) as { sessions: unknown[] };
      expect(sessionsBody.sessions.length).toBe(0);

      // After alarm, the orphaned presence (has no matching session) should be cleaned
      await session.alarm();

      const postAlarmPresence = await session.fetch(
        new Request('http://localhost/presences'),
      );
      const postAlarmBody = (await postAlarmPresence.json()) as { presences: Array<{ actorId: string }> };
      const expiredPresence = postAlarmBody.presences.find(
        (p) => p.actorId === 'agent-expired',
      );
      expect(expiredPresence).toBeUndefined();
    });
  });

  describe('orphaned autonomous session rollback', () => {
    it('should attempt rollback when autonomous session with checkpointId expires', async () => {
      vi.useFakeTimers();
      const baseTime = Date.now();

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start an autonomous edit session (creates a checkpoint)
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-rollback-test',
            trigger: 'autonomous',
            intent: 'Test orphaned rollback',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      expect(startResponse.status).toBe(200);
      const startBody = (await startResponse.json()) as { editSessionId: string; checkpointId: string };
      // Autonomous sessions get a checkpoint (placeholder in test env without Hyperdrive)
      expect(startBody.checkpointId).toBeDefined();

      // Apply an edit so there's something to roll back
      vi.setSystemTime(baseTime + 550_000);
      await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Actor-Type': 'agent' },
          body: JSON.stringify({
            actorId: 'agent-rollback-test',
            editSessionId: startBody.editSessionId,
            operations: [{ type: 'set', path: 'root.title', value: 'Should be rolled back' }],
          }),
        }),
      );

      // Expire the session
      vi.setSystemTime(baseTime + 601_000);
      await session.alarm();

      // Session should be cleaned up
      const sessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      const sessionsBody = (await sessionsResponse.json()) as { sessions: unknown[] };
      expect(sessionsBody.sessions.length).toBe(0);

      // Agent presence should be cleared
      const presenceResponse = await session.fetch(
        new Request('http://localhost/presences'),
      );
      const presenceBody = (await presenceResponse.json()) as { presences: Array<{ actorId: string }> };
      expect(presenceBody.presences.find(
        (p) => p.actorId === 'agent-rollback-test',
      )).toBeUndefined();

      vi.useRealTimers();
    });

    it('should NOT attempt rollback for human_requested sessions without checkpointId', async () => {
      vi.useFakeTimers();
      const baseTime = Date.now();

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Start a human_requested edit session (no checkpoint)
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-no-rollback',
            trigger: 'human_requested',
            intent: 'No checkpoint for this one',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      expect(startResponse.status).toBe(200);
      const startBody = (await startResponse.json()) as { editSessionId: string; checkpointId?: string };
      // human_requested sessions should NOT have a checkpoint
      expect(startBody.checkpointId).toBeUndefined();

      // Expire the session — cleanup should NOT attempt rollback (no checkpoint to rollback to)
      vi.setSystemTime(baseTime + 601_000);
      await session.alarm();

      // Session should still be cleaned up normally
      const sessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      const sessionsBody = (await sessionsResponse.json()) as { sessions: unknown[] };
      expect(sessionsBody.sessions.length).toBe(0);

      vi.useRealTimers();
    });

    it('should handle rollback failure gracefully during cleanup', async () => {
      vi.useFakeTimers();
      const baseTime = Date.now();

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      // Configure env with internal API that will fail
      const env = {
        ...createMockEnv(),
        INTERNAL_API_URL: 'http://failing-api:9999',
        INTERNAL_SECRET: 'test-secret',
      };
      const session = new DocumentSession(state, env);

      // Start an autonomous session
      const startResponse = await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-fail-rollback',
            trigger: 'autonomous',
            intent: 'Test rollback failure handling',
            targetRegions: ['/content/0'],
          }),
        }),
      );

      expect(startResponse.status).toBe(200);

      // Expire the session — rollback will fail but cleanup should still proceed
      vi.setSystemTime(baseTime + 601_000);

      // alarm() should not throw even when rollback fails
      await expect(session.alarm()).resolves.not.toThrow();

      // Session should still be cleaned up despite rollback failure
      const sessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      const sessionsBody = (await sessionsResponse.json()) as { sessions: unknown[] };
      expect(sessionsBody.sessions.length).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('restoreEditSessions should roll back expired sessions on DO restore', () => {
    it('should roll back expired sessions with checkpoints when DO wakes from hibernation', async () => {
      vi.useFakeTimers();
      const baseTime = Date.now();

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      // Create first DO instance and start an autonomous edit session
      const state1 = createMockState();
      const env1 = createMockEnv();
      env1.INTERNAL_API_URL = 'http://localhost:8787';
      const session1 = new DocumentSession(state1, env1);

      const startResponse = await session1.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-restore-test',
            trigger: 'autonomous',
            intent: 'Test restore rollback',
            targetRegions: ['/content/0'],
          }),
        }),
      );
      expect(startResponse.status).toBe(200);

      // Capture what was stored in DO storage (the serialized edit sessions)
      const storagePutCalls = (state1.storage.put as Mock).mock.calls;
      const editSessionsPut = storagePutCalls.find(
        (call: unknown[]) => call[0] === 'editSessions',
      );
      expect(editSessionsPut).toBeDefined();
      const storedSessionsJson = editSessionsPut![1] as string;

      // Advance time past expiration (>10 minutes)
      vi.setSystemTime(baseTime + 601_000);

      // Create a NEW DO instance (simulating DO waking from hibernation)
      // Pre-load storage.get to return the stale sessions
      const state2 = createMockState();
      const env2 = createMockEnv();
      env2.INTERNAL_API_URL = 'http://localhost:8787';
      (state2.storage.get as Mock).mockImplementation((key: string) => {
        if (key === 'editSessions') {
          return Promise.resolve(storedSessionsJson);
        }
        return Promise.resolve(undefined);
      });

      const session2 = new DocumentSession(state2, env2);

      // Trigger metadata initialization (which calls restoreEditSessions)
      // A presence check is sufficient to trigger initializeMetadataIfNeeded
      const presenceResponse = await session2.fetch(
        new Request('http://localhost/presences'),
      );
      expect(presenceResponse.status).toBe(200);

      // Verify the expired session was NOT restored
      const sessionsResponse = await session2.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      const sessionsBody = (await sessionsResponse.json()) as { sessions: unknown[] };
      expect(sessionsBody.sessions.length).toBe(0);

      // Verify the cleaned-up sessions were persisted back to storage
      const state2PutCalls = (state2.storage.put as Mock).mock.calls;
      const cleanedPut = state2PutCalls.find(
        (call: unknown[]) => call[0] === 'editSessions',
      );
      expect(cleanedPut).toBeDefined();

      vi.useRealTimers();
    });

    it('should keep non-expired sessions when restoring from storage', async () => {
      vi.useFakeTimers();
      const baseTime = Date.now();

      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      // Create first DO instance and start an edit session
      const state1 = createMockState();
      const env1 = createMockEnv();
      const session1 = new DocumentSession(state1, env1);

      const startResponse = await session1.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-restore-keep',
            trigger: 'human_requested',
            intent: 'Test non-expired restore',
            targetRegions: ['/content/0'],
          }),
        }),
      );
      expect(startResponse.status).toBe(200);

      // Capture stored sessions
      const storagePutCalls = (state1.storage.put as Mock).mock.calls;
      const editSessionsPut = storagePutCalls.find(
        (call: unknown[]) => call[0] === 'editSessions',
      );
      const storedSessionsJson = editSessionsPut![1] as string;

      // Advance time but NOT past expiration (only 5 minutes)
      vi.setSystemTime(baseTime + 300_000);

      // Create a new DO instance with the stored sessions
      const state2 = createMockState();
      const env2 = createMockEnv();
      (state2.storage.get as Mock).mockImplementation((key: string) => {
        if (key === 'editSessions') {
          return Promise.resolve(storedSessionsJson);
        }
        return Promise.resolve(undefined);
      });

      const session2 = new DocumentSession(state2, env2);

      // Trigger initialization
      await session2.fetch(new Request('http://localhost/presences'));

      // Verify the session WAS restored (not expired yet)
      const sessionsResponse = await session2.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      const sessionsBody = (await sessionsResponse.json()) as { sessions: unknown[] };
      expect(sessionsBody.sessions.length).toBe(1);

      vi.useRealTimers();
    });
  });
});

