/**
 * Phase 6: DocumentSession Conflict Notification & Kill Switch Tests (TDD)
 *
 * Tests for conflict notification when humans enter agent-occupied regions
 * and the kill switch feature to terminate agent sessions.
 *
 * The DocumentSession should:
 * 1. Detect when human edits overlap with active agent edit sessions
 * 2. Send conflict notifications to affected agents via WebSocket
 * 3. Allow any collaborator to kick agents from the document
 * 4. Clean up agent sessions when kicked
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

// =============================================================================
// Mock Setup
// =============================================================================

// Mock the database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock the organization service
vi.mock('../../src/services/organization-service', () => ({
  getOrganizationForSite: vi.fn().mockResolvedValue(null),
}));

// Mock the agent service
vi.mock('../../src/services/agent-service', () => ({
  getAgent: vi.fn().mockResolvedValue({
    id: 'agent-123',
    organizationId: 'org-1',
    name: 'Test Agent',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  getAgentById: vi.fn().mockImplementation((agentId: string) => {
    return Promise.resolve({
      id: agentId,
      organizationId: 'org-1',
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

/**
 * Mock DurableObjectStorage interface
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
function createMockState(
  sessionId = 'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001',
): MockDurableObjectState {
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
    blockConcurrencyWhile: vi
      .fn()
      .mockImplementation(async (cb: () => Promise<void>) => {
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
 * Create a mock environment
 */
function createMockEnv(): { API_URL: string; ENVIRONMENT: string } {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
  };
}

// =============================================================================
// Phase 6: Conflict Notification & Kill Switch Tests
// =============================================================================

describe('Phase 6: Conflict Notification & Kill Switch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('conflict notification on human activity', () => {
    it('should detect when human edits overlap with active agent regions', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Agent starts editing a region
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-123',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-123',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            targetRegions: ['/content/header'],
            trigger: 'autonomous',
            intent: 'Test edit session',
          }),
        }),
      );

      // Human makes an edit that overlaps with agent's region
      const applyResponse = await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            operations: [
              { type: 'set', path: '/content/header/title', value: 'New Title' },
            ],
            actorId: 'user-123',
          }),
        }),
      );

      expect(applyResponse.status).toBe(200);

      // Check that the system detected the conflict
      const editSessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      const editSessions = await editSessionsResponse.json();

      // The agent's session should be marked as conflicted or aborted
      expect(editSessions.sessions).toBeDefined();
      const agentSession = editSessions.sessions.find(
        (s: { ownerId: string }) => s.ownerId === 'agent-123',
      );
      // After human conflict, the session should be marked for abort
      expect(
        agentSession === undefined || agentSession.conflicted === true,
      ).toBe(true);
    });

    it('should not trigger conflict for non-overlapping regions', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Agent starts editing header region
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-123',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-123',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            targetRegions: ['/content/header'],
            trigger: 'autonomous',
            intent: 'Test edit session for header',
          }),
        }),
      );

      // Human makes an edit to a DIFFERENT region (footer)
      const applyResponse = await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            operations: [
              {
                type: 'set',
                path: '/content/footer/copyright',
                value: '2026',
              },
            ],
            actorId: 'user-123',
          }),
        }),
      );

      expect(applyResponse.status).toBe(200);

      // Agent session should NOT be conflicted
      const editSessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      const editSessions = await editSessionsResponse.json();

      const agentSession = editSessions.sessions.find(
        (s: { ownerId: string }) => s.ownerId === 'agent-123',
      );
      expect(agentSession).toBeDefined();
      expect(agentSession.conflicted).toBeFalsy();
    });

    it('should include conflict info in apply response when conflict detected', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Agent starts editing
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-123',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-123',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            targetRegions: ['/content'],
            trigger: 'autonomous',
            intent: 'Test edit session for content',
          }),
        }),
      );

      // Human makes overlapping edit
      const applyResponse = await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            operations: [
              { type: 'set', path: '/content/text', value: 'Updated' },
            ],
            actorId: 'user-123',
          }),
        }),
      );

      expect(applyResponse.status).toBe(200);
      const body = await applyResponse.json();

      // Response should include info about affected agent sessions
      expect(body.sessionConflicts).toBeDefined();
      expect(body.sessionConflicts.length).toBeGreaterThan(0);
      expect(body.sessionConflicts[0].ownerId).toBe('agent-123');
    });
  });

  describe('kill switch endpoint', () => {
    it('should have POST /kick-agent endpoint', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // First, have an agent start editing
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-123',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-123',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            targetRegions: ['/content'],
            trigger: 'autonomous',
            intent: 'Test edit session',
          }),
        }),
      );

      // User kicks the agent
      const kickResponse = await session.fetch(
        new Request('http://localhost/kick-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            reason: 'User requested termination',
          }),
        }),
      );

      expect(kickResponse.status).toBe(200);
      const body = await kickResponse.json();
      expect(body.success).toBe(true);
      expect(body.agentId).toBe('agent-123');
    });

    it('should terminate agent edit session when kicked', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Agent starts editing
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-123',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-123',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            targetRegions: ['/content'],
            trigger: 'autonomous',
            intent: 'Test edit session',
          }),
        }),
      );

      // Verify agent has active session
      let editSessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      let editSessions = await editSessionsResponse.json();
      expect(editSessions.sessions.length).toBe(1);

      // Kick the agent
      await session.fetch(
        new Request('http://localhost/kick-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
          }),
        }),
      );

      // Verify agent session is terminated
      editSessionsResponse = await session.fetch(
        new Request('http://localhost/edit-sessions'),
      );
      editSessions = await editSessionsResponse.json();
      expect(editSessions.sessions.length).toBe(0);
    });

    it('should return 404 when kicking non-existent agent', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const kickResponse = await session.fetch(
        new Request('http://localhost/kick-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            agentId: 'non-existent-agent',
          }),
        }),
      );

      expect(kickResponse.status).toBe(404);
      const body = await kickResponse.json();
      expect(body.error).toContain('not found');
    });

    it('should require agentId in kick request', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const kickResponse = await session.fetch(
        new Request('http://localhost/kick-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({}),
        }),
      );

      expect(kickResponse.status).toBe(400);
      const body = await kickResponse.json();
      expect(body.error).toContain('agentId');
    });

    it('should allow agents to be kicked by any actor type', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Agent starts editing
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-123',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-123',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            targetRegions: ['/content'],
            trigger: 'autonomous',
            intent: 'Test edit session',
          }),
        }),
      );

      // Another agent kicks the first agent
      const kickResponse = await session.fetch(
        new Request('http://localhost/kick-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-456',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
          }),
        }),
      );

      expect(kickResponse.status).toBe(200);
    });

    it('should record kick reason in response', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Agent starts editing
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-123',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-123',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            targetRegions: ['/content'],
            trigger: 'autonomous',
            intent: 'Test edit session',
          }),
        }),
      );

      // Kick with reason
      const kickResponse = await session.fetch(
        new Request('http://localhost/kick-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            reason: 'Agent is not responding correctly',
          }),
        }),
      );

      expect(kickResponse.status).toBe(200);
      const body = await kickResponse.json();
      expect(body.reason).toBe('Agent is not responding correctly');
      expect(body.kickedBy).toBe('user-123');
    });
  });

  describe('list active agents endpoint', () => {
    it('should have GET /active-agents endpoint', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Agent starts editing
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-123',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-123',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            targetRegions: ['/content'],
            trigger: 'autonomous',
            intent: 'Test edit session',
          }),
        }),
      );

      const response = await session.fetch(
        new Request('http://localhost/active-agents'),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.agents).toBeDefined();
      expect(body.agents.length).toBe(1);
      expect(body.agents[0].agentId).toBe('agent-123');
      expect(body.agents[0].regions).toContain('/content');
    });

    it('should return empty array when no agents are active', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const response = await session.fetch(
        new Request('http://localhost/active-agents'),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.agents).toEqual([]);
    });
  });

  describe('kick-all-agents endpoint', () => {
    it('should have POST /kick-all-agents endpoint', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Multiple agents start editing
      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-123',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-123',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            targetRegions: ['/content/header'],
            trigger: 'autonomous',
            intent: 'Test edit session for header',
          }),
        }),
      );

      await session.fetch(
        new Request('http://localhost/agent-edit-start', {
          method: 'POST',
          headers: { 'X-Verified-Actor-Id': 'agent-456',
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-456',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({
            agentId: 'agent-456',
            targetRegions: ['/content/footer'],
            trigger: 'autonomous',
            intent: 'Test edit session for footer',
          }),
        }),
      );

      // Verify both agents are active
      let activeResponse = await session.fetch(
        new Request('http://localhost/active-agents'),
      );
      let activeBody = await activeResponse.json();
      expect(activeBody.agents.length).toBe(2);

      // Kick all agents
      const kickAllResponse = await session.fetch(
        new Request('http://localhost/kick-all-agents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            reason: 'Emergency shutdown',
          }),
        }),
      );

      expect(kickAllResponse.status).toBe(200);
      const kickBody = await kickAllResponse.json();
      expect(kickBody.kickedCount).toBe(2);
      expect(kickBody.kickedAgents).toContain('agent-123');
      expect(kickBody.kickedAgents).toContain('agent-456');

      // Verify all agents are gone
      activeResponse = await session.fetch(
        new Request('http://localhost/active-agents'),
      );
      activeBody = await activeResponse.json();
      expect(activeBody.agents.length).toBe(0);
    });
  });
});
