/**
 * Edit workflow status enforcement.
 *
 * Suspended or disabled agents are rejected at the Worker level BEFORE the
 * request reaches the Durable Object. The status is checked against the
 * authenticated agent principal, never against a caller-supplied X-Agent-Id.
 *
 * Endpoints protected:
 * - can-agent-edit
 * - agent-edit-start
 * - agent-edit-complete
 * - agent-edit-abort
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

// PCC-3458: realtime routes resolve the branch ref via branch-service before
// keying the DO session; mocked so route tests don't hit the database.
vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
}));

// Mock authorization module
vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

// Import mocked modules for test setup
import * as documentService from '../../src/services/document-service';
import * as branchService from '../../src/services/branch-service';
import { hasPermission } from '../../src/auth/authorization';
import type { RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { AuthenticatedPrincipal, Branch } from '../../src/types';
import { readJson } from '../helpers/http';
import {
  makeDurableObjectNamespace,
  type MockDurableObjectNamespace,
  type MockDurableObjectStub,
} from '../helpers/durable-object';

/**
 * PCC-3458: build a branch whose id/siteId mirror the requested ref, so the
 * route's branch resolution succeeds and existing session-id fixtures keep
 * their exact original values.
 */
function branchForRef(siteId: string, ref: string): Branch {
  return {
    id: ref,
    siteId,
    name: ref,
    status: 'active',
    isMain: false,
    createdById: 'test-user',
    createdByType: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  };
}

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
interface MockDurableObjectId {
  toString: () => string;
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

const agentPrincipal: AuthenticatedPrincipal = {
  id: 'agent-123',
  type: 'agent',
  pantheonSiteRoles: { 'site-1': 'admin', 'site-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'agent_key',
};
const agentContext: RealtimeRouteContext = { principal: agentPrincipal };

const userPrincipal: AuthenticatedPrincipal = {
  id: 'test-actor',
  type: 'user',
  email: 'test@example.com',
  pantheonSiteRoles: { 'site-1': 'admin', 'site-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'mock',
};
const userContext: RealtimeRouteContext = { principal: userPrincipal };

const editBody = {
  trigger: 'autonomous',
  intent: 'Update content',
  targetRegions: ['/content'],
};

describe('Edit workflow status enforcement', () => {
  let mockEnv: MockEnv;
  let mockStub: MockDurableObjectStub;
  let mockId: MockDurableObjectId;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);

    // PCC-3458: resolve any branch ref to a branch matching the fixtures
    vi.mocked(branchService.getBranchByName).mockImplementation(
      (siteId: string, name: string) => Promise.resolve(branchForRef(siteId, name)),
    );

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
      DOCUMENT_STATE: makeDurableObjectNamespace(mockStub, mockId),
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      const body = await readJson(response);
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      const body = await readJson(response);
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(404);
    });

    it('should return 500 on database lookup error', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockRejectedValue(new Error('Database error'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      expect(mockStub.fetch).not.toHaveBeenCalled();
    });

    it('should let a user principal through without any status lookup', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, userContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(200);
      expect(vi.mocked(getAgentById)).not.toHaveBeenCalled();
      expect(mockStub.fetch).toHaveBeenCalled();
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(200);
    });

    it('should NOT call Durable Object when agent rejected', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      expect(mockStub.fetch).not.toHaveBeenCalled();
    });
  });

  describe('agent-edit-complete status enforcement', () => {
    it('should return 403 when the authenticated agent is suspended', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify({ editSessionId: 'session-123' }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
    });

    it('should return 403 when the authenticated agent is disabled', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('disabled'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify({ editSessionId: 'session-123' }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
    });

    it('should allow request when the authenticated agent is active', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('active'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify({ editSessionId: 'session-123' }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(200);
      expect(mockStub.fetch).toHaveBeenCalled();
    });

    it('checks the authenticated agent even when no X-Agent-Id header is present', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify({ editSessionId: 'session-123' }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      expect(vi.mocked(getAgentById)).toHaveBeenCalledWith('agent-123');
    });

    it('ignores a conflicting X-Agent-Id header and checks the authenticated agent', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended', 'header-agent'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            'X-Agent-Id': 'header-agent',
          },
          body: JSON.stringify({ editSessionId: 'session-123' }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      expect(vi.mocked(getAgentById)).toHaveBeenCalledWith('agent-123');
    });
  });

  describe('agent-edit-abort status enforcement', () => {
    it('should return 403 when the authenticated agent is suspended', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify({ editSessionId: 'session-123', reason: 'Agent was suspended' }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
    });

    it('checks the authenticated agent even when no X-Agent-Id header is present', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify({ editSessionId: 'session-123' }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      expect(vi.mocked(getAgentById)).toHaveBeenCalledWith('agent-123');
    });

    it('should allow request when the authenticated agent is active', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('active'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify({ editSessionId: 'session-123' }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should include CORS headers on 404 not found response', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(null);

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(404);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should include CORS headers on 500 error response', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockRejectedValue(new Error('Database error'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(500);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Status is checked against the authenticated agent, not a header', () => {
    it('uses the authenticated agent id even when a different X-Agent-Id is sent', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      vi.mocked(getAgentById).mockResolvedValue(createMockAgent('suspended', 'header-agent'));

      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

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
          body: JSON.stringify({}),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(403);
      expect(vi.mocked(getAgentById)).toHaveBeenCalledWith('agent-123');
    });
  });
});
