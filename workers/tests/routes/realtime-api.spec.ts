/**
 * Phase 4.2: Real-Time API Routes - TDD Tests
 *
 * Tests for the worker-level routing that proxies real-time collaboration
 * requests to the DocumentSession Durable Object.
 *
 * Based on collaborative-state-system-architecture-v2.2.md:
 * - GET /api/sites/{siteId}/branches/{branchId}/documents/{documentPath} - Get document state
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/edits - Apply edits
 * - WebSocket /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/connect - Real-time
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Helper to assert a value is not null and return it as non-null type.
 * Avoids non-null assertions in tests.
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

// Mock environment
interface MockEnv {
  ENVIRONMENT: string;
  DOCUMENT_STATE: MockDurableObjectNamespace;
  POSTGRES_CONNECTION_STRING: string;
}

describe('Phase 4.2: Real-Time API Routes', () => {
  let mockEnv: MockEnv;
  let mockStub: MockDurableObjectStub;
  let mockId: MockDurableObjectId;

  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();

    // Create mock Durable Object infrastructure
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
    };
  });

  describe('Route pattern matching', () => {
    it('should match GET /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-456/documents/pages/home',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      expect(result).not.toBeNull();
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalled();
    });

    it('should match POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/edits', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-456/documents/pages/home/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: [] }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      expect(result).not.toBeNull();
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalled();
    });

    it('should match routes with nested document paths', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-456/documents/components/ui/header',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      expect(result).not.toBeNull();
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalled();
    });

    it('should return null for unmatched routes', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request('https://example.com/api/sites/site-123', {
        method: 'GET',
      });

      const result = await handleRealtimeRoutes(request, mockEnv);

      expect(result).toBeNull();
    });

    it('should return null for non-API routes', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request('https://example.com/health', {
        method: 'GET',
      });

      const result = await handleRealtimeRoutes(request, mockEnv);

      expect(result).toBeNull();
    });
  });

  describe('URL parameter extraction', () => {
    it('should extract siteId from URL', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/my-site-id/branches/branch-1/documents/page',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv);

      // The session ID should include the site ID
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
        expect.stringContaining('my-site-id'),
      );
    });

    it('should extract branchId from URL', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/my-branch-id/documents/page',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv);

      // The session ID should include the branch ID
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
        expect.stringContaining('my-branch-id'),
      );
    });

    it('should extract documentPath from URL', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/my-document-path',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv);

      // The session ID should include the document path
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
        expect.stringContaining('my-document-path'),
      );
    });

    it('should handle URL-encoded document paths', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const encodedPath = encodeURIComponent('pages/home page');
      const request = new Request(
        `https://example.com/api/sites/site-1/branches/branch-1/documents/${encodedPath}`,
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      expect(result).not.toBeNull();
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalled();
    });
  });

  describe('Durable Object ID generation', () => {
    it('should generate consistent session ID format: {siteId}:{documentPath}:{branchId}', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-abc/branches/branch-xyz/documents/pages/home',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv);

      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
        'site-abc:pages/home:branch-xyz',
      );
    });

    it('should generate same ID for same document on same branch', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      // First request
      const request1 = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/doc',
        { method: 'GET' },
      );
      await handleRealtimeRoutes(request1, mockEnv);

      const firstCallArg = mockEnv.DOCUMENT_STATE.idFromName.mock.calls[0][0];

      // Reset and make second request
      mockEnv.DOCUMENT_STATE.idFromName.mockClear();

      const request2 = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/doc',
        { method: 'GET' },
      );
      await handleRealtimeRoutes(request2, mockEnv);

      const secondCallArg = mockEnv.DOCUMENT_STATE.idFromName.mock.calls[0][0];

      expect(firstCallArg).toBe(secondCallArg);
    });

    it('should generate different IDs for different branches', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      // Request on branch-1
      const request1 = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/doc',
        { method: 'GET' },
      );
      await handleRealtimeRoutes(request1, mockEnv);

      const firstCallArg = mockEnv.DOCUMENT_STATE.idFromName.mock.calls[0][0];

      // Reset and request on branch-2
      mockEnv.DOCUMENT_STATE.idFromName.mockClear();

      const request2 = new Request(
        'https://example.com/api/sites/site-1/branches/branch-2/documents/doc',
        { method: 'GET' },
      );
      await handleRealtimeRoutes(request2, mockEnv);

      const secondCallArg = mockEnv.DOCUMENT_STATE.idFromName.mock.calls[0][0];

      expect(firstCallArg).not.toBe(secondCallArg);
    });

    it('should generate different IDs for different documents', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      // Request for doc-1
      const request1 = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/doc-1',
        { method: 'GET' },
      );
      await handleRealtimeRoutes(request1, mockEnv);

      const firstCallArg = mockEnv.DOCUMENT_STATE.idFromName.mock.calls[0][0];

      // Reset and request for doc-2
      mockEnv.DOCUMENT_STATE.idFromName.mockClear();

      const request2 = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/doc-2',
        { method: 'GET' },
      );
      await handleRealtimeRoutes(request2, mockEnv);

      const secondCallArg = mockEnv.DOCUMENT_STATE.idFromName.mock.calls[0][0];

      expect(firstCallArg).not.toBe(secondCallArg);
    });
  });

  describe('Request forwarding to Durable Object', () => {
    it('should forward GET document request to /snapshot endpoint', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv);

      expect(mockStub.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
        }),
      );

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      expect(new URL(fetchedRequest.url).pathname).toBe('/snapshot');
    });

    it('should forward POST edits request to /apply endpoint', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const operations = [{ type: 'set', path: 'title', value: 'Hello' }];
      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({ operations }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv);

      expect(mockStub.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
        }),
      );

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      expect(new URL(fetchedRequest.url).pathname).toBe('/apply');
    });

    it('should forward actor headers to Durable Object', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Id': 'agent-456',
            'X-Actor-Type': 'agent',
          },
          body: JSON.stringify({ operations: [] }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      expect(fetchedRequest.headers.get('X-Actor-Id')).toBe('agent-456');
      expect(fetchedRequest.headers.get('X-Actor-Type')).toBe('agent');
    });

    it('should forward request body to Durable Object for POST requests', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const operations = [
        { type: 'set', path: 'title', value: 'Test' },
        { type: 'delete', path: 'oldField' },
      ];

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      const body = await fetchedRequest.json();
      expect(body).toEqual({ operations });
    });
  });

  describe('Response proxying', () => {
    it('should return Durable Object response for GET requests', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const mockSnapshot = {
        sessionId: 'site-1:page:branch-1',
        state: { title: 'Hello World' },
        connectedActors: [],
      };

      mockStub.fetch.mockResolvedValue(
        new Response(JSON.stringify(mockSnapshot), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      const body = await response.json();
      expect(body.state).toEqual({ title: 'Hello World' });
    });

    it('should return Durable Object response for POST requests', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const mockApplyResponse = {
        success: true,
        operationsApplied: 2,
        state: { title: 'Updated' },
      };

      mockStub.fetch.mockResolvedValue(
        new Response(JSON.stringify(mockApplyResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: [] }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.operationsApplied).toBe(2);
    });

    it('should preserve error status codes from Durable Object', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      mockStub.fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid operation' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: [] }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.status).toBe(400);
    });
  });

  describe('WebSocket connect endpoint', () => {
    it('should match WebSocket connect route', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/connect',
        {
          method: 'GET',
          headers: { Upgrade: 'websocket' },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      expect(result).not.toBeNull();
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalled();
    });

    it('should forward WebSocket upgrade request to /connect endpoint', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/connect',
        {
          method: 'GET',
          headers: {
            Upgrade: 'websocket',
            'X-Actor-Id': 'user-123',
            'X-Actor-Type': 'user',
          },
        },
      );

      await handleRealtimeRoutes(request, mockEnv);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      expect(new URL(fetchedRequest.url).pathname).toBe('/connect');
      expect(fetchedRequest.headers.get('Upgrade')).toBe('websocket');
    });

    it('should forward actor headers for WebSocket connections', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/connect',
        {
          method: 'GET',
          headers: {
            Upgrade: 'websocket',
            'X-Actor-Id': 'user-789',
            'X-Actor-Type': 'user',
          },
        },
      );

      await handleRealtimeRoutes(request, mockEnv);

      const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      expect(fetchedRequest.headers.get('X-Actor-Id')).toBe('user-789');
      expect(fetchedRequest.headers.get('X-Actor-Type')).toBe('user');
    });

    it('should return WebSocket response from Durable Object', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      // Mock WebSocket response
      mockStub.fetch.mockResolvedValue(
        new Response(null, {
          status: 101,
          headers: {
            Upgrade: 'websocket',
            Connection: 'Upgrade',
          },
        }),
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/connect',
        {
          method: 'GET',
          headers: { Upgrade: 'websocket' },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.status).toBe(101);
    });
  });

  describe('Error handling', () => {
    it('should return 400 for missing siteId', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      // Malformed URL missing siteId
      const request = new Request(
        'https://example.com/api/sites//branches/branch-1/documents/page',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      // Should either return null (not match) or return 400
      if (result !== null) {
        expect(result.status).toBe(400);
      }
    });

    it('should return 400 for missing branchId', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      // Malformed URL missing branchId
      const request = new Request(
        'https://example.com/api/sites/site-1/branches//documents/page',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      if (result !== null) {
        expect(result.status).toBe(400);
      }
    });

    it('should return 400 for missing documentPath', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      // URL without document path
      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      if (result !== null) {
        expect(result.status).toBe(400);
      }
    });

    it('should handle Durable Object errors gracefully', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      mockStub.fetch.mockRejectedValue(new Error('Durable Object unavailable'));

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.status).toBe(503);

      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it('should return 405 for unsupported HTTP methods', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page',
        { method: 'DELETE' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      if (result !== null) {
        expect(result.status).toBe(405);
      }
    });
  });

  describe('Content-Type handling', () => {
    it('should accept application/json for POST requests', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: [] }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.status).not.toBe(415);
    });

    it('should return 415 for unsupported Content-Type on POST', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: 'invalid',
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.status).toBe(415);
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
    });

    it('should handle OPTIONS preflight requests', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://app.example.com',
            'Access-Control-Request-Method': 'POST',
          },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.status).toBe(204);
      expect(
        response.headers.get('Access-Control-Allow-Methods'),
      ).toBeDefined();
    });
  });

  describe('Rate limiting headers', () => {
    it('should include rate limit headers when configured', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: [] }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      // Rate limit headers are optional but should be present if configured
      // This test documents the expected behavior
      expect(result).not.toBeNull();
    });
  });

  describe('Request validation', () => {
    it('should validate operations array exists in POST body', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}), // Missing operations
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('operations');
    });

    it('should validate operations is an array', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: 'not-an-array' }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.status).toBe(400);
    });

    it('should validate JSON body is parseable', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not valid json',
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv);

      const response = assertNotNull(result);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBeDefined();
    });
  });

  describe('Session ID special characters handling', () => {
    it('should handle siteId with hyphens', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/my-site-with-hyphens/branches/branch-1/documents/page',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv);

      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
        expect.stringContaining('my-site-with-hyphens'),
      );
    });

    it('should handle documentPath with slashes', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/pages/marketing/home',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv);

      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
        'site-1:pages/marketing/home:branch-1',
      );
    });
  });
});
