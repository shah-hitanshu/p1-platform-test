/**
 * Auth Phase 4: WebSocket Authentication & Authorization Integration Tests
 *
 * Tests for principal forwarding, authorization checks, verified header injection,
 * and sensitive data stripping in the realtime API routes.
 *
 * These tests verify that:
 * 1. The authenticated principal is forwarded to handleRealtimeRoutes via context
 * 2. Client-supplied actorId is cross-validated against the principal
 * 3. Authorization checks enforce correct permissions per action
 * 4. Verified headers are injected on forwarded requests to the DO
 * 5. Sensitive data (apiKey) is stripped before forwarding
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock document service for database calls
vi.mock('../../src/services/document-service', () => ({
  getDocumentByPath: vi.fn(),
}));

// Mock authorization service
vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn(),
}));

// Mock agent status middleware (existing behavior)
vi.mock('../../src/middleware/agent-status-middleware', () => ({
  checkAgentStatus: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Import mocked modules for test setup
import * as documentService from '../../src/services/document-service';
import * as authorization from '../../src/auth/authorization';
import type { AuthenticatedPrincipal } from '../../src/types';

/**
 * Helper to assert a value is not null, providing type narrowing for tests.
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
}

/**
 * Create a default authenticated principal for testing.
 */
function createTestPrincipal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    id: 'user-123',
    type: 'user',
    email: 'alice@example.com',
    pantheonSiteRoles: { 'site-123': 'admin' },
    tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
    authProvider: 'mock',
    ...overrides,
  };
}

describe('Auth Phase 4: WebSocket Authentication & Authorization', () => {
  let mockEnv: MockEnv;
  let mockStub: MockDurableObjectStub;
  let mockId: MockDurableObjectId;
  let lastForwardedRequest: Request | null;

  beforeEach(() => {
    vi.resetAllMocks();
    lastForwardedRequest = null;

    // Mock getDocumentByPath to return a document by default
    vi.mocked(documentService.getDocumentByPath).mockResolvedValue({
      id: 'mock-document-uuid',
      siteId: 'site-123',
      path: 'test-doc',
      createdAt: new Date().toISOString(),
      archivedAt: null,
    });

    // Mock hasPermission to allow by default
    vi.mocked(authorization.hasPermission).mockResolvedValue(true);

    // Create mock Durable Object infrastructure that captures forwarded requests
    mockStub = {
      fetch: vi.fn().mockImplementation((req: Request) => {
        lastForwardedRequest = req;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
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

  // ===========================================================================
  // Principal Forwarding
  // ===========================================================================

  describe('Principal forwarding', () => {
    it('should accept context parameter with principal', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(200);
    });

    it('should reject when client actorId does not match principal id', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ id: 'user-123' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        {
          method: 'GET',
          headers: { 'X-Actor-Id': 'impersonated-user' },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('does not match');
    });

    it('should allow when client actorId matches principal id', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ id: 'user-123' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        {
          method: 'GET',
          headers: { 'X-Actor-Id': 'user-123' },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(200);
    });

    it('should allow when client actorId matches providerSubjectId', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({
        id: 'uuidv5-derived-id',
        providerSubjectId: '110402054196644394871',
      });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        {
          method: 'GET',
          headers: { 'X-Actor-Id': '110402054196644394871' },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(200);
    });

    it('should reject when client actorId matches neither principal id nor providerSubjectId', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({
        id: 'uuidv5-derived-id',
        providerSubjectId: '110402054196644394871',
      });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        {
          method: 'GET',
          headers: { 'X-Actor-Id': 'completely-different-id' },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('does not match');
    });

    it('should default to principal id when no client actorId is provided', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ id: 'user-123' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(200);
      // The DO should have been called
      expect(mockStub.fetch).toHaveBeenCalled();
    });

    it('should cross-validate actorId in edits body against principal', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ id: 'user-123' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operations: [{ type: 'set', path: '/title', value: 'Hello' }],
            actorId: 'different-user',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('does not match');
    });

    it('should NOT cross-validate agentId on agent-stop (human stopping an agent)', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      // User is the caller, agentId is the TARGET being stopped
      const principal = createTestPrincipal({ id: 'user-123', type: 'user' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/agent-stop',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'target-agent-id',
            reason: 'Stop editing',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      // Should NOT be 403 for mismatched agentId (it's a target, not a caller)
      const response = assertNotNull(result);
      expect(response.status).not.toBe(403);
    });
  });

  // ===========================================================================
  // Authorization Checks
  // ===========================================================================

  describe('Authorization checks', () => {
    it('should return 403 when principal lacks canView for snapshot', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();
      vi.mocked(authorization.hasPermission).mockResolvedValue(false);

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('permission');
    });

    it('should return 403 when principal lacks canEditDocuments for edits', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();
      // Allow canView but deny canEditDocuments
      vi.mocked(authorization.hasPermission).mockImplementation(
        (_p, _s, _b, perm) => Promise.resolve(perm !== 'canEditDocuments'),
      );

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operations: [{ type: 'set', path: '/title', value: 'Hello' }],
            actorId: 'user-123',
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(403);
    });

    it('should return 403 when principal lacks canEditDocuments for agent-edit-start', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ type: 'agent', id: 'agent-123' });
      vi.mocked(authorization.hasPermission).mockResolvedValue(false);

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/agent-edit-start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Update content',
            targetRegions: ['/hero'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(403);
    });

    it('should check canView for focus-regions endpoint', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();
      vi.mocked(authorization.hasPermission).mockResolvedValue(false);

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            actorId: 'user-123',
            focusRegions: ['/hero'],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(403);
    });

    it('should allow request when principal has required permission', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();
      vi.mocked(authorization.hasPermission).mockResolvedValue(true);

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(200);
    });

    it('should call hasPermission with canView for GET snapshot', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      expect(authorization.hasPermission).toHaveBeenCalledWith(
        principal, 'site-123', 'branch-1', 'canView',
      );
    });

    it('should call hasPermission with canEditDocuments for POST edits', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/edits',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operations: [{ type: 'set', path: '/title', value: 'Hello' }],
            actorId: 'user-123',
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      expect(authorization.hasPermission).toHaveBeenCalledWith(
        principal, 'site-123', 'branch-1', 'canEditDocuments',
      );
    });

    it('should call hasPermission with canEditDocuments for agent-edit-complete', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ type: 'agent', id: 'agent-123' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/agent-edit-complete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editSessionId: 'session-123' }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      expect(authorization.hasPermission).toHaveBeenCalledWith(
        principal, 'site-123', 'branch-1', 'canEditDocuments',
      );
    });
  });

  // ===========================================================================
  // Verified Header Injection
  // ===========================================================================

  describe('Verified header injection', () => {
    it('should set X-Verified-Actor-Id on forwarded request', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ id: 'user-123' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      const forwarded = assertNotNull(lastForwardedRequest);
      expect(forwarded.headers.get('X-Verified-Actor-Id')).toBe('user-123');
    });

    it('should set X-Verified-Actor-Type on forwarded request', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ id: 'user-123', type: 'user' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      const forwarded = assertNotNull(lastForwardedRequest);
      expect(forwarded.headers.get('X-Verified-Actor-Type')).toBe('user');
    });

    it('should set X-Verified-Auth-Provider when authProvider is present', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ authProvider: 'google' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      const forwarded = assertNotNull(lastForwardedRequest);
      expect(forwarded.headers.get('X-Verified-Auth-Provider')).toBe('google');
    });

    it('should set X-Verified-Email when email is present', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ email: 'alice@example.com' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      const forwarded = assertNotNull(lastForwardedRequest);
      expect(forwarded.headers.get('X-Verified-Email')).toBe('alice@example.com');
    });

    it('should pass verified info via query params for WebSocket upgrade', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ id: 'user-123', type: 'user', authProvider: 'mock' });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/connect?actorId=user-123&actorType=user',
        {
          method: 'GET',
          headers: {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
          },
        },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      const forwarded = assertNotNull(lastForwardedRequest);
      const forwardedUrl = new URL(forwarded.url);
      expect(forwardedUrl.searchParams.get('_verifiedActorId')).toBe('user-123');
      expect(forwardedUrl.searchParams.get('_verifiedActorType')).toBe('user');
    });

    it('should not set X-Verified-Auth-Provider when not present on principal', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ authProvider: undefined });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      const forwarded = assertNotNull(lastForwardedRequest);
      expect(forwarded.headers.get('X-Verified-Auth-Provider')).toBeNull();
    });
  });

  // ===========================================================================
  // Sensitive Data Stripping
  // ===========================================================================

  describe('Sensitive data stripping', () => {
    it('should strip apiKey from query params before forwarding', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/connect?actorId=user-123&actorType=user&apiKey=secret-token-123',
        {
          method: 'GET',
          headers: {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
          },
        },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      const forwarded = assertNotNull(lastForwardedRequest);
      const forwardedUrl = new URL(forwarded.url);
      expect(forwardedUrl.searchParams.has('apiKey')).toBe(false);
    });

    it('should preserve other query params when stripping apiKey', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc/connect?actorId=user-123&actorType=user&apiKey=secret-token-123&custom=value',
        {
          method: 'GET',
          headers: {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
          },
        },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      const forwarded = assertNotNull(lastForwardedRequest);
      const forwardedUrl = new URL(forwarded.url);
      expect(forwardedUrl.searchParams.get('actorId')).toBe('user-123');
      expect(forwardedUrl.searchParams.get('custom')).toBe('value');
      expect(forwardedUrl.searchParams.has('apiKey')).toBe(false);
    });

    it('should strip apiKey from non-WebSocket requests too', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc?apiKey=secret-token-123',
        { method: 'GET' },
      );

      await handleRealtimeRoutes(request, mockEnv, { principal });

      const forwarded = assertNotNull(lastForwardedRequest);
      const forwardedUrl = new URL(forwarded.url);
      expect(forwardedUrl.searchParams.has('apiKey')).toBe(false);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge cases', () => {
    it('should handle agent principal type correctly', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({
        id: 'agent-123',
        type: 'agent',
        authProvider: 'mock',
      });

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(200);

      // Verified headers should use agent type
      const forwarded = assertNotNull(lastForwardedRequest);
      expect(forwarded.headers.get('X-Verified-Actor-Type')).toBe('agent');
    });

    it('should handle principal with empty pantheonSiteRoles', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal({ pantheonSiteRoles: {} });
      // hasPermission is still mocked to return true
      vi.mocked(authorization.hasPermission).mockResolvedValue(true);

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'GET' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(200);
    });

    it('should still return null for unmatched routes', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();

      const request = new Request('https://example.com/api/sites/site-123', {
        method: 'GET',
      });

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      expect(result).toBeNull();
    });

    it('should still handle OPTIONS preflight without context', async () => {
      const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
      const principal = createTestPrincipal();

      const request = new Request(
        'https://example.com/api/sites/site-123/branches/branch-1/documents/test-doc',
        { method: 'OPTIONS' },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, { principal });

      const response = assertNotNull(result);
      expect(response.status).toBe(204);
    });
  });
});
