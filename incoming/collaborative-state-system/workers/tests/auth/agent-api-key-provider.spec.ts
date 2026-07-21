/**
 * Agent API Key Provider Tests (TDD)
 *
 * Tests for the AgentApiKeyProvider which authenticates
 * agent API keys (aak_ prefixed) against the database.
 * Tests should FAIL initially until implementation is complete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agent API key service
vi.mock('../../src/services/agent-api-key-service', () => ({
  validateKey: vi.fn(),
}));

// Mock the agent site role service
vi.mock('../../src/services/agent-site-role-service', () => ({
  getRolesForAgent: vi.fn(),
}));

describe('AgentApiKeyProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Interface compliance
  // ===========================================================================

  describe('interface', () => {
    it('should have name property set to "agent_key"', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(provider.name).toBe('agent_key');
    });

    it('should implement canVerifyToken method', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(typeof provider.canVerifyToken).toBe('function');
    });

    it('should implement validateToken method', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(typeof provider.validateToken).toBe('function');
    });

    it('should implement validateAgentKey method', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(typeof provider.validateAgentKey).toBe('function');
    });
  });

  // ===========================================================================
  // canVerifyToken
  // ===========================================================================

  describe('canVerifyToken', () => {
    it('should always return false (agent keys are not Bearer tokens)', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(provider.canVerifyToken('aak_somekey123')).toBe(false);
      expect(provider.canVerifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig')).toBe(false);
      expect(provider.canVerifyToken('')).toBe(false);
      expect(provider.canVerifyToken('anything')).toBe(false);
    });
  });

  // ===========================================================================
  // validateToken
  // ===========================================================================

  describe('validateToken', () => {
    it('should always return null (Bearer tokens not supported)', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      const result = await provider.validateToken('aak_somekey123');

      expect(result).toBeNull();
    });

    it('should return null for any token string', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(await provider.validateToken('eyJhbGciOiJIUzI1NiJ9.test.sig')).toBeNull();
      expect(await provider.validateToken('')).toBeNull();
      expect(await provider.validateToken('sat_token123')).toBeNull();
    });
  });

  // ===========================================================================
  // validateAgentKey
  // ===========================================================================

  describe('validateAgentKey', () => {
    it('should return principal for valid aak_ key', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal).not.toBeNull();
    });

    it('should return principal with type "agent"', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.type).toBe('agent');
    });

    it('should set authProvider to "agent_key"', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.authProvider).toBe('agent_key');
    });

    it('should use agentId as principal id (not keyId)', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.id).toBe('agent-uuid-456');
    });

    it('should set empty pantheonSiteRoles', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.pantheonSiteRoles).toEqual({});
    });

    it('should not include scopes on principal', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.scopes).toBeUndefined();
    });

    it('should set tokenExpiry to a future date', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const before = Date.now();
      const principal = await provider.validateAgentKey('aak_validkey123abc');
      const after = Date.now();

      expect(principal?.tokenExpiry).toBeDefined();
      const expiry = new Date(principal?.tokenExpiry ?? 0).getTime();
      // Should be ~24 hours in the future
      expect(expiry).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
      expect(expiry).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 1000);
    });

    it('should return null for invalid key (validateKey returns null)', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue(null);

      const principal = await provider.validateAgentKey('aak_invalidkey999');

      expect(principal).toBeNull();
    });

    it('should return null for non-aak_ prefixed keys without calling service', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      const principal = await provider.validateAgentKey('sat_notanagentkey');

      expect(principal).toBeNull();
      expect(agentKeyService.validateKey).not.toHaveBeenCalled();
    });

    it('should return null for empty string without calling service', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      const principal = await provider.validateAgentKey('');

      expect(principal).toBeNull();
      expect(agentKeyService.validateKey).not.toHaveBeenCalled();
    });

    it('should return null for bare "aak_" with no value after prefix', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      const principal = await provider.validateAgentKey('aak_');

      expect(principal).toBeNull();
      expect(agentKeyService.validateKey).not.toHaveBeenCalled();
    });

    it('should delegate to validateKey from agent-api-key-service', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      await provider.validateAgentKey('aak_testkey789xyz');

      expect(agentKeyService.validateKey).toHaveBeenCalledWith('aak_testkey789xyz');
      expect(agentKeyService.validateKey).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // site role integration
  // ===========================================================================

  describe('site role integration', () => {
    it('should populate pantheonSiteRoles from agent site roles', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const agentSiteRoleService = await import('../../src/services/agent-site-role-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      vi.mocked(agentSiteRoleService.getRolesForAgent).mockResolvedValue({
        'site-uuid-1': 'developer',
        'site-uuid-2': 'team_member',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal).not.toBeNull();
      expect(principal?.pantheonSiteRoles).toEqual({
        'site-uuid-1': 'developer',
        'site-uuid-2': 'team_member',
      });
    });

    it('should return empty pantheonSiteRoles when agent has no site roles', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const agentSiteRoleService = await import('../../src/services/agent-site-role-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      vi.mocked(agentSiteRoleService.getRolesForAgent).mockResolvedValue({});

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal).not.toBeNull();
      expect(principal?.pantheonSiteRoles).toEqual({});
    });
  });
});
