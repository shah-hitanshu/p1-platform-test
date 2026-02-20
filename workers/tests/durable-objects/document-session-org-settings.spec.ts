/**
 * Phase 5: DocumentSession Organization Settings Integration Tests (TDD)
 *
 * Tests for integrating organization-level settings (agentIdleTimeoutMs)
 * into the DocumentSession Durable Object.
 *
 * The DocumentSession should:
 * 1. Fetch the organization settings for its site during initialization
 * 2. Use the org's agentIdleTimeoutMs for the ActivityDetector
 * 3. Fall back to default if no organization is configured
 * 4. Cache settings to avoid repeated lookups
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// =============================================================================
// Mock Setup
// =============================================================================

// Mock the database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock the organization service
vi.mock('../../src/services/organization-service', () => ({
  getOrganizationForSite: vi.fn(),
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
 * Create a mock environment
 */
function createMockEnv(): { API_URL: string; ENVIRONMENT: string } {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
  };
}

// =============================================================================
// Phase 5: Organization Settings Integration Tests
// =============================================================================

describe('Phase 5: Organization Settings Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('initialization with organization settings', () => {
    it('should use organization agentIdleTimeoutMs when org exists', async () => {
      // Import after mocks are set up
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      // Mock organization with custom timeout
      (getOrganizationForSite as Mock).mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        settings: {
          agentIdleTimeoutMs: 10000, // 10 seconds
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Trigger initialization by making a request
      const request = new Request('http://localhost/activity-state');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should use org's timeout (10000ms) instead of default (5000ms)
      expect(body.idleTimeoutMs).toBe(10000);
    });

    it('should use default timeout when no organization is linked', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      // Mock no organization
      (getOrganizationForSite as Mock).mockResolvedValue(null);

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/activity-state');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should use default timeout (5000ms)
      expect(body.idleTimeoutMs).toBe(5000);
    });

    it('should use default timeout when org settings missing agentIdleTimeoutMs', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      // Mock organization with empty settings
      (getOrganizationForSite as Mock).mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        settings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/activity-state');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should use default timeout
      expect(body.idleTimeoutMs).toBe(5000);
    });

    it('should cache organization settings', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      (getOrganizationForSite as Mock).mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        settings: {
          agentIdleTimeoutMs: 15000,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Make multiple requests
      await session.fetch(new Request('http://localhost/activity-state'));
      await session.fetch(new Request('http://localhost/activity-state'));
      await session.fetch(new Request('http://localhost/activity-state'));

      // Should only call getOrganizationForSite once (cached)
      expect(getOrganizationForSite).toHaveBeenCalledTimes(1);
    });

    it('should pass siteId to getOrganizationForSite', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      (getOrganizationForSite as Mock).mockResolvedValue(null);

      const state = createMockState('my-site-id:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      await session.fetch(new Request('http://localhost/activity-state'));

      // Should be called with the correct siteId
      expect(getOrganizationForSite).toHaveBeenCalledWith('my-site-id');
    });

    it('should handle organization service errors gracefully', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      // Mock service error
      (getOrganizationForSite as Mock).mockRejectedValue(
        new Error('Database connection failed'),
      );

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Should still work with default timeout
      const request = new Request('http://localhost/activity-state');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.idleTimeoutMs).toBe(5000);
    });
  });

  describe('agent permission checks with org settings', () => {
    it('should use org timeout for can-agent-edit permission checks', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      // Mock organization with 10 second timeout
      (getOrganizationForSite as Mock).mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        settings: {
          agentIdleTimeoutMs: 10000,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Simulate recent human activity
      await session.fetch(
        new Request('http://localhost/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            operations: [{ type: 'set', path: '/content/0', value: 'test' }],
            actorId: 'user-123',
          }),
        }),
      );

      // Check if agent can edit (should be denied due to recent activity)
      const request = new Request('http://localhost/can-agent-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-123',
          trigger: 'autonomous',
          targetRegions: ['/content/1'], // Different region
        }),
      });

      const response = await session.fetch(request);
      expect(response.status).toBe(200);
      const body = await response.json();

      // Should be denied due to human activity (within 10 second timeout)
      expect(body.allowed).toBe(false);
      expect(body.reason).toBe('human_active');
    });
  });

  describe('manual timeout override', () => {
    it('should allow manual override via /set-idle-timeout', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      // Mock organization with 10 second timeout
      (getOrganizationForSite as Mock).mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        settings: {
          agentIdleTimeoutMs: 10000,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // First, trigger initialization
      await session.fetch(new Request('http://localhost/activity-state'));

      // Override with manual timeout
      const overrideRequest = new Request('http://localhost/set-idle-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idleTimeoutMs: 30000 }),
      });

      const overrideResponse = await session.fetch(overrideRequest);
      expect(overrideResponse.status).toBe(200);

      // Verify the override took effect
      const stateRequest = new Request('http://localhost/activity-state');
      const stateResponse = await session.fetch(stateRequest);
      const body = await stateResponse.json();

      expect(body.idleTimeoutMs).toBe(30000);
    });
  });

  describe('organization info endpoint', () => {
    it('should expose organization info via /org-settings endpoint', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      (getOrganizationForSite as Mock).mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        settings: {
          agentIdleTimeoutMs: 10000,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/org-settings');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.organizationId).toBe('org-1');
      expect(body.organizationName).toBe('Test Org');
      expect(body.agentIdleTimeoutMs).toBe(10000);
    });

    it('should return null org info when no organization linked', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      (getOrganizationForSite as Mock).mockResolvedValue(null);

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      const request = new Request('http://localhost/org-settings');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.organizationId).toBeNull();
      expect(body.organizationName).toBeNull();
      expect(body.agentIdleTimeoutMs).toBe(5000); // Default
    });
  });

  describe('refresh organization settings', () => {
    it('should allow refreshing org settings via POST /org-settings/refresh', async () => {
      const { getOrganizationForSite } = await import(
        '../../src/services/organization-service'
      );
      const { DocumentSession } = await import(
        '../../src/durable-objects/document-session'
      );

      // First call: timeout is 10s
      (getOrganizationForSite as Mock).mockResolvedValueOnce({
        id: 'org-1',
        name: 'Test Org',
        settings: {
          agentIdleTimeoutMs: 10000,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const state = createMockState('site-1:doc-1:branch-1');
      const env = createMockEnv();
      const session = new DocumentSession(state, env);

      // Initial request
      const response1 = await session.fetch(
        new Request('http://localhost/activity-state'),
      );
      const body1 = await response1.json();
      expect(body1.idleTimeoutMs).toBe(10000);

      // Update the mock: timeout is now 20s
      (getOrganizationForSite as Mock).mockResolvedValueOnce({
        id: 'org-1',
        name: 'Test Org',
        settings: {
          agentIdleTimeoutMs: 20000,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Refresh org settings
      const refreshRequest = new Request(
        'http://localhost/org-settings/refresh',
        {
          method: 'POST',
        },
      );
      const refreshResponse = await session.fetch(refreshRequest);
      expect(refreshResponse.status).toBe(200);

      // Check new timeout
      const response2 = await session.fetch(
        new Request('http://localhost/activity-state'),
      );
      const body2 = await response2.json();
      expect(body2.idleTimeoutMs).toBe(20000);
    });
  });
});
