/**
 * Agent API Key Routes Tests (TDD)
 *
 * Tests for key management endpoints under /api/agents/:agentId/keys.
 * Only users can manage agent keys (not agents or service principals).
 * Tests should FAIL initially until implementation is complete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';

// Mock services
vi.mock('../../src/services/agent-api-key-service', () => ({
  generateKey: vi.fn(),
  listKeys: vi.fn(),
  revokeKey: vi.fn(),
}));

// PCC-3676: key management requires canManageGrants on every site the agent
// holds a role on. Default: the agent has no roles, so there is nothing to
// check and the operation is allowed — this keeps the pre-existing happy-path
// tests (which don't set up roles) valid.
vi.mock('../../src/services/agent-site-role-service', () => ({
  getRolesForAgent: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/services', () => ({
  getMainBranch: vi.fn().mockResolvedValue({
    id: 'branch-main-uuid',
    siteId: 'site-uuid-100',
    name: 'main',
    isMain: true,
  }),
}));

// Real AuthorizationError class (handler does `instanceof`); assertPermission stubbed.
vi.mock('../../src/auth/authorization', async (importActual) => {
  const actual = await importActual<typeof import('../../src/auth/authorization')>();
  return { ...actual, assertPermission: vi.fn().mockResolvedValue(undefined) };
});

describe('Agent API Key Routes', () => {
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
  // POST /api/agents/:agentId/keys - Generate Key
  // ===========================================================================

  describe('POST /api/agents/:agentId/keys', () => {
    it('should generate a new key and return 201 with key and metadata', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');

      vi.mocked(keyService.generateKey).mockResolvedValue({
        key: 'aak_abc123def456ghi789',
        metadata: {
          id: 'key-uuid-001',
          agentId: 'agent-uuid-456',
          prefix: 'aak_abc12345',
          name: 'CI Pipeline Key',
          createdBy: 'db-user-uuid-123',
          createdAt: '2026-03-22T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
      });

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CI Pipeline Key' }),
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(201);
      const body: { key: string; metadata: { id: string; name: string; agentId: string } } =
        await readJson(response);
      expect(body.key).toBe('aak_abc123def456ghi789');
      expect(body.metadata.id).toBe('key-uuid-001');
      expect(body.metadata.name).toBe('CI Pipeline Key');
      expect(body.metadata.agentId).toBe('agent-uuid-456');

      expect(keyService.generateKey).toHaveBeenCalledWith({
        agentId: 'agent-uuid-456',
        name: 'CI Pipeline Key',
        createdBy: 'db-user-uuid-123',
      });
    });

    it('should return 400 when name is missing', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(400);
      const body: { error: string } = await readJson(response);
      expect(body.error).toBe('name is required');
    });

    it('should reject agent principals (403)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sneaky Key' }),
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: agentPrincipal,
      });

      expect(response.status).toBe(403);
      const body: { error: string } = await readJson(response);
      expect(body.error).toBe('Only users can manage agent API keys');
    });

    it('should reject service principals (403)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sneaky Key' }),
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: servicePrincipal,
      });

      expect(response.status).toBe(403);
      const body: { error: string } = await readJson(response);
      expect(body.error).toBe('Only users can manage agent API keys');
    });
  });

  // ===========================================================================
  // GET /api/agents/:agentId/keys - List Keys
  // ===========================================================================

  describe('GET /api/agents/:agentId/keys', () => {
    it('should list keys for an agent (200)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');

      vi.mocked(keyService.listKeys).mockResolvedValue([
        {
          id: 'key-uuid-001',
          agentId: 'agent-uuid-456',
          prefix: 'aak_abc12345',
          name: 'Key A',
          createdBy: 'db-user-uuid-123',
          createdAt: '2026-03-22T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
        {
          id: 'key-uuid-002',
          agentId: 'agent-uuid-456',
          prefix: 'aak_def67890',
          name: 'Key B',
          createdBy: 'db-user-uuid-123',
          createdAt: '2026-03-22T11:00:00.000Z',
          lastUsedAt: '2026-03-22T12:00:00.000Z',
          revokedAt: null,
        },
      ]);

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'GET',
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(200);
      const body: { keys: { id: string }[] } = await readJson(response);
      expect(body.keys).toHaveLength(2);
      expect(body.keys[0].id).toBe('key-uuid-001');
      expect(body.keys[1].id).toBe('key-uuid-002');
    });

    it('should return empty array when no keys exist', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');

      vi.mocked(keyService.listKeys).mockResolvedValue([]);

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'GET',
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(200);
      const body: { keys: unknown[] } = await readJson(response);
      expect(body.keys).toEqual([]);
    });
  });

  // ===========================================================================
  // DELETE /api/agents/:agentId/keys/:keyId - Revoke Key
  // ===========================================================================

  describe('DELETE /api/agents/:agentId/keys/:keyId', () => {
    it('should revoke a key (204)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');

      vi.mocked(keyService.revokeKey).mockResolvedValue(true);

      const request = new Request(
        'https://api.example.com/api/agents/agent-uuid-456/keys/key-uuid-001',
        { method: 'DELETE' },
      );

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        keyId: 'key-uuid-001',
        principal: userPrincipal,
      });

      expect(response.status).toBe(204);
      expect(keyService.revokeKey).toHaveBeenCalledWith('key-uuid-001', 'agent-uuid-456');
    });

    it('should return 404 when key not found', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');

      vi.mocked(keyService.revokeKey).mockResolvedValue(false);

      const request = new Request(
        'https://api.example.com/api/agents/agent-uuid-456/keys/non-existent',
        { method: 'DELETE' },
      );

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        keyId: 'non-existent',
        principal: userPrincipal,
      });

      expect(response.status).toBe(404);
      const body: { error: string } = await readJson(response);
      expect(body.error).toBe('Key not found');
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  // ===========================================================================
  // PCC-3676: key management requires admin on all of the agent's sites
  // ===========================================================================

  describe('authorization (PCC-3676)', () => {
    it('rejects minting a key when the caller does not administer the agent\'s site (403)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');
      const roleService = await import('../../src/services/agent-site-role-service');
      const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');

      // Agent already holds admin on site-uuid-100 (granted by that site's admin).
      vi.mocked(roleService.getRolesForAgent).mockResolvedValueOnce({ 'site-uuid-100': 'admin' });
      // Caller is not an admin of that site.
      vi.mocked(assertPermission).mockRejectedValueOnce(
        new AuthorizationError('Missing permission: canManageGrants.', 'canManageGrants', 'NO_ACCESS'),
      );

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'hijack key' }),
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      // This is the mint-and-reuse escalation: minting a key would inherit the
      // agent's admin on site-uuid-100 without the caller ever having it.
      expect(response.status).toBe(403);
      expect(keyService.generateKey).not.toHaveBeenCalled();
    });

    it('allows minting when the caller administers every site the agent holds a role on (201)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');
      const roleService = await import('../../src/services/agent-site-role-service');

      // getRolesForAgent returns PantheonRole values (admin/developer/...), not
      // the agent-role vocabulary (viewer/editor/admin).
      vi.mocked(roleService.getRolesForAgent).mockResolvedValueOnce({ 'site-uuid-100': 'developer' });
      // assertPermission resolves by default (caller is an admin of site-uuid-100).
      vi.mocked(keyService.generateKey).mockResolvedValue({
        key: 'aak_ok',
        metadata: {
          id: 'key-1', agentId: 'agent-uuid-456', prefix: 'aak_ok12', name: 'ok',
          createdBy: 'db-user-uuid-123', createdAt: '2026-08-19T00:00:00.000Z',
          lastUsedAt: null, revokedAt: null,
        },
      });

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ok' }),
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(201);
      expect(keyService.generateKey).toHaveBeenCalled();
    });

    it('rejects minting when the caller administers only SOME of the agent\'s sites (403)', async () => {
      // Distinguishes mint's EVERY-site rule from revoke's ANY-site rule: a
      // caller who admins one of the agent's two sites must NOT be able to mint
      // a key that would also inherit the agent's role on the other site.
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');
      const roleService = await import('../../src/services/agent-site-role-service');
      const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');

      vi.mocked(roleService.getRolesForAgent).mockResolvedValueOnce({
        'site-A': 'admin',
        'site-B': 'admin',
      });
      // site-A allowed, site-B denied → mint must fail because it is not ALL.
      vi.mocked(assertPermission)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new AuthorizationError('no', 'canManageGrants', 'NO_ACCESS'),
        );

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'partial-admin key' }),
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(403);
      expect(keyService.generateKey).not.toHaveBeenCalled();
    });

    it('rejects listing keys when the caller does not administer the agent\'s site (403)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');
      const roleService = await import('../../src/services/agent-site-role-service');
      const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');

      vi.mocked(roleService.getRolesForAgent).mockResolvedValueOnce({ 'site-uuid-100': 'admin' });
      vi.mocked(assertPermission).mockRejectedValueOnce(
        new AuthorizationError('Missing permission: canManageGrants.', 'canManageGrants', 'VIEWER'),
      );

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'GET',
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(403);
      expect(keyService.listKeys).not.toHaveBeenCalled();
    });

    it('allows revoking a key with admin on ANY one of the agent\'s sites (204)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');
      const roleService = await import('../../src/services/agent-site-role-service');
      const { assertPermission } = await import('../../src/auth/authorization');

      // Agent has roles on two sites; caller administers only the second.
      vi.mocked(roleService.getRolesForAgent).mockResolvedValueOnce({
        'site-A': 'admin',
        'site-B': 'admin',
      });
      const { AuthorizationError } = await import('../../src/auth/authorization');
      // First site (A) denied, second site (B) allowed → revoke proceeds.
      vi.mocked(assertPermission).mockRejectedValueOnce(
        new AuthorizationError('no', 'canManageGrants', 'NO_ACCESS'),
      );
      vi.mocked(keyService.revokeKey).mockResolvedValue(true);

      const request = new Request(
        'https://api.example.com/api/agents/agent-uuid-456/keys/key-uuid-001',
        { method: 'DELETE' },
      );

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        keyId: 'key-uuid-001',
        principal: userPrincipal,
      });

      // Containment must not require admin on every site the agent touches.
      expect(response.status).toBe(204);
      expect(keyService.revokeKey).toHaveBeenCalledWith('key-uuid-001', 'agent-uuid-456');
    });

    it('rejects revoking when the caller administers none of the agent\'s sites (403)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');
      const keyService = await import('../../src/services/agent-api-key-service');
      const roleService = await import('../../src/services/agent-site-role-service');
      const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');

      vi.mocked(roleService.getRolesForAgent).mockResolvedValueOnce({ 'site-A': 'admin' });
      vi.mocked(assertPermission).mockRejectedValueOnce(
        new AuthorizationError('no', 'canManageGrants', 'NO_ACCESS'),
      );

      const request = new Request(
        'https://api.example.com/api/agents/agent-uuid-456/keys/key-uuid-001',
        { method: 'DELETE' },
      );

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        keyId: 'key-uuid-001',
        principal: userPrincipal,
      });

      expect(response.status).toBe(403);
      expect(keyService.revokeKey).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should return 400 when agentId is missing', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');

      const request = new Request('https://api.example.com/api/agents//keys', {
        method: 'GET',
      });

      const response = await handleAgentKeyRoutes(request, {
        principal: userPrincipal,
      });

      expect(response.status).toBe(400);
      const body: { error: string } = await readJson(response);
      expect(body.error).toBe('Agent ID is required');
    });

    it('should return 405 for unsupported methods (PATCH)', async () => {
      const { handleAgentKeyRoutes } = await import('../../src/routes/agent-key-api');

      const request = new Request('https://api.example.com/api/agents/agent-uuid-456/keys', {
        method: 'PATCH',
      });

      const response = await handleAgentKeyRoutes(request, {
        agentId: 'agent-uuid-456',
        principal: userPrincipal,
      });

      expect(response.status).toBe(405);
      const body: { error: string } = await readJson(response);
      expect(body.error).toBe('Method not allowed');
    });
  });
});
