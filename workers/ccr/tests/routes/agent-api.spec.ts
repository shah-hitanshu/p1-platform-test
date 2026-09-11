/**
 * Agent Politeness System - Phase 1.5: Agent API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for agent operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import type { RegisteredAgent } from '../../src/types';

// PCC-3479: agent routes are org-scoped now. Access is exercised separately in
// its own describe block; everything else assumes the caller is a member.
//
// Managing the roster additionally needs the admin role within the business
// account. Most tests here exercise roster management, so default the caller to
// an admin of it; the permission block below opts out explicitly.
vi.mock('../../src/utils/org-access', () => ({
  canAccessOrganization: vi.fn(async () => true),
  isOrgAdmin: vi.fn(async () => true),
}));

// Mock the services
vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    createAgent: vi.fn(),
    getAgentById: vi.fn(),
    getAgentByName: vi.fn(),
    updateAgent: vi.fn(),
    updateAgentStatus: vi.fn(),
    deleteAgent: vi.fn(),
    listAgents: vi.fn(),
    getAgentsByOrganization: vi.fn(),
    getActiveAgentCount: vi.fn(),
  };
});

describe('Agent Politeness Phase 1.5: Agent API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // Helper to create mock agent
  function createMockAgent(overrides: Partial<RegisteredAgent> = {}): RegisteredAgent {
    return {
      id: 'agent-uuid-123',
      organizationId: 'org-uuid-123',
      name: 'Test Agent',
      description: 'A test agent',
      capabilities: ['edit', 'create'],
      status: 'active',
      settings: {},
      createdAt: new Date('2026-01-26T12:00:00.000Z'),
      updatedAt: new Date('2026-01-26T12:00:00.000Z'),
      isGlobal: false,
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
        new services.OrganizationNotFoundError('non-existent-org'),
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
      expect(services.getAgentsByOrganization).toHaveBeenCalledWith(
        'org-uuid-123',
        { status: 'active' },
      );
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

  // ===========================================================================
  // PCC-3479: organization scoping
  // ===========================================================================

  describe('organization access', () => {
    it('should return 403 when the caller does not belong to the organization', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const { canAccessOrganization } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(canAccessOrganization).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/organizations/other-org/agents',
        { method: 'GET' },
      );

      const response = await handleAgentRoutes(request, {
        principal: { id: 'user-1', type: 'user' },
        organizationId: 'other-org',
      });

      expect(response.status).toBe(403);
      expect(services.getAgentsByOrganization).not.toHaveBeenCalled();
    });

    it('should accept PATCH on the status sub-resource', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const services = await import('../../src/services');

      vi.mocked(services.getAgentById).mockResolvedValueOnce(createMockAgent());
      vi.mocked(services.updateAgentStatus).mockResolvedValueOnce(
        createMockAgent({ status: 'suspended' }),
      );

      const request = new Request(
        'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123/status',
        {
          method: 'PATCH',
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
  });

  // ===========================================================================
  // PCC-3479: only a business account admin manages the agent roster
  // ===========================================================================

  describe('business account admin requirement', () => {
    const member = { id: 'user-1', type: 'user' as const };

    it('refuses to list agents for a plain member of the organization', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);

      const response = await handleAgentRoutes(
        new Request('https://api.example.com/api/organizations/org-uuid-123/agents', {
          method: 'GET',
        }),
        { principal: member, organizationId: 'org-uuid-123' },
      );

      expect(response.status).toBe(403);
      expect(services.getAgentsByOrganization).not.toHaveBeenCalled();
    });

    // Per business account, not platform-wide: administering one account must
    // not carry over to the next one the caller happens to belong to.
    it('checks the admin role against the organization in the path', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');

      await handleAgentRoutes(
        new Request('https://api.example.com/api/organizations/org-uuid-123/agents', {
          method: 'GET',
        }),
        { principal: member, organizationId: 'org-uuid-123' },
      );

      expect(isOrgAdmin).toHaveBeenCalledWith(member, 'org-uuid-123');
    });

    it('refuses to register an agent for a plain member of the organization', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);

      const response = await handleAgentRoutes(
        new Request('https://api.example.com/api/organizations/org-uuid-123/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Sneaky Agent' }),
        }),
        { principal: member, organizationId: 'org-uuid-123' },
      );

      expect(response.status).toBe(403);
      expect(services.createAgent).not.toHaveBeenCalled();
    });

    it('refuses to delete an agent for a plain member of the organization', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);

      const response = await handleAgentRoutes(
        new Request(
          'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123',
          { method: 'DELETE' },
        ),
        { principal: member, organizationId: 'org-uuid-123', agentId: 'agent-uuid-123' },
      );

      expect(response.status).toBe(403);
      expect(services.deleteAgent).not.toHaveBeenCalled();
    });

    // A running agent reports its own status through this route; gating it on
    // the admin role would break every agent in the field.
    it('still lets a non-admin update an agent status', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);
      vi.mocked(services.getAgentById).mockResolvedValueOnce(createMockAgent());
      vi.mocked(services.updateAgentStatus).mockResolvedValueOnce(
        createMockAgent({ status: 'active' }),
      );

      const response = await handleAgentRoutes(
        new Request(
          'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123/status',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active' }),
          },
        ),
        {
          principal: member,
          organizationId: 'org-uuid-123',
          agentId: 'agent-uuid-123',
          subResource: 'status',
        },
      );

      expect(response.status).toBe(200);
    });

    // Same reasoning: an agent reads and refreshes its own record at runtime.
    it('still lets a non-admin read a single agent', async () => {
      const { handleAgentRoutes } = await import('../../src/routes/agent-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);
      vi.mocked(services.getAgentById).mockResolvedValueOnce(createMockAgent());

      const response = await handleAgentRoutes(
        new Request(
          'https://api.example.com/api/organizations/org-uuid-123/agents/agent-uuid-123',
          { method: 'GET' },
        ),
        { principal: member, organizationId: 'org-uuid-123', agentId: 'agent-uuid-123' },
      );

      expect(response.status).toBe(200);
    });
  });
});
