/**
 * Agent Site Role Routes Tests (TDD)
 *
 * Tests for role management endpoints under /api/agents/:agentId/roles.
 * Only users can manage agent roles (not agents or service principals).
 * Tests should FAIL initially until implementation is complete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock services
vi.mock('../../src/services/agent-site-role-service', () => ({
  grantRole: vi.fn(),
  listRoles: vi.fn(),
  revokeRole: vi.fn(),
}));

describe('Agent Site Role Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  const userPrincipal = {
    id: 'user-uuid-123',
    type: 'user' as const,
    email: 'admin@example.com',
    dbUserId: 'db-user-uuid-123',
    pantheonSiteRoles: {},
    tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
    authProvider: 'google' as const,
  };

  const agentPrincipal = {
    id: 'agent-uuid-456',
    type: 'agent' as const,
    pantheonSiteRoles: {},
    tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
    authProvider: 'agent_key' as const,
  };

  const servicePrincipal = {
    id: 'token-uuid-789',
    type: 'service' as const,
    pantheonSiteRoles: {},
    tokenExpiry: new Date().toISOString(),
    authProvider: 'site_token' as const,
    siteId: 'site-uuid-456',
  };

  // ===========================================================================
  // POST /api/agents/:agentId/roles - Grant Role
  // ===========================================================================

  describe('POST /api/agents/:agentId/roles', () => {
    it('should grant a role and return 201 with role data', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');
      const roleService = await import('../../src/services/agent-site-role-service');

      vi.mocked(roleService.grantRole).mockResolvedValue({
        id: 'role-uuid-001',
        agentId: 'agent-uuid-456',
        siteId: 'site-uuid-100',
        role: 'editor',
        grantedBy: 'db-user-uuid-123',
        grantedAt: '2026-03-22T10:00:00.000Z',
        revokedAt: null,
      });

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: 'site-uuid-100', role: 'editor' }),
      });

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(201);
      const body: {
        id: string;
        agentId: string;
        siteId: string;
        role: string;
        grantedBy: string;
      } = await response.json();
      expect(body.id).toBe('role-uuid-001');
      expect(body.agentId).toBe('agent-uuid-456');
      expect(body.siteId).toBe('site-uuid-100');
      expect(body.role).toBe('editor');
      expect(body.grantedBy).toBe('db-user-uuid-123');

      expect(roleService.grantRole).toHaveBeenCalledWith({
        agentId: 'agent-uuid-456',
        siteId: 'site-uuid-100',
        role: 'editor',
        grantedBy: 'db-user-uuid-123',
      });
    });

    it('should return 400 when siteId is missing', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'editor' }),
      });

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(400);
      const body: { error: string } = await response.json();
      expect(body.error).toBe('siteId is required');
    });

    it('should return 400 when role is missing', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: 'site-uuid-100' }),
      });

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(400);
      const body: { error: string } = await response.json();
      expect(body.error).toBe('role is required');
    });

    it('should return 400 when role is invalid (not viewer/editor/admin)', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: 'site-uuid-100', role: 'superuser' }),
      });

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(400);
      const body: { error: string } = await response.json();
      expect(body.error).toBe('role must be one of: viewer, editor, admin');
    });

    it('should reject agent principals (403)', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: 'site-uuid-100', role: 'editor' }),
      });

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: agentPrincipal,
      });

      expect(response.status).toBe(403);
      const body: { error: string } = await response.json();
      expect(body.error).toBe('Only users can manage agent roles');
    });

    it('should reject service principals (403)', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: 'site-uuid-100', role: 'editor' }),
      });

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: servicePrincipal,
      });

      expect(response.status).toBe(403);
      const body: { error: string } = await response.json();
      expect(body.error).toBe('Only users can manage agent roles');
    });
  });

  // ===========================================================================
  // GET /api/agents/:agentId/roles - List Roles
  // ===========================================================================

  describe('GET /api/agents/:agentId/roles', () => {
    it('should list roles for an agent (200)', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');
      const roleService = await import('../../src/services/agent-site-role-service');

      vi.mocked(roleService.listRoles).mockResolvedValue([
        {
          id: 'role-uuid-001',
          agentId: 'agent-uuid-456',
          siteId: 'site-uuid-100',
          role: 'editor',
          grantedBy: 'db-user-uuid-123',
          grantedAt: '2026-03-22T10:00:00.000Z',
          revokedAt: null,
        },
        {
          id: 'role-uuid-002',
          agentId: 'agent-uuid-456',
          siteId: 'site-uuid-200',
          role: 'viewer',
          grantedBy: 'db-user-uuid-123',
          grantedAt: '2026-03-22T11:00:00.000Z',
          revokedAt: null,
        },
      ]);

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/roles', {
        method: 'GET',
      });

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(200);
      const body: { roles: { id: string; role: string }[] } = await response.json();
      expect(body.roles).toHaveLength(2);
      expect(body.roles[0].id).toBe('role-uuid-001');
      expect(body.roles[0].role).toBe('editor');
      expect(body.roles[1].id).toBe('role-uuid-002');
      expect(body.roles[1].role).toBe('viewer');
    });

    it('should return empty array when no roles exist', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');
      const roleService = await import('../../src/services/agent-site-role-service');

      vi.mocked(roleService.listRoles).mockResolvedValue([]);

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/roles', {
        method: 'GET',
      });

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(200);
      const body: { roles: unknown[] } = await response.json();
      expect(body.roles).toEqual([]);
    });
  });

  // ===========================================================================
  // DELETE /api/agents/:agentId/roles/:roleId - Revoke Role
  // ===========================================================================

  describe('DELETE /api/agents/:agentId/roles/:roleId', () => {
    it('should revoke a role (204)', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');
      const roleService = await import('../../src/services/agent-site-role-service');

      vi.mocked(roleService.revokeRole).mockResolvedValue(true);

      const request = new Request(
        'https://api.example.com/api/agents/agent-uuid-456/roles/role-uuid-001',
        { method: 'DELETE' },
      );

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        roleId: 'role-uuid-001',
        principal: userPrincipal,
      });

      expect(response.status).toBe(204);
      expect(roleService.revokeRole).toHaveBeenCalledWith('role-uuid-001', 'agent-uuid-456');
    });

    it('should return 404 when role not found', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');
      const roleService = await import('../../src/services/agent-site-role-service');

      vi.mocked(roleService.revokeRole).mockResolvedValue(false);

      const request = new Request(
        'https://api.example.com/api/agents/agent-uuid-456/roles/non-existent',
        { method: 'DELETE' },
      );

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        roleId: 'non-existent',
        principal: userPrincipal,
      });

      expect(response.status).toBe(404);
      const body: { error: string } = await response.json();
      expect(body.error).toBe('Role not found');
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should return 400 when agentId is missing', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');

      const request = new Request('https://api.example.com/api/agents//roles', {
        method: 'GET',
      });

      const response = await handleAgentRoleRoutes(request, {
        principal: userPrincipal,
      });

      expect(response.status).toBe(400);
      const body: { error: string } = await response.json();
      expect(body.error).toBe('Agent ID is required');
    });

    it('should return 405 for unsupported methods (PATCH)', async () => {
      const { handleAgentRoleRoutes } = await import('../../src/routes/agent-role-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/roles', {
        method: 'PATCH',
      });

      const response = await handleAgentRoleRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(405);
      const body: { error: string } = await response.json();
      expect(body.error).toBe('Method not allowed');
    });
  });
});
