/**
 * DocumentSession Focus Regions Endpoint Tests (TDD)
 *
 * Tests for the /update-focus-regions endpoint that allows humans to
 * proactively report their current component selection.
 *
 * Based on Proactive Focus Region Reporting plan.
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
function createMockState(sessionId = 'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001'): MockDurableObjectState {
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
 * Mock environment for DocumentSession
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
// /update-focus-regions Endpoint Tests
// =============================================================================

describe('DocumentSession /update-focus-regions endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('validation', () => {
    it('should require X-Actor-Type: user header', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Request without X-Actor-Type header (or with agent)
      const request = new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'agent', // Wrong type
        },
        body: JSON.stringify({
          actorId: 'agent-123',
          focusRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('user');
    });

    it('should require POST method', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/update-focus-regions', {
        method: 'GET',
        headers: {
          'X-Actor-Type': 'user',
        },
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(405);
    });

    it('should require valid JSON body', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: 'not valid json',
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(400);
    });

    it('should require actorId field', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          focusRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('actorId');
    });

    it('should require focusRegions field', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('focusRegions');
    });

    it('should limit focusRegions to maximum allowed', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Create 100 focus regions (exceeds the 50 limit)
      const tooManyRegions = Array.from(
        { length: 100 },
        (_, i) => `/content/${String(i)}`,
      );

      const request = new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          focusRegions: tooManyRegions,
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('50');
    });
  });

  describe('success cases', () => {
    it('should record focus regions and return success', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          focusRegions: ['/content/0', '/content/1'],
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.focusRegions).toContain('/content/0');
      expect(body.focusRegions).toContain('/content/1');
    });

    it('should clear focus when empty array provided', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // First set some focus regions
      await session.fetch(new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          focusRegions: ['/content/0'],
        }),
      }));

      // Then clear them with empty array
      const clearRequest = new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          focusRegions: [],
        }),
      });

      const response = await session.fetch(clearRequest);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.focusRegions).toEqual([]);
    });

    it('should replace existing focus regions for same actor', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Set initial focus
      await session.fetch(new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          focusRegions: ['/content/0'],
        }),
      }));

      // Update focus to new regions
      const request = new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          focusRegions: ['/content/1', '/content/2'],
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.focusRegions).toHaveLength(2);
      expect(body.focusRegions).not.toContain('/content/0');
      expect(body.focusRegions).toContain('/content/1');
      expect(body.focusRegions).toContain('/content/2');
    });
  });

  describe('integration with /can-agent-edit', () => {
    it('should block agent from editing focused regions', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Human focuses on a region
      await session.fetch(new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          focusRegions: ['/content/0'],
        }),
      }));

      // Agent tries to edit the same region
      const agentRequest = new Request('http://localhost/can-agent-edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: 'agent-456',
          trigger: 'autonomous',
          targetRegions: ['/content/0'],
        }),
      });

      const response = await session.fetch(agentRequest);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.allowed).toBe(false);
      expect(body.reason).toBe('region_conflict');
      expect(body.conflictingRegions).toContain('/content/0');
    });

    it('should allow agent to edit non-focused regions', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Human focuses on a region
      await session.fetch(new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          focusRegions: ['/content/0'],
        }),
      }));

      // Agent tries to edit a different region
      const agentRequest = new Request('http://localhost/can-agent-edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: 'agent-456',
          trigger: 'autonomous',
          targetRegions: ['/content/1'],
        }),
      });

      const response = await session.fetch(agentRequest);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.allowed).toBe(true);
    });
  });

  describe('integration with /presences', () => {
    it('should include focus regions in presence response', async () => {
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      const state = createMockState();
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Set focus regions for a user
      await session.fetch(new Request('http://localhost/update-focus-regions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Type': 'user',
        },
        body: JSON.stringify({
          actorId: 'user-123',
          focusRegions: ['/content/0', '/content/1'],
        }),
      }));

      // Get presences
      const presenceRequest = new Request('http://localhost/presences');
      const response = await session.fetch(presenceRequest);
      expect(response.status).toBe(200);

      const body = await response.json();
      const userPresence = body.presences.find(
        (p: { actorId: string }) => p.actorId === 'user-123',
      );

      expect(userPresence).toBeDefined();
      expect(userPresence.focusRegions).toContain('/content/0');
      expect(userPresence.focusRegions).toContain('/content/1');
    });
  });
});
