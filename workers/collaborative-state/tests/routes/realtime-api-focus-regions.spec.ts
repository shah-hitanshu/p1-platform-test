/**
 * Real-Time API Routes - Focus Regions Endpoint Tests (TDD)
 *
 * Tests for the focus-regions route that allows humans to proactively
 * report their current component selection.
 *
 * POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/focus-regions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

// Import mocked module for test setup
import * as documentService from '../../src/services/document-service';
import * as branchService from '../../src/services/branch-service';
import { hasPermission } from '../../src/auth/authorization';
import type { RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { AuthenticatedPrincipal, Branch } from '../../src/types';
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

// Mock types for Cloudflare Durable Objects
interface MockDurableObjectId {
  toString: () => string;
}

// Mock environment
interface MockEnv {
  ENVIRONMENT: string;
  DOCUMENT_STATE: MockDurableObjectNamespace;
  POSTGRES_CONNECTION_STRING: string;
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

describe('Real-Time API: Focus Regions Endpoint', () => {
  let mockEnv: MockEnv;
  let mockStub: MockDurableObjectStub;
  let mockId: MockDurableObjectId;

  beforeEach(() => {
    // Reset all mocks
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

    // Create mock Durable Object infrastructure
    mockStub = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, focusRegions: ['/content/0'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    };

    mockId = { toString: (): string => 'mock-do-id' };

    mockEnv = {
      ENVIRONMENT: 'test',
      DOCUMENT_STATE: makeDurableObjectNamespace(mockStub, mockId),
      POSTGRES_CONNECTION_STRING: 'postgresql://localhost:5432/test',
    };
  });

  describe('route matching', () => {
    it('should match POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/focus-regions', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            actorId: 'user-123',
            focusRegions: ['/content/0'],
          }),
        },
      );

      const response = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
    });

    it('should require POST method for focus-regions', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'GET',
          headers: {
            'X-Actor-Type': 'user',
          },
        },
      );

      const response = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(405);
    });
  });

  describe('request validation', () => {
    it('should require X-Actor-Type: user header', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'agent', // Wrong type
          },
          body: JSON.stringify({
            actorId: 'agent-123',
            focusRegions: ['/content/0'],
          }),
        },
      );

      const response = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(403);
      const body = await response?.json();
      expect(body.error).toContain('user');
    });

    it('should require Content-Type: application/json', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'X-Actor-Type': 'user',
          },
          body: 'not json',
        },
      );

      const response = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(415);
    });

    it('should require actorId field', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            focusRegions: ['/content/0'],
          }),
        },
      );

      const response = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(400);
      const body = await response?.json();
      expect(body.error).toContain('actorId');
    });

    it('should require focusRegions field', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            actorId: 'user-123',
          }),
        },
      );

      const response = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(400);
      const body = await response?.json();
      expect(body.error).toContain('focusRegions');
    });

    it('should limit focusRegions to maximum 50', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const tooManyRegions = Array.from(
        { length: 100 },
        (_, i) => `/content/${String(i)}`,
      );

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            actorId: 'user-123',
            focusRegions: tooManyRegions,
          }),
        },
      );

      const response = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(400);
      const body = await response?.json();
      expect(body.error).toContain('50');
    });
  });

  describe('forwarding to Durable Object', () => {
    it('should forward valid request to DocumentSession DO', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            actorId: 'user-123',
            focusRegions: ['/content/0', '/content/1'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      // Verify DO was called
      expect(mockStub.fetch).toHaveBeenCalled();

      // Check the forwarded request
      const forwardedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      expect(forwardedRequest.url).toContain('/update-focus-regions');
    });

    it('should include original headers when forwarding', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const userContext: RealtimeRouteContext = { principal: { ...defaultPrincipal, id: 'user-123' } };

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
            'X-Actor-Id': 'user-123',
          },
          body: JSON.stringify({
            actorId: 'user-123',
            focusRegions: ['/content/0'],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, userContext);

      const forwardedRequest = mockStub.fetch.mock.calls[0][0] as Request;
      expect(forwardedRequest.headers.get('X-Actor-Type')).toBe('user');
    });

    it('should return response from DO', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      mockStub.fetch.mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          focusRegions: ['/content/0', '/content/1'],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            actorId: 'user-123',
            focusRegions: ['/content/0', '/content/1'],
          }),
        },
      );

      const response = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(response?.status).toBe(200);
      const body = await response?.json();
      expect(body.success).toBe(true);
      expect(body.focusRegions).toContain('/content/0');
    });
  });

  describe('CORS support', () => {
    it('should handle OPTIONS preflight for focus-regions', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/main/documents/test-doc/focus-regions',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'http://localhost:3000',
          },
        },
      );

      const response = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(204);
      expect(response?.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });
  });
});
