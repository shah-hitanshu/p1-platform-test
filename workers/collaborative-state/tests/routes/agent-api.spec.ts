/**
 * Agent Politeness System - Phase 1.5: Agent API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for agent operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';

// Mock the services
vi.mock('../../src/services', () => ({
  createAgent: vi.fn(),
  getAgentById: vi.fn(),
  getAgentByName: vi.fn(),
  updateAgent: vi.fn(),
  updateAgentStatus: vi.fn(),
  deleteAgent: vi.fn(),
  listAgents: vi.fn(),
  getAgentsByOrganization: vi.fn(),
  getActiveAgentCount: vi.fn(),
  InvalidAgentParamsError: class InvalidAgentParamsError extends Error {
    override name = 'InvalidAgentParamsError';
  },
  DuplicateAgentNameError: class DuplicateAgentNameError extends Error {
    override name = 'DuplicateAgentNameError';
    constructor(
      public organizationId: string,
      public agentName: string,
    ) {
      super(`Agent "${agentName}" already exists in organization "${organizationId}".`);
    }
  },
  AgentOrganizationNotFoundError: class AgentOrganizationNotFoundError extends Error {
    override name = 'OrganizationNotFoundError';
    constructor(public organizationId: string) {
      super(`Organization "${organizationId}" not found.`);
    }
  },
  AgentNotFoundError: class AgentNotFoundError extends Error {
    override name = 'AgentNotFoundError';
    constructor(public agentId: string) {
      super(`Agent "${agentId}" not found.`);
    }
  },
}));

describe('Agent Politeness Phase 1.5: Agent API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // Helper to create mock agent
  function createMockAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'agent-uuid-123',
      organizationId: 'org-uuid-123',
      name: 'Test Agent',
      description: 'A test agent',
      capabilities: ['edit', 'create'],
      status: 'active',
      settings: {},
      createdAt: '2026-01-26T12:00:00.000Z',
      updatedAt: '2026-01-26T12:00:00.000Z',
      ...overrides,
    };
  }

  // ===========================================================================
  // POST /api/organizations/{orgId}/agents - Create Agent
  // ===========================================================================

  describe('POST /api/organizations/{orgId}/agents', () => {
    it('should create a new agent', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.createAgent).mockResolvedValueOnce(createMockAgent());

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Agent',
          description: 'A test agent',
          capabilities: ['edit', 'create'],
        }),
      });

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.id).toBe('agent-uuid-123');
      expect(body.name).toBe('Test Agent');
      expect(body.organizationId).toBe('org-uuid-123');
    });

    it('should return 400 for missing name', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('name');
    });

    it('should return 404 when organization not found', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.createAgent).mockRejectedValueOnce(
        new services.AgentOrganizationNotFoundError('non-existent-org'),
      );

      const request = new Request(
        'https://api.example.com/api/organizations/non-existent-org/agents',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test Agent' }),
        },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'non-existent-org',
      });

      expect(response.status).toBe(404);
    });

    it('should return 409 for duplicate agent name', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.createAgent).mockRejectedValueOnce(
        new services.DuplicateAgentNameError('org-uuid-123', 'Existing Agent'),
      );

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Existing Agent' }),
      });

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(409);
    });
  });

  // ===========================================================================
  // GET /api/organizations/{orgId}/agents - List Agents
  // ===========================================================================

  describe('GET /api/organizations/{orgId}/agents', () => {
    it('should list agents for organization', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentsByOrganization).mockResolvedValueOnce([
        createMockAgent({ id: 'agent-1', name: 'Agent One' }),
        createMockAgent({ id: 'agent-2', name: 'Agent Two' }),
      ]);

      const request = new Request('https://api.example.com/api/organizations/org-uuid-123/agents', {
        method: 'GET',
      });

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.agents).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentsByOrganization).mockResolvedValueOnce([
        createMockAgent({ id: 'agent-1', status: 'active' }),
      ]);

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents?status=active',
        { method: 'GET' },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
      });

      expect(response.status).toBe(200);
      expect(services.getAgentsByOrganization).toHaveBeenCalledWith('org-uuid-123', {
        status: 'active',
      });
    });
  });

  // ===========================================================================
  // GET /api/organizations/{orgId}/agents/{agentId} - Get Agent
  // ===========================================================================

  describe('GET /api/organizations/{orgId}/agents/{agentId}', () => {
    it('should return agent by ID', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(createMockAgent());

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123',
        { method: 'GET' },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'agent-uuid-123',
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.id).toBe('agent-uuid-123');
    });

    it('should return 404 for non-existent agent', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/non-existent',
        { method: 'GET' },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'non-existent',
      });

      expect(response.status).toBe(404);
    });

    it('should return 403 when agent belongs to different organization', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(
        createMockAgent({ organizationId: 'other-org' }),
      );

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123',
        { method: 'GET' },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'agent-uuid-123',
      });

      expect(response.status).toBe(403);
    });
  });

  // ===========================================================================
  // PATCH /api/organizations/{orgId}/agents/{agentId} - Update Agent
  // ===========================================================================

  describe('PATCH /api/organizations/{orgId}/agents/{agentId}', () => {
    it('should update agent name', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(createMockAgent());
      vi.mocked(services.updateAgent).mockResolvedValueOnce(
        createMockAgent({ name: 'Updated Agent' }),
      );

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated Agent' }),
        },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'agent-uuid-123',
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.name).toBe('Updated Agent');
    });

    it('should update agent capabilities', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(createMockAgent());
      vi.mocked(services.updateAgent).mockResolvedValueOnce(
        createMockAgent({ capabilities: ['edit', 'create', 'delete'] }),
      );

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capabilities: ['edit', 'create', 'delete'] }),
        },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'agent-uuid-123',
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.capabilities).toEqual(['edit', 'create', 'delete']);
    });

    it('should return 404 for non-existent agent', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/non-existent',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Name' }),
        },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'non-existent',
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // PUT /api/organizations/{orgId}/agents/{agentId}/status - Update Status
  // ===========================================================================

  describe('PUT /api/organizations/{orgId}/agents/{agentId}/status', () => {
    it('should update agent status to suspended', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(createMockAgent());
      vi.mocked(services.updateAgentStatus).mockResolvedValueOnce(
        createMockAgent({ status: 'suspended' }),
      );

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123/status',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'suspended' }),
        },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'agent-uuid-123',
        subResource: 'status',
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.status).toBe('suspended');
    });

    it('should return 400 for invalid status', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(createMockAgent());

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123/status',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'invalid-status' }),
        },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'agent-uuid-123',
        subResource: 'status',
      });

      expect(response.status).toBe(400);
    });
  });

  // ===========================================================================
  // DELETE /api/organizations/{orgId}/agents/{agentId} - Delete Agent
  // ===========================================================================

  describe('DELETE /api/organizations/{orgId}/agents/{agentId}', () => {
    it('should delete agent', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(createMockAgent());
      vi.mocked(services.deleteAgent).mockResolvedValueOnce(true);

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123',
        { method: 'DELETE' },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'agent-uuid-123',
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 for non-existent agent', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/non-existent',
        { method: 'DELETE' },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'org-uuid-123',
        agentId: 'non-existent',
      });

      expect(response.status).toBe(404);
    });
  });
});
