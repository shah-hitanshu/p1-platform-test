/**
 * Realtime API agent context integration.
 *
 * The acting agent's identity is derived from the verified credential on the
 * authenticated principal. Declarative context (trigger, intent, operation
 * type, target regions) arrives via X-Agent-* headers or body params, with
 * body params taking precedence. A caller-supplied X-Agent-Id is ignored for
 * identity and never reaches the Durable Object.
 *
 * Declarative headers:
 * - X-Agent-Trigger: human_requested | autonomous
 * - X-Agent-Requested-By: user UUID (when human_requested)
 * - X-Agent-Intent: description of what agent is doing
 * - X-Agent-Operation-Type: category
 * - X-Agent-Target-Regions: comma-separated JSON paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { AuthenticatedPrincipal, Branch } from '../../src/types';

// Phase 7.4: Mock the agent service for status validation
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

// Mock authorization module for permission checks
vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

// Import mocked modules for test setup
import * as documentService from '../../src/services/document-service';
import * as branchService from '../../src/services/branch-service';
import { hasPermission } from '../../src/auth/authorization';
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

/**
 * Helper to create a mock active agent for Phase 7.4 status validation
 */
function createMockActiveAgent(agentId: string): {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  capabilities: string[];
  status: 'active';
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: agentId,
    organizationId: 'org-1',
    name: 'Active Agent',
    description: 'Agent for testing',
    capabilities: ['content_edit'],
    status: 'active',
    settings: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
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

const agentPrincipal: AuthenticatedPrincipal = {
  id: 'agent-from-key',
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

describe('Realtime API agent context integration', () => {
  let mockEnv: MockEnv;
  let mockStub: MockDurableObjectStub;
  let mockId: MockDurableObjectId;

  beforeEach(async () => {
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

    // Phase 7.4: Set up agent service mock to return active agent
    const { getAgentById } = await import('../../src/services/agent-service');
    vi.mocked(getAgentById).mockImplementation((agentId: string) => {
      return Promise.resolve(createMockActiveAgent(agentId));
    });

    mockStub = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
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

  describe('CORS header allowlist', () => {
    it('allows declarative agent headers but not the identity header', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'http://localhost:3000',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'X-Agent-Trigger',
          },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(204);
      const allowedHeaders = response.headers.get('Access-Control-Allow-Headers');
      expect(allowedHeaders).toBeDefined();
      expect(allowedHeaders).toContain('X-Agent-Trigger');
      expect(allowedHeaders).not.toContain('X-Agent-Id');
    });
  });

  describe('Declarative agent context via X-Agent-* headers for /can-agent-edit', () => {
    it('derives identity from the key and takes declarative fields from headers', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'spoofed-agent',
            'X-Agent-Trigger': 'human_requested',
            'X-Agent-Requested-By': 'user-456',
            'X-Agent-Intent': 'Update page title',
            'X-Agent-Target-Regions': '/content/title, /content/description',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      expect(mockStub.fetch).toHaveBeenCalled();
      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('agent-from-key');
      expect(body.trigger).toBe('human_requested');
      expect(body.intent).toBe('Update page title');
      expect(body.targetRegions).toContain('/content/title');
      expect(body.targetRegions).toContain('/content/description');
    });

    it('should parse comma-separated X-Agent-Target-Regions', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Reorganize content',
            'X-Agent-Target-Regions': '/a, /b, /c',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.targetRegions).toHaveLength(3);
      expect(body.targetRegions).toContain('/a');
      expect(body.targetRegions).toContain('/b');
      expect(body.targetRegions).toContain('/c');
    });

    it('should handle case-insensitive declarative headers', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-trigger': 'autonomous',
            'x-agent-intent': 'Test case insensitivity',
            'x-agent-target-regions': '/test',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('agent-from-key');
      expect(body.trigger).toBe('autonomous');
    });
  });

  describe('Body params override headers for declarative fields', () => {
    it('uses body declarative params over headers; identity stays the key', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'header-agent',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Header intent',
            'X-Agent-Target-Regions': '/header/region',
          },
          body: JSON.stringify({
            agentId: 'body-agent',
            trigger: 'human_requested',
            intent: 'Body intent',
            targetRegions: ['/body/region'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('agent-from-key');
      expect(body.trigger).toBe('human_requested');
      expect(body.intent).toBe('Body intent');
      expect(body.targetRegions).toEqual(['/body/region']);
    });

    it('should merge headers with partial body params', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Header intent',
            'X-Agent-Target-Regions': '/header/region',
          },
          body: JSON.stringify({
            intent: 'Body intent',
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('agent-from-key');
      expect(body.trigger).toBe('autonomous');
      expect(body.intent).toBe('Body intent');
      expect(body.targetRegions).toEqual(['/header/region']);
    });
  });

  describe('Declarative agent context for /agent-edit-start', () => {
    it('derives identity from the key for agent-edit-start', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'spoofed-agent',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Starting autonomous work',
            'X-Agent-Target-Regions': '/content',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('agent-from-key');
      expect(body.trigger).toBe('autonomous');
      expect(body.intent).toBe('Starting autonomous work');
    });
  });

  describe('X-Agent-Operation-Type header', () => {
    it('should parse X-Agent-Operation-Type from headers', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Refactoring content',
            'X-Agent-Operation-Type': 'content_update',
            'X-Agent-Target-Regions': '/content',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.operationType).toBe('content_update');
    });
  });

  describe('Validation', () => {
    it('succeeds without an agentId in body or header when authenticated as an agent', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trigger: 'autonomous',
            intent: 'Test',
            targetRegions: ['/test'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();
      expect(body.agentId).toBe('agent-from-key');
    });

    it('should return 400 when trigger is invalid', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Trigger': 'invalid_trigger',
            'X-Agent-Intent': 'Test',
            'X-Agent-Target-Regions': '/test',
          },
          body: JSON.stringify({}),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('trigger');
    });

    it('should validate intent length from header', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const longIntent = 'a'.repeat(1100); // Exceeds 1000 char limit

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': longIntent,
            'X-Agent-Target-Regions': '/test',
          },
          body: JSON.stringify({}),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('intent');
    });

    it('should validate targetRegions count from header', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      // Create 110 regions (exceeds 100 limit)
      const manyRegions = Array.from({ length: 110 }, (_, i) => `/region${String(i)}`).join(',');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Test',
            'X-Agent-Target-Regions': manyRegions,
          },
          body: JSON.stringify({}),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, agentContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('targetRegions');
    });
  });

  describe('Empty targetRegions handling', () => {
    it('should handle empty X-Agent-Target-Regions header', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Test',
            'X-Agent-Target-Regions': '',
          },
          body: JSON.stringify({
            targetRegions: ['/from/body'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.targetRegions).toEqual(['/from/body']);
    });

    it('should handle missing X-Agent-Target-Regions header', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Test without regions header',
          },
          body: JSON.stringify({
            targetRegions: ['/body/region'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.targetRegions).toEqual(['/body/region']);
    });
  });

  describe('Identity is the verified key, not the caller', () => {
    const editBody = {
      trigger: 'autonomous',
      intent: 'Autonomous edit',
      targetRegions: ['/content'],
    };

    it('uses the authenticated agent id for agent-edit-start when no X-Agent-Id is sent', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editBody),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();
      expect(body.agentId).toBe('agent-from-key');
    });

    it('uses the authenticated agent id for can-agent-edit when no X-Agent-Id is sent', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editBody),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();
      expect(body.agentId).toBe('agent-from-key');
    });

    it('ignores a conflicting X-Agent-Id header and uses the key identity', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Agent-Id': 'agent-explicit' },
          body: JSON.stringify(editBody),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();
      expect(body.agentId).toBe('agent-from-key');
    });

    it('ignores an agentId body field and uses the key identity', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...editBody, agentId: 'body-agent' }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();
      expect(body.agentId).toBe('agent-from-key');
    });

    it('starts a session for a user principal without resolving an agent name', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editBody),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, userContext);
      const response = assertNotNull(result);
      expect(response.status).toBe(200);
      expect(mockStub.fetch).toHaveBeenCalled();
      expect(vi.mocked(getAgentById)).not.toHaveBeenCalled();
    });
  });

  describe('Forward headers to Durable Object', () => {
    const startBody = {
      trigger: 'autonomous',
      intent: 'Autonomous edit',
      targetRegions: ['/content'],
    };

    it('forwards declarative X-Agent-* headers and the key-derived agentId to the DO', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'spoofed-agent',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Test header forwarding',
            'X-Agent-Target-Regions': '/test',
            'X-Agent-Operation-Type': 'test_operation',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, agentContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      // Identity is the verified key regardless of the spoofed X-Agent-Id.
      expect(body.agentId).toBe('agent-from-key');
      expect(fetchedRequest.headers.get('X-Agent-Trigger')).toBe('autonomous');
      expect(fetchedRequest.headers.get('X-Agent-Intent')).toBe('Test header forwarding');
      expect(fetchedRequest.headers.get('X-Agent-Operation-Type')).toBe('test_operation');
    });

    it('forwards the acting user resolved for an agent principal', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const actingContext: RealtimeRouteContext = {
        principal: {
          ...agentPrincipal,
          actingUserId: 'auth0|ada',
          actingUserName: 'Ada Lovelace',
        },
      };

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(startBody),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, actingContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0]?.[0] as Request;
      expect(fetchedRequest.headers.get('X-Verified-Requested-By-Id')).toBe('auth0|ada');
      expect(fetchedRequest.headers.get('X-Verified-Requested-By-Name')).toBe('Ada Lovelace');
    });

    it('forwards no acting user for a principal that resolved none', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(startBody),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, userContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0]?.[0] as Request;
      expect(fetchedRequest.headers.get('X-Verified-Requested-By-Id')).toBeNull();
      expect(fetchedRequest.headers.get('X-Verified-Requested-By-Name')).toBeNull();
    });

    it('drops an inbound requested-by header the caller supplied', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Verified-Requested-By-Id': 'auth0|forged',
            'X-Verified-Requested-By-Name': 'Forged Requester',
          },
          body: JSON.stringify(startBody),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, userContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0]?.[0] as Request;
      expect(fetchedRequest.headers.get('X-Verified-Requested-By-Id')).toBeNull();
      expect(fetchedRequest.headers.get('X-Verified-Requested-By-Name')).toBeNull();
    });
  });

  describe('/edits endpoint header support', () => {
    it('should pass X-Agent-* headers through for /edits endpoint', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const editorContext: RealtimeRouteContext = {
        principal: { ...userPrincipal, id: 'agent-editor' },
      };

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-editor',
            'X-Actor-Type': 'agent',
            'X-Agent-Trigger': 'human_requested',
            'X-Agent-Requested-By': 'user-123',
            'X-Agent-Intent': 'Editing on behalf of user',
            'X-Agent-Target-Regions': '/content',
          },
          body: JSON.stringify({
            operations: [{ type: 'set', path: 'title', value: 'Updated' }],
            actorId: 'agent-editor',
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, editorContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0]?.[0] as Request;

      expect(fetchedRequest.headers.get('X-Agent-Trigger')).toBe('human_requested');
      expect(fetchedRequest.headers.get('X-Agent-Requested-By')).toBe('user-123');
    });
  });
});
