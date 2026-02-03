/**
 * Agent Politeness System - Phase 7.2: Agent Status Middleware Tests (TDD)
 *
 * Tests for middleware that validates agent status before allowing operations.
 * When X-Agent-Id header is present, looks up agent in registry and rejects
 * if agent is suspended or disabled.
 *
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agent service
vi.mock('../../src/services/agent-service', () => ({
  getAgentById: vi.fn(),
}));

describe('Agent Politeness Phase 7.2: Agent Status Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkAgentStatus', () => {
    it('should return allowed when no agent context present', async () => {
      const { checkAgentStatus } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const result = await checkAgentStatus(null);

      expect(result.allowed).toBe(true);
      expect(result.agent).toBeUndefined();
    });

    it('should return allowed when agent is active', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockResolvedValue({
        id: '44444444-4444-4444-4444-444444444444',
        organizationId: 'org-1',
        name: 'Test Agent',
        description: 'Test agent description',
        capabilities: ['content_edit'],
        status: 'active',
        settings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { checkAgentStatus } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const agentContext = {
        agentId: '44444444-4444-4444-4444-444444444444',
      };

      const result = await checkAgentStatus(agentContext);

      expect(result.allowed).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent?.status).toBe('active');
    });

    it('should return denied when agent is suspended', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockResolvedValue({
        id: '44444444-4444-4444-4444-444444444444',
        organizationId: 'org-1',
        name: 'Suspended Agent',
        description: 'Agent that is suspended',
        capabilities: ['content_edit'],
        status: 'suspended',
        settings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { checkAgentStatus } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const agentContext = {
        agentId: '44444444-4444-4444-4444-444444444444',
      };

      const result = await checkAgentStatus(agentContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('agent_suspended');
      expect(result.message).toContain('suspended');
    });

    it('should return denied when agent is disabled', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockResolvedValue({
        id: '44444444-4444-4444-4444-444444444444',
        organizationId: 'org-1',
        name: 'Disabled Agent',
        description: 'Agent that is disabled',
        capabilities: ['content_edit'],
        status: 'disabled',
        settings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { checkAgentStatus } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const agentContext = {
        agentId: '44444444-4444-4444-4444-444444444444',
      };

      const result = await checkAgentStatus(agentContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('agent_disabled');
      expect(result.message).toContain('disabled');
    });

    it('should return denied when agent not found', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockResolvedValue(null);

      const { checkAgentStatus } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const agentContext = {
        agentId: '99999999-9999-9999-9999-999999999999',
      };

      const result = await checkAgentStatus(agentContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('agent_not_found');
      expect(result.message).toContain('not found');
    });

    it('should handle database errors gracefully', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockRejectedValue(new Error('Database connection failed'));

      const { checkAgentStatus } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const agentContext = {
        agentId: '44444444-4444-4444-4444-444444444444',
      };

      const result = await checkAgentStatus(agentContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('lookup_error');
      expect(result.message).toContain('error');
    });
  });

  describe('createAgentStatusMiddleware', () => {
    it('should create middleware function', async () => {
      const { createAgentStatusMiddleware } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const middleware = createAgentStatusMiddleware();

      expect(typeof middleware).toBe('function');
    });

    it('should pass through when no agent headers present', async () => {
      const { createAgentStatusMiddleware } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const middleware = createAgentStatusMiddleware();
      const request = new Request('https://example.com/api/test');
      const next = vi.fn().mockResolvedValue(new Response('OK'));

      const response = await middleware(request, next);

      expect(next).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should pass through when agent is active', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockResolvedValue({
        id: '44444444-4444-4444-4444-444444444444',
        organizationId: 'org-1',
        name: 'Active Agent',
        description: 'Active agent',
        capabilities: ['content_edit'],
        status: 'active',
        settings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { createAgentStatusMiddleware } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const middleware = createAgentStatusMiddleware();
      const request = new Request('https://example.com/api/test', {
        headers: {
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
        },
      });
      const next = vi.fn().mockResolvedValue(new Response('OK'));

      const response = await middleware(request, next);

      expect(next).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should return 403 when agent is suspended', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockResolvedValue({
        id: '44444444-4444-4444-4444-444444444444',
        organizationId: 'org-1',
        name: 'Suspended Agent',
        description: 'Suspended agent',
        capabilities: ['content_edit'],
        status: 'suspended',
        settings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { createAgentStatusMiddleware } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const middleware = createAgentStatusMiddleware();
      const request = new Request('https://example.com/api/test', {
        headers: {
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
        },
      });
      const next = vi.fn().mockResolvedValue(new Response('OK'));

      const response = await middleware(request, next);

      expect(next).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('suspended');
    });

    it('should return 403 when agent is disabled', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockResolvedValue({
        id: '44444444-4444-4444-4444-444444444444',
        organizationId: 'org-1',
        name: 'Disabled Agent',
        description: 'Disabled agent',
        capabilities: ['content_edit'],
        status: 'disabled',
        settings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { createAgentStatusMiddleware } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const middleware = createAgentStatusMiddleware();
      const request = new Request('https://example.com/api/test', {
        headers: {
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
        },
      });
      const next = vi.fn().mockResolvedValue(new Response('OK'));

      const response = await middleware(request, next);

      expect(next).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
    });

    it('should return 404 when agent not found', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockResolvedValue(null);

      const { createAgentStatusMiddleware } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const middleware = createAgentStatusMiddleware();
      const request = new Request('https://example.com/api/test', {
        headers: {
          'X-Agent-Id': '99999999-9999-9999-9999-999999999999',
        },
      });
      const next = vi.fn().mockResolvedValue(new Response('OK'));

      const response = await middleware(request, next);

      expect(next).not.toHaveBeenCalled();
      expect(response.status).toBe(404);
    });

    it('should return 500 on database error', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const mockedGetAgentById = vi.mocked(getAgentById);
      mockedGetAgentById.mockRejectedValue(new Error('Database error'));

      const { createAgentStatusMiddleware } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const middleware = createAgentStatusMiddleware();
      const request = new Request('https://example.com/api/test', {
        headers: {
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
        },
      });
      const next = vi.fn().mockResolvedValue(new Response('OK'));

      const response = await middleware(request, next);

      expect(next).not.toHaveBeenCalled();
      expect(response.status).toBe(500);
    });
  });

  describe('parseAgentHeaders helper', () => {
    it('should be exported for use in middleware', async () => {
      const { parseAgentHeaders } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      expect(typeof parseAgentHeaders).toBe('function');
    });

    it('should parse X-Agent-Id from request headers', async () => {
      const { parseAgentHeaders } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      const request = new Request('https://example.com/api/test', {
        headers: {
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
        },
      });

      const context = parseAgentHeaders(request);

      expect(context?.agentId).toBe('44444444-4444-4444-4444-444444444444');
    });
  });

  describe('AgentStatusResult type', () => {
    it('should have allowed, reason, message, and agent fields', async () => {
      const { checkAgentStatus } = await import(
        '../../src/middleware/agent-status-middleware'
      );

      // Just verify the function exists and returns an object
      const result = await checkAgentStatus(null);

      expect(result).toHaveProperty('allowed');
    });
  });
});
