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
