/**
 * Phase 7.3: Realtime API Agent Headers Integration - TDD Tests
 *
 * Tests for integrating X-Agent-* headers into the Realtime API endpoints.
 * Agents can provide context via headers in addition to request body params,
 * ensuring consistency with the REST API pattern.
 *
 * Headers supported:
 * - X-Agent-Id: agent UUID
 * - X-Agent-Trigger: human_requested | autonomous
 * - X-Agent-Requested-By: user UUID (when human_requested)
 * - X-Agent-Intent: description of what agent is doing
 * - X-Agent-Operation-Type: category
 * - X-Agent-Target-Regions: comma-separated JSON paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { AuthenticatedPrincipal } from '../../src/types';

// Phase 7.4: Mock the agent service for status validation
vi.mock('../../src/services/agent-service', () => ({
  getAgentById: vi.fn(),
}));

// Mock document service for database calls
vi.mock('../../src/services/document-service', () => ({
  getDocumentByPath: vi.fn(),
}));

// Mock authorization module for permission checks
vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

// Import mocked modules for test setup
import * as documentService from '../../src/services/document-service';
import { hasPermission } from '../../src/auth/authorization';

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

const defaultPrincipal: AuthenticatedPrincipal = {
  id: 'test-actor',
  type: 'user',
  email: 'test@example.com',
  pantheonSiteRoles: { 'site-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'mock',
};
const defaultContext: RealtimeRouteContext = { principal: defaultPrincipal };

describe('Phase 7.3: Realtime API Agent Headers Integration', () => {
  let mockEnv: MockEnv;
  let mockStub: MockDurableObjectStub;
  let mockId: MockDurableObjectId;

  beforeEach(async () => {
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
      DOCUMENT_STATE: {
        idFromName: vi.fn().mockReturnValue(mockId),
        get: vi.fn().mockReturnValue(mockStub),
      },
      POSTGRES_CONNECTION_STRING: 'postgresql://test:test@localhost/test',
      CORS_ORIGINS: 'http://localhost:3000,http://localhost:8787',
    };
  });

  describe('CORS header allowlist', () => {
    it('should include X-Agent-* headers in Access-Control-Allow-Headers', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'http://localhost:3000',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'X-Agent-Id, X-Agent-Trigger',
          },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(204);
      const allowedHeaders = response.headers.get('Access-Control-Allow-Headers');
      expect(allowedHeaders).toBeDefined();
      expect(allowedHeaders).toContain('X-Agent-Id');
      expect(allowedHeaders).toContain('X-Agent-Trigger');
    });
  });

  describe('Headers-only agent context for /can-agent-edit', () => {
    it('should accept agent context from X-Agent-* headers only', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'agent-123',
            'X-Agent-Trigger': 'human_requested',
            'X-Agent-Requested-By': 'user-456',
            'X-Agent-Intent': 'Update page title',
            'X-Agent-Target-Regions': '/content/title, /content/description',
          },
          body: JSON.stringify({}), // Empty body - all context from headers
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      // Verify DO was called with merged context
      expect(mockStub.fetch).toHaveBeenCalled();
      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('agent-123');
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
            'X-Agent-Id': 'agent-123',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Reorganize content',
            'X-Agent-Target-Regions': '/a, /b, /c',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.targetRegions).toHaveLength(3);
      expect(body.targetRegions).toContain('/a');
      expect(body.targetRegions).toContain('/b');
      expect(body.targetRegions).toContain('/c');
    });

    it('should handle case-insensitive headers', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-id': 'agent-lowercase',
            'x-agent-trigger': 'autonomous',
            'x-agent-intent': 'Test case insensitivity',
            'x-agent-target-regions': '/test',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('agent-lowercase');
      expect(body.trigger).toBe('autonomous');
    });
  });

  describe('Body params override headers', () => {
    it('should use body param when both header and body provide agentId', async () => {
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
            agentId: 'body-agent', // Body takes precedence
            trigger: 'human_requested',
            intent: 'Body intent',
            targetRegions: ['/body/region'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('body-agent');
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
            'X-Agent-Id': 'agent-from-header',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Intent from header',
            'X-Agent-Target-Regions': '/header/region',
          },
          body: JSON.stringify({
            // Only override intent, use header values for the rest
            intent: 'Overridden intent from body',
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('agent-from-header');
      expect(body.trigger).toBe('autonomous');
      expect(body.intent).toBe('Overridden intent from body'); // Body overrides
      expect(body.targetRegions).toContain('/header/region'); // From header
    });
  });

  describe('Headers-only agent context for /agent-edit-start', () => {
    it('should accept agent context from headers for agent-edit-start', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'agent-start',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Starting autonomous work',
            'X-Agent-Target-Regions': '/content',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('agent-start');
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
            'X-Agent-Id': 'agent-123',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Refactoring content',
            'X-Agent-Operation-Type': 'content_update',
            'X-Agent-Target-Regions': '/content',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.operationType).toBe('content_update');
    });
  });

  describe('Validation with headers', () => {
    it('should return 400 when agentId is missing from both headers and body', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Trigger': 'autonomous',
          },
          body: JSON.stringify({
            trigger: 'autonomous',
            intent: 'Test',
            targetRegions: ['/test'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('agentId');
    });

    it('should return 400 when trigger is invalid', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'agent-123',
            'X-Agent-Trigger': 'invalid_trigger',
            'X-Agent-Intent': 'Test',
            'X-Agent-Target-Regions': '/test',
          },
          body: JSON.stringify({}),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('trigger');
    });

    it('should validate agentId length from header', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const longAgentId = 'a'.repeat(200); // Exceeds 128 char limit

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': longAgentId,
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Test',
            'X-Agent-Target-Regions': '/test',
          },
          body: JSON.stringify({}),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('agentId');
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
            'X-Agent-Id': 'agent-123',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': longIntent,
            'X-Agent-Target-Regions': '/test',
          },
          body: JSON.stringify({}),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(400);
      const body = await response.json();
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
            'X-Agent-Id': 'agent-123',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Test',
            'X-Agent-Target-Regions': manyRegions,
          },
          body: JSON.stringify({}),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);
      const response = assertNotNull(result);

      expect(response.status).toBe(400);
      const body = await response.json();
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
            'X-Agent-Id': 'agent-123',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Test',
            'X-Agent-Target-Regions': '', // Empty
          },
          body: JSON.stringify({
            targetRegions: ['/from/body'], // Body provides regions
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      // Body regions should be used
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
            'X-Agent-Id': 'agent-123',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Test without regions header',
          },
          body: JSON.stringify({
            targetRegions: ['/body/region'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.targetRegions).toEqual(['/body/region']);
    });
  });

  describe('Backwards compatibility', () => {
    it('should still work with body-only requests (no headers)', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // No X-Agent-* headers
          },
          body: JSON.stringify({
            agentId: 'body-only-agent',
            trigger: 'autonomous',
            intent: 'Body-only request',
            targetRegions: ['/body'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();

      expect(body.agentId).toBe('body-only-agent');
      expect(body.trigger).toBe('autonomous');
      expect(body.intent).toBe('Body-only request');
    });
  });

  describe('Forward headers to Durable Object', () => {
    it('should forward X-Agent-* headers to Durable Object', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'agent-for-do',
            'X-Agent-Trigger': 'autonomous',
            'X-Agent-Intent': 'Test header forwarding',
            'X-Agent-Target-Regions': '/test',
            'X-Agent-Operation-Type': 'test_operation',
          },
          body: JSON.stringify({}),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;

      // Headers should be forwarded
      expect(fetchedRequest.headers.get('X-Agent-Id')).toBe('agent-for-do');
      expect(fetchedRequest.headers.get('X-Agent-Trigger')).toBe('autonomous');
      expect(fetchedRequest.headers.get('X-Agent-Intent')).toBe('Test header forwarding');
      expect(fetchedRequest.headers.get('X-Agent-Operation-Type')).toBe('test_operation');
    });
  });

  describe('/edits endpoint header support', () => {
    it('should pass X-Agent-* headers through for /edits endpoint', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const editorContext: RealtimeRouteContext = {
        principal: { ...defaultPrincipal, id: 'agent-editor' },
      };

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-editor',
            'X-Actor-Type': 'agent',
            'X-Agent-Id': 'agent-editor',
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

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;

      // Agent headers should be forwarded
      expect(fetchedRequest.headers.get('X-Agent-Id')).toBe('agent-editor');
      expect(fetchedRequest.headers.get('X-Agent-Trigger')).toBe('human_requested');
      expect(fetchedRequest.headers.get('X-Agent-Requested-By')).toBe('user-123');
    });
  });
});
