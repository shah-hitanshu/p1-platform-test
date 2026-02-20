/**
 * Phase 7.4: Edit Workflow Status Enforcement - TDD Tests
 *
 * Tests for integrating agent status validation into the Realtime API's
 * agent edit workflow endpoints. Ensures suspended/disabled agents are
 * rejected at the Worker level BEFORE forwarding requests to the Durable Object.
 *
 * Endpoints protected:
 * - can-agent-edit: Required check (agentId from body/header merge)
 * - agent-edit-start: Required check (agentId from body/header merge)
 * - agent-edit-complete: Optional check (only if X-Agent-Id header present)
 * - agent-edit-abort: Optional check (only if X-Agent-Id header present)
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agent service - must be before imports
vi.mock('../../src/services/agent-service', () => ({
  getAgentById: vi.fn(),
}));

// Mock document service for database calls
vi.mock('../../src/services/document-service', () => ({
  getDocumentByPath: vi.fn(),
}));

// Mock authorization module
vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

// Import mocked modules for test setup
import * as documentService from '../../src/services/document-service';
import { hasPermission } from '../../src/auth/authorization';
import type { RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { AuthenticatedPrincipal } from '../../src/types';

/**
 * Helper to assert a value is not null and return it as non-null type.
 */
function assertNotNull<T>(value: T | null, message = 'Expected non-null value'): T {
  if (value === null) {
    throw new Error(message);
  }
  return value;
}

// Mock types for Cloudflare Durable Objects
interface MockDurableObjectStub {
  fetch: ReturnType<typeof vi.fn>;
}

interface MockDurableObjectId {
  toString: () => string;
}

interface MockDurableObjectNamespace {
  idFromName: ReturnType<typeof vi.fn<[string], MockDurableObjectId>>;
  get: ReturnType<typeof vi.fn<[MockDurableObjectId], MockDurableObjectStub>>;
}

interface MockEnv {
  ENVIRONMENT: string;
  DOCUMENT_STATE: MockDurableObjectNamespace;
  POSTGRES_CONNECTION_STRING: string;
  CORS_ORIGINS?: string;
}

/** Mock agent shape matching RegisteredAgent */
interface MockAgent {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  capabilities: string[];
  status: 'active' | 'suspended' | 'disabled';
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Helper to create a mock active agent
 */
function createMockAgent(status: 'active' | 'suspended' | 'disabled', id = 'agent-123'): MockAgent {
  return {
    id,
    organizationId: 'org-1',
    name: `${status.charAt(0).toUpperCase() + status.slice(1)} Agent`,
    description: `Agent that is ${status}`,
    capabilities: ['content_edit'],
    status,
    settings: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const defaultPrincipal: AuthenticatedPrincipal = {
  id: 'test-actor',
  type: 'user',
  email: 'test@example.com',
  pantheonSiteRoles: { 'site-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'mock',
};
const defaultContext: RealtimeRouteContext = { principal: defaultPrincipal };

describe('Phase 7.4: Edit Workflow Status Enforcement', () => {
  let mockEnv: MockEnv;
  let mockStub: MockDurableObjectStub;
  let mockId: MockDurableObjectId;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);

    // Mock getDocumentByPath to return a document by default
    vi.mocked(documentService.getDocumentByPath).mockResolvedValue({
      id: 'mock-document-uuid',
      siteId: 'site-123',
      path: 'test-doc',
      createdAt: new Date().toISOString(),
      archivedAt: null,
    });

    mockStub = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ canEdit: true, editSessionId: 'session-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    };

    mockId = {
      toString: (): string => 'mock-durable-object-id',
    };

    mockEnv = {
      ENVIRONMENT: 'test',
      DOCUMENT_STATE: {
        idFromName: vi.fn().mockReturnValue(mockId),
        get: vi.fn().mockReturnValue(mockStub),
      },
      POSTGRES_CONNECTION_STRING: 'postgresql://test:test@localhost/test',
      CORS_ORIGINS: 'http://localhost:3000,http://localhost:8787',
    };
  });

  describe('can-agent-edit status enforcement', () => {
    it('should return 403 when agent is suspended', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('suspended');
    });

    it('should return 403 when agent is disabled', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('disabled'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('disabled');
    });

    it('should return 404 when agent not found', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(null);

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'nonexistent-agent',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });

    it('should return 500 on database lookup error', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockRejectedValue(new Error('Database connection failed'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(500);
    });

    it('should allow request when agent is active', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('active'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(200);
      expect(mockStub.fetch).toHaveBeenCalled();
    });

    it('should NOT call Durable Object when agent rejected', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/content'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      // Durable Object should NOT be called
      expect(mockStub.fetch).not.toHaveBeenCalled();
    });
  });

  describe('agent-edit-start status enforcement', () => {
    it('should return 403 when agent is suspended', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Start editing',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
    });

    it('should return 403 when agent is disabled', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('disabled'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Start editing',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
    });

    it('should allow request when agent is active', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('active'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Start editing',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(200);
      expect(mockStub.fetch).toHaveBeenCalled();
    });

    it('should NOT call Durable Object when agent rejected', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Start editing',
            targetRegions: ['/content'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(mockStub.fetch).not.toHaveBeenCalled();
    });
  });

  describe('agent-edit-complete with X-Agent-Id header', () => {
    it('should return 403 when header present and agent suspended', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            'X-Agent-Id': 'agent-123', // Header present - check status
          },
          body: JSON.stringify({
            editSessionId: 'session-123',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
    });

    it('should return 403 when header present and agent disabled', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('disabled'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            'X-Agent-Id': 'agent-123',
          },
          body: JSON.stringify({
            editSessionId: 'session-123',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
    });

    it('should allow request when header present and agent active', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('active'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            'X-Agent-Id': 'agent-123',
          },
          body: JSON.stringify({
            editSessionId: 'session-123',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(200);
      expect(mockStub.fetch).toHaveBeenCalled();
    });

    it('should allow request when X-Agent-Id header NOT present (backwards compat)', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      // Should NOT even look up the agent if no header
      vi.mocked(getAgentById).mockImplementation(() => {
        throw new Error('Should not be called');
      });

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            // No X-Agent-Id header
          },
          body: JSON.stringify({
            editSessionId: 'session-123',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      // Should pass through to Durable Object
      expect(response.status).toBe(200);
      expect(mockStub.fetch).toHaveBeenCalled();
    });

    it('should handle lowercase x-agent-id header', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            'x-agent-id': 'agent-123', // lowercase
          },
          body: JSON.stringify({
            editSessionId: 'session-123',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
    });
  });

  describe('agent-edit-abort with X-Agent-Id header', () => {
    it('should return 403 when header present and agent suspended', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            'X-Agent-Id': 'agent-123',
          },
          body: JSON.stringify({
            editSessionId: 'session-123',
            reason: 'Agent was suspended',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
    });

    it('should allow request when header NOT present', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      // Should NOT be called
      vi.mocked(getAgentById).mockImplementation(() => {
        throw new Error('Should not be called');
      });

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            // No X-Agent-Id header
          },
          body: JSON.stringify({
            editSessionId: 'session-123',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(200);
      expect(mockStub.fetch).toHaveBeenCalled();
    });

    it('should allow request when header present and agent active', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('active'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            'X-Agent-Id': 'agent-123',
          },
          body: JSON.stringify({
            editSessionId: 'session-123',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(200);
    });
  });

  describe('CORS headers on error responses', () => {
    it('should include CORS headers on 403 suspended response', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    });

    it('should include CORS headers on 404 not found response', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(null);

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'nonexistent',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(404);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    });

    it('should include CORS headers on 500 error response', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockRejectedValue(new Error('Database error'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/content'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(500);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    });
  });

  describe('Agent ID from headers in can-agent-edit/agent-edit-start', () => {
    it('should validate agent status using merged agentId from headers', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended', 'header-agent'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      // agentId comes from X-Agent-Id header, body is empty
      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            'X-Agent-Id': 'header-agent',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Update content',
            'X-Agent-Target-Regions': '/content',
          },
          body: JSON.stringify({}), // Empty body - all from headers
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      expect(vi.mocked(getAgentById)).toHaveBeenCalledWith('header-agent');
    });
  });
});
