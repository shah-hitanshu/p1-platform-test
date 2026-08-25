/**
 * Agent Politeness System - Phase 2.4: Agent Edit Workflow API Routes (TDD)
 *
 * Tests for the agent edit workflow API endpoints.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 *
 * Routes:
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/can-agent-edit
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-edit-start
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-edit-complete
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-edit-abort
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
 * Avoids non-null assertions in tests.
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

// Mock environment
interface MockEnv {
  ENVIRONMENT: string;
  DOCUMENT_STATE: MockDurableObjectNamespace;
  POSTGRES_CONNECTION_STRING: string;
}

const defaultPrincipal: AuthenticatedPrincipal = {
  id: 'agent-123',
  type: 'agent',
  email: 'test@example.com',
  pantheonSiteRoles: { 'site-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'mock',
};
const defaultContext: RealtimeRouteContext = { principal: defaultPrincipal };

describe('Agent Politeness Phase 2.4: Agent Edit Workflow API Routes', () => {
  let mockEnv: MockEnv;
  let mockStub: MockDurableObjectStub;
  let mockId: MockDurableObjectId;

  beforeEach(async () => {
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

    // Phase 7.4: Set up agent service mock to return active agent
    const { getAgentById } = await import('../../src/services/agent-service');
    vi.mocked(getAgentById).mockImplementation((agentId: string) => {
      return Promise.resolve(createMockActiveAgent(agentId));
    });

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
      DOCUMENT_STATE: makeDurableObjectNamespace(mockStub, mockId),
      POSTGRES_CONNECTION_STRING: 'postgresql://test:test@localhost/test',
    };
  });

  describe('POST /can-agent-edit', () => {
    describe('Route matching', () => {
      it('should match POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/can-agent-edit', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-123/branches/branch-456/documents/pages/home/can-agent-edit',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              intent: 'Optimization',
              targetRegions: ['/content/0'],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        expect(result).not.toBeNull();
        expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalled();
      });

      it('should return null for non-matching routes', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-123/can-agent-edit',
          { method: 'POST' },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        expect(result).toBeNull();
      });
    });

    describe('Request forwarding', () => {
      it('should forward request to /can-agent-edit endpoint on DO', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              intent: 'Test',
              targetRegions: [],
            }),
          },
        );

        await handleRealtimeRoutes(request, mockEnv, defaultContext);

        expect(mockStub.fetch).toHaveBeenCalled();
        const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
        expect(new URL(fetchedRequest.url).pathname).toBe('/can-agent-edit');
      });

      it('should forward request body to DO', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const requestBody = {
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Optimization',
          targetRegions: ['/content/0', '/content/1'],
        };

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify(requestBody),
          },
        );

        await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
        const body = await fetchedRequest.json();
        expect(body).toEqual(requestBody);
      });

      it('should forward actor headers to DO', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const agent789Context: RealtimeRouteContext = {
          principal: { ...defaultPrincipal, id: 'agent-789' },
        };
        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-789',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              agentId: 'agent-789',
              trigger: 'autonomous',
              intent: 'Test',
              targetRegions: [],
            }),
          },
        );

        await handleRealtimeRoutes(request, mockEnv, agent789Context);

        const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
        expect(fetchedRequest.headers.get('X-Actor-Id')).toBe('agent-789');
        expect(fetchedRequest.headers.get('X-Actor-Type')).toBe('agent');
      });
    });

    describe('Response handling', () => {
      it('should return allowed response from DO', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(JSON.stringify({ allowed: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'human_requested',
              intent: 'User help',
              targetRegions: [],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        const body = await readJson(response);
        expect(body.allowed).toBe(true);
      });

      it('should return denied response with reason', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              allowed: false,
              reason: 'human_active',
              retryAfterMs: 5000,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              intent: 'Optimization',
              targetRegions: [],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        const body = await readJson(response);
        expect(body.allowed).toBe(false);
        expect(body.reason).toBe('human_active');
        expect(body.retryAfterMs).toBe(5000);
      });

      it('should return denied response with conflicting regions', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              allowed: false,
              reason: 'region_conflict',
              conflictingRegions: ['/content/0'],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              intent: 'Optimization',
              targetRegions: ['/content/0'],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        const body = await readJson(response);
        expect(body.allowed).toBe(false);
        expect(body.reason).toBe('region_conflict');
        expect(body.conflictingRegions).toContain('/content/0');
      });
    });

    describe('Validation', () => {
      it('should require trigger in request body', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              intent: 'Test',
              targetRegions: [],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(400);
        const body = await readJson(response);
        expect(body.error).toContain('trigger');
      });

      it('should require intent in request body', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              targetRegions: [],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(400);
        const body = await readJson(response);
        expect(body.error).toContain('intent');
      });

      it('should require targetRegions in request body', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              intent: 'Test',
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(400);
        const body = await readJson(response);
        expect(body.error).toContain('targetRegions');
      });

      it('should validate trigger is valid enum value', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'invalid_trigger',
              intent: 'Test',
              targetRegions: [],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(400);
        const body = await readJson(response);
        expect(body.error).toContain('trigger');
      });
    });
  });

  describe('POST /agent-edit-start', () => {
    describe('Route matching', () => {
      it('should match POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-edit-start', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-123/branches/branch-456/documents/pages/home/agent-edit-start',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              intent: 'Optimization',
              targetRegions: ['/content/0'],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        expect(result).not.toBeNull();
        expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalled();
      });
    });

    describe('Request forwarding', () => {
      it('should forward request to /agent-edit-start endpoint on DO', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              intent: 'Test',
              targetRegions: [],
            }),
          },
        );

        await handleRealtimeRoutes(request, mockEnv, defaultContext);

        expect(mockStub.fetch).toHaveBeenCalled();
        const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
        expect(new URL(fetchedRequest.url).pathname).toBe('/agent-edit-start');
      });

      it('should forward request body with all fields', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const requestBody = {
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Content optimization',
          targetRegions: ['/content/0', '/content/1'],
          operationType: 'update',
        };

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify(requestBody),
          },
        );

        await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
        const body = await fetchedRequest.json();
        expect(body).toEqual(requestBody);
      });
    });

    describe('Response handling', () => {
      it('should return edit session ID for autonomous work', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              success: true,
              editSessionId: 'edit-session-123',
              checkpointId: 'checkpoint-456',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              intent: 'Optimization',
              targetRegions: [],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        const body = await readJson(response);
        expect(body.success).toBe(true);
        expect(body.editSessionId).toBe('edit-session-123');
        expect(body.checkpointId).toBe('checkpoint-456');
      });

      it('should return edit session without checkpoint for human-requested work', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              success: true,
              editSessionId: 'edit-session-789',
              // No checkpointId for human-requested
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'human_requested',
              intent: 'User help',
              targetRegions: [],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        const body = await readJson(response);
        expect(body.success).toBe(true);
        expect(body.editSessionId).toBe('edit-session-789');
        expect(body.checkpointId).toBeUndefined();
      });

      it('should return error if agent not allowed to edit', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              success: false,
              error: 'Agent not allowed to edit',
              reason: 'human_active',
            }),
            {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              trigger: 'autonomous',
              intent: 'Optimization',
              targetRegions: [],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(403);
        const body = await readJson(response);
        expect(body.success).toBe(false);
        expect(body.reason).toBe('human_active');
      });
    });

    describe('Validation', () => {
      it('should require trigger in request body', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: 'agent-123',
              intent: 'Test',
              targetRegions: [],
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(400);
      });
    });
  });

  describe('POST /agent-edit-complete', () => {
    describe('Route matching', () => {
      it('should match POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-edit-complete', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-123/branches/branch-456/documents/pages/home/agent-edit-complete',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              editSessionId: 'edit-session-123',
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        expect(result).not.toBeNull();
        expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalled();
      });
    });

    describe('Request forwarding', () => {
      it('should forward request to /agent-edit-complete endpoint on DO', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              editSessionId: 'edit-session-123',
            }),
          },
        );

        await handleRealtimeRoutes(request, mockEnv, defaultContext);

        expect(mockStub.fetch).toHaveBeenCalled();
        const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
        expect(new URL(fetchedRequest.url).pathname).toBe('/agent-edit-complete');
      });

      it('should forward editSessionId in request body', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              editSessionId: 'edit-session-456',
            }),
          },
        );

        await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
        const body = await fetchedRequest.json();
        expect(body.editSessionId).toBe('edit-session-456');
      });
    });

    describe('Response handling', () => {
      it('should return success on completion', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              success: true,
              regionsCleared: ['/content/0'],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              editSessionId: 'edit-session-123',
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        const body = await readJson(response);
        expect(body.success).toBe(true);
        expect(body.regionsCleared).toContain('/content/0');
      });

      it('should return error for invalid edit session', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              success: false,
              error: 'Edit session not found',
            }),
            {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              editSessionId: 'invalid-session',
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(404);
        const body = await readJson(response);
        expect(body.success).toBe(false);
      });
    });

    describe('Validation', () => {
      it('should require editSessionId in request body', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-complete',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(400);
        const body = await readJson(response);
        expect(body.error).toContain('editSessionId');
      });
    });
  });

  describe('POST /agent-edit-abort', () => {
    describe('Route matching', () => {
      it('should match POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-edit-abort', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-123/branches/branch-456/documents/pages/home/agent-edit-abort',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              editSessionId: 'edit-session-123',
              reason: 'conflict_detected',
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        expect(result).not.toBeNull();
        expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalled();
      });
    });

    describe('Request forwarding', () => {
      it('should forward request to /agent-edit-abort endpoint on DO', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify({
              editSessionId: 'edit-session-123',
              reason: 'conflict_detected',
            }),
          },
        );

        await handleRealtimeRoutes(request, mockEnv, defaultContext);

        expect(mockStub.fetch).toHaveBeenCalled();
        const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
        expect(new URL(fetchedRequest.url).pathname).toBe('/agent-edit-abort');
      });

      it('should forward request body with editSessionId and reason', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const requestBody = {
          editSessionId: 'edit-session-123',
          reason: 'conflict_detected',
        };

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Actor-Id': 'agent-123',
              'X-Actor-Type': 'agent',
            },
            body: JSON.stringify(requestBody),
          },
        );

        await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const fetchedRequest = mockStub.fetch.mock.calls[0][0] as Request;
        const body = await fetchedRequest.json();
        expect(body).toEqual(requestBody);
      });
    });

    describe('Response handling', () => {
      it('should return success on abort with rollback', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              success: true,
              rolledBackToCheckpoint: 'checkpoint-456',
              regionsCleared: ['/content/0'],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              editSessionId: 'edit-session-123',
              reason: 'conflict_detected',
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        const body = await readJson(response);
        expect(body.success).toBe(true);
        expect(body.rolledBackToCheckpoint).toBe('checkpoint-456');
        expect(body.regionsCleared).toContain('/content/0');
      });

      it('should return success without rollback for human-requested work', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              success: true,
              regionsCleared: ['/content/0'],
              // No rolledBackToCheckpoint for human-requested
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              editSessionId: 'edit-session-789',
              reason: 'user_cancelled',
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        const body = await readJson(response);
        expect(body.success).toBe(true);
        expect(body.rolledBackToCheckpoint).toBeUndefined();
      });

      it('should return error for invalid edit session', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              success: false,
              error: 'Edit session not found',
            }),
            {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              editSessionId: 'invalid-session',
              reason: 'conflict_detected',
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(404);
      });
    });

    describe('Validation', () => {
      it('should require editSessionId in request body', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reason: 'conflict_detected',
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        expect(response.status).toBe(400);
        const body = await readJson(response);
        expect(body.error).toContain('editSessionId');
      });

      it('should allow optional reason in request body', async () => {
        const { handleRealtimeRoutes } = await import(
          '../../src/routes/realtime-api'
        );

        mockStub.fetch.mockResolvedValue(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        const request = new Request(
          'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-abort',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              editSessionId: 'edit-session-123',
              // reason is optional
            }),
          },
        );

        const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

        const response = assertNotNull(result);
        // Should not return 400 for missing reason
        expect(response.status).not.toBe(400);
      });
    });
  });

  describe('Error handling', () => {
    it('should handle DO unavailable gracefully', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      mockStub.fetch.mockRejectedValue(new Error('Durable Object unavailable'));

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Test',
            targetRegions: [],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const response = assertNotNull(result);
      expect(response.status).toBe(503);
    });

    it('should handle invalid JSON body', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not valid json',
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const response = assertNotNull(result);
      expect(response.status).toBe(400);
    });

    it('should return 415 for unsupported Content-Type', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: 'test',
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const response = assertNotNull(result);
      expect(response.status).toBe(415);
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in agent edit responses', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Test',
            targetRegions: [],
          }),
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const response = assertNotNull(result);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
    });

    it('should handle OPTIONS preflight for agent edit routes', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-edit-start',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://app.example.com',
            'Access-Control-Request-Method': 'POST',
          },
        },
      );

      const result = await handleRealtimeRoutes(request, mockEnv, defaultContext);

      const response = assertNotNull(result);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
    });
  });

  describe('Session ID generation', () => {
    it('should use consistent session ID for agent edit routes', async () => {
      const { handleRealtimeRoutes } = await import(
        '../../src/routes/realtime-api'
      );

      const request = new Request(
        'https://example.com/api/sites/site-abc/branches/branch-xyz/documents/pages/home/can-agent-edit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'autonomous',
            intent: 'Test',
            targetRegions: [],
          }),
        },
      );

      await handleRealtimeRoutes(request, mockEnv, defaultContext);

      // Session ID uses document UUID (from mock) instead of path
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
        'site-abc:mock-document-uuid:branch-xyz',
      );
    });
  });
});
