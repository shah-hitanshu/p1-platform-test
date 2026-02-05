/**
 * Agent Politeness API Tests
 *
 * Tests for presence, agent registry, and agent edit workflow endpoints.
 * Phase 1 of Agent Politeness Frontend Integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CSSClient } from '../src/client.js';
import { NotFoundError, ValidationError } from '../src/errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Agent Politeness Endpoints', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Presence Endpoint Tests
  // ===========================================================================

  describe('presence endpoint', () => {
    describe('getSitePresence', () => {
      it('should get site-level presence', async () => {
        const mockPresence = {
          siteId: 'site-1',
          siteName: 'Test Site',
          summary: {
            totalActors: 3,
            humanCount: 2,
            agentCount: 1,
            activeBranches: 2,
          },
          branches: [
            {
              branchId: 'branch-1',
              branchName: 'main',
              actorCount: 2,
              hasHumans: true,
              hasAgents: true,
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockPresence,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const presence = await client.presence.getSitePresence('site-1');

        expect(presence).toEqual(mockPresence);
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/sites/site-1/presence`,
          expect.objectContaining({ method: 'GET' })
        );
      });
    });

    describe('getBranchPresence', () => {
      it('should get branch-level presence with actors', async () => {
        const mockPresence = {
          branchId: 'branch-1',
          branchName: 'main',
          siteId: 'site-1',
          summary: {
            totalActors: 2,
            humanCount: 1,
            agentCount: 1,
            editingCount: 1,
          },
          actors: [
            {
              id: 'presence-1',
              actorId: 'user-1',
              actorType: 'user',
              role: 'human',
              name: 'Alice',
              state: 'editing',
              lastActivityAt: '2026-01-27T10:00:00Z',
              joinedAt: '2026-01-27T09:00:00Z',
            },
            {
              id: 'presence-2',
              actorId: 'agent-1',
              actorType: 'agent',
              role: 'agent',
              name: 'ContentOptimizer',
              state: 'idle',
              intent: 'Waiting for editing opportunity',
              focusRegions: ['/content/0'],
              lastActivityAt: '2026-01-27T10:00:00Z',
              joinedAt: '2026-01-27T09:30:00Z',
            },
          ],
          documentSummary: [
            {
              documentId: 'doc-1',
              documentPath: '/home',
              actorCount: 2,
              hasHumans: true,
              hasAgents: true,
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockPresence,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const presence = await client.presence.getBranchPresence('site-1', 'branch-1');

        expect(presence).toEqual(mockPresence);
        expect(presence.actors).toHaveLength(2);
        expect(presence.actors[0].role).toBe('human');
        expect(presence.actors[1].role).toBe('agent');
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/sites/site-1/branches/branch-1/presence`,
          expect.objectContaining({ method: 'GET' })
        );
      });
    });

    describe('getAgentPresence', () => {
      it('should get agent global presence across organization', async () => {
        const mockPresence = {
          agentId: 'agent-1',
          agentName: 'ContentOptimizer',
          organizationId: 'org-1',
          locations: [
            {
              siteId: 'site-1',
              siteName: 'Test Site',
              branchId: 'branch-1',
              branchName: 'main',
              documentId: 'doc-1',
              documentPath: '/home',
              presence: {
                id: 'presence-1',
                actorId: 'agent-1',
                actorType: 'agent',
                role: 'agent',
                name: 'ContentOptimizer',
                state: 'editing',
                intent: 'Optimizing layout',
                focusRegions: ['/content/0', '/content/1'],
                lastActivityAt: '2026-01-27T10:00:00Z',
                joinedAt: '2026-01-27T09:30:00Z',
              },
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockPresence,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const presence = await client.presence.getAgentPresence('org-1', 'agent-1');

        expect(presence).toEqual(mockPresence);
        expect(presence.locations).toHaveLength(1);
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/organizations/org-1/agents/agent-1/presence`,
          expect.objectContaining({ method: 'GET' })
        );
      });
    });
  });

  // ===========================================================================
  // Agent Registry Endpoint Tests
  // ===========================================================================

  describe('agentRegistry endpoint', () => {
    describe('list', () => {
      it('should list agents in organization', async () => {
        const mockAgents = [
          {
            id: 'agent-1',
            organizationId: 'org-1',
            name: 'ContentOptimizer',
            description: 'Optimizes content layout',
            capabilities: ['content_edit', 'layout_optimization'],
            status: 'active',
            settings: {},
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'agent-2',
            organizationId: 'org-1',
            name: 'SEOHelper',
            description: 'Improves SEO',
            capabilities: ['content_suggest'],
            status: 'active',
            settings: {},
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ agents: mockAgents }),
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const agents = await client.agentRegistry.list('org-1');

        expect(agents).toEqual(mockAgents);
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/organizations/org-1/agents`,
          expect.objectContaining({ method: 'GET' })
        );
      });

      it('should filter agents by status', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ agents: [] }),
        });

        const client = new CSSClient({ baseUrl, apiKey });
        await client.agentRegistry.list('org-1', { status: 'active' });

        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/organizations/org-1/agents?status=active`,
          expect.objectContaining({ method: 'GET' })
        );
      });
    });

    describe('get', () => {
      it('should get agent by ID', async () => {
        const mockAgent = {
          id: 'agent-1',
          organizationId: 'org-1',
          name: 'ContentOptimizer',
          description: 'Optimizes content layout',
          capabilities: ['content_edit'],
          status: 'active',
          settings: { priorityTier: 'standard' },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockAgent,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const agent = await client.agentRegistry.get('org-1', 'agent-1');

        expect(agent).toEqual(mockAgent);
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/organizations/org-1/agents/agent-1`,
          expect.objectContaining({ method: 'GET' })
        );
      });

      it('should throw NotFoundError for non-existent agent', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Agent not found' }),
        });

        const client = new CSSClient({ baseUrl, apiKey });

        await expect(client.agentRegistry.get('org-1', 'nonexistent')).rejects.toThrow(
          NotFoundError
        );
      });
    });

    describe('create', () => {
      it('should create a new agent', async () => {
        const mockAgent = {
          id: 'agent-new',
          organizationId: 'org-1',
          name: 'NewAgent',
          description: 'A new agent',
          capabilities: ['content_edit'],
          status: 'active',
          settings: {},
          createdAt: '2026-01-27T10:00:00Z',
          updatedAt: '2026-01-27T10:00:00Z',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => mockAgent,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const agent = await client.agentRegistry.create('org-1', {
          name: 'NewAgent',
          description: 'A new agent',
          capabilities: ['content_edit'],
        });

        expect(agent).toEqual(mockAgent);
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/organizations/org-1/agents`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              name: 'NewAgent',
              description: 'A new agent',
              capabilities: ['content_edit'],
            }),
          })
        );
      });

      it('should throw ValidationError for missing name', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: 'name is required' }),
        });

        const client = new CSSClient({ baseUrl, apiKey });

        await expect(
          client.agentRegistry.create('org-1', { name: '' })
        ).rejects.toThrow(ValidationError);
      });
    });

    describe('update', () => {
      it('should update agent properties', async () => {
        const mockAgent = {
          id: 'agent-1',
          organizationId: 'org-1',
          name: 'UpdatedAgent',
          description: 'Updated description',
          capabilities: ['content_edit', 'new_capability'],
          status: 'active',
          settings: {},
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-27T10:00:00Z',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockAgent,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const agent = await client.agentRegistry.update('org-1', 'agent-1', {
          name: 'UpdatedAgent',
          description: 'Updated description',
        });

        expect(agent).toEqual(mockAgent);
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/organizations/org-1/agents/agent-1`,
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              name: 'UpdatedAgent',
              description: 'Updated description',
            }),
          })
        );
      });
    });

    describe('updateStatus', () => {
      it('should update agent status to suspended', async () => {
        const mockAgent = {
          id: 'agent-1',
          organizationId: 'org-1',
          name: 'ContentOptimizer',
          status: 'suspended',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-27T10:00:00Z',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockAgent,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const agent = await client.agentRegistry.updateStatus('org-1', 'agent-1', 'suspended');

        expect(agent.status).toBe('suspended');
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/organizations/org-1/agents/agent-1/status`,
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ status: 'suspended' }),
          })
        );
      });

      it('should update agent status to active', async () => {
        const mockAgent = {
          id: 'agent-1',
          status: 'active',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockAgent,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const agent = await client.agentRegistry.updateStatus('org-1', 'agent-1', 'active');

        expect(agent.status).toBe('active');
      });
    });

    describe('delete', () => {
      it('should delete an agent', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: async () => ({}),
        });

        const client = new CSSClient({ baseUrl, apiKey });
        await client.agentRegistry.delete('org-1', 'agent-1');

        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/organizations/org-1/agents/agent-1`,
          expect.objectContaining({ method: 'DELETE' })
        );
      });
    });
  });

  // ===========================================================================
  // Agent Edit Endpoint Tests
  // ===========================================================================

  describe('agentEdit endpoint', () => {
    describe('canEdit', () => {
      it('should return allowed for human-requested trigger', async () => {
        const mockResponse = {
          allowed: true,
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const result = await client.agentEdit.canEdit('site-1', 'branch-1', '/home', {
          agentId: 'agent-1',
          trigger: 'human_requested',
          requestedById: 'user-1',
          intent: 'Optimizing layout per user request',
          targetRegions: ['/content/0'],
        });

        expect(result.allowed).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/sites/site-1/branches/branch-1/documents/%2Fhome/can-agent-edit`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              agentId: 'agent-1',
              trigger: 'human_requested',
              requestedById: 'user-1',
              intent: 'Optimizing layout per user request',
              targetRegions: ['/content/0'],
            }),
          })
        );
      });

      it('should return denied with reason for autonomous when human active', async () => {
        const mockResponse = {
          allowed: false,
          reason: 'human_active',
          retryAfterMs: 3000,
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const result = await client.agentEdit.canEdit('site-1', 'branch-1', '/home', {
          agentId: 'agent-1',
          trigger: 'autonomous',
          intent: 'Auto-optimizing layout',
          targetRegions: ['/content/0'],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('human_active');
        expect(result.retryAfterMs).toBe(3000);
      });

      it('should return denied with conflicting regions', async () => {
        const mockResponse = {
          allowed: false,
          reason: 'region_conflict',
          conflictingRegions: ['/content/0', '/content/1'],
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const result = await client.agentEdit.canEdit('site-1', 'branch-1', '/home', {
          agentId: 'agent-1',
          trigger: 'autonomous',
          intent: 'Auto-optimizing layout',
          targetRegions: ['/content/0', '/content/1'],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('region_conflict');
        expect(result.conflictingRegions).toEqual(['/content/0', '/content/1']);
      });
    });

    describe('startEdit', () => {
      it('should start an edit session and return session info', async () => {
        const mockResponse = {
          sessionId: 'session-123',
          checkpointId: 'checkpoint-456',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const result = await client.agentEdit.startEdit('site-1', 'branch-1', '/home', {
          agentId: 'agent-1',
          trigger: 'autonomous',
          intent: 'Optimizing hero section',
          targetRegions: ['/content/0'],
          operationType: 'layout_optimization',
        });

        expect(result.sessionId).toBe('session-123');
        expect(result.checkpointId).toBe('checkpoint-456');
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/sites/site-1/branches/branch-1/documents/%2Fhome/agent-edit-start`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              agentId: 'agent-1',
              trigger: 'autonomous',
              intent: 'Optimizing hero section',
              targetRegions: ['/content/0'],
              operationType: 'layout_optimization',
            }),
          })
        );
      });

      it('should not create checkpoint for human_requested trigger', async () => {
        const mockResponse = {
          sessionId: 'session-123',
          // No checkpointId for human_requested
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const result = await client.agentEdit.startEdit('site-1', 'branch-1', '/home', {
          agentId: 'agent-1',
          trigger: 'human_requested',
          requestedById: 'user-1',
          intent: 'User requested optimization',
          targetRegions: ['/content/0'],
        });

        expect(result.sessionId).toBe('session-123');
        expect(result.checkpointId).toBeUndefined();
      });
    });

    describe('completeEdit', () => {
      it('should complete an edit session', async () => {
        const mockResponse = {
          success: true,
          checkpointId: 'checkpoint-789',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const result = await client.agentEdit.completeEdit('site-1', 'branch-1', '/home', 'agent-1');

        expect(result.success).toBe(true);
        expect(result.checkpointId).toBe('checkpoint-789');
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/sites/site-1/branches/branch-1/documents/%2Fhome/agent-edit-complete`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ agentId: 'agent-1' }),
          })
        );
      });
    });

    describe('abortEdit', () => {
      it('should abort an edit session and rollback', async () => {
        const mockResponse = {
          success: true,
          checkpointId: 'checkpoint-456',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const result = await client.agentEdit.abortEdit(
          'site-1',
          'branch-1',
          '/home',
          'agent-1',
          'checkpoint-456'
        );

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/sites/site-1/branches/branch-1/documents/%2Fhome/agent-edit-abort`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              agentId: 'agent-1',
              checkpointId: 'checkpoint-456',
            }),
          })
        );
      });
    });

    describe('stopAgent', () => {
      it('should stop an agent and rollback changes', async () => {
        const mockResponse = {
          success: true,
          rolledBack: true,
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const result = await client.agentEdit.stopAgent(
          'site-1',
          'branch-1',
          '/home',
          'agent-1'
        );

        expect(result.success).toBe(true);
        expect(result.rolledBack).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/sites/site-1/branches/branch-1/documents/%2Fhome/agent-stop`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ agentId: 'agent-1' }),
          })
        );
      });

      it('should return success without rollback when agent has no active session', async () => {
        const mockResponse = {
          success: true,
          rolledBack: false,
          message: 'No active session for agent',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        const result = await client.agentEdit.stopAgent(
          'site-1',
          'branch-1',
          '/home',
          'agent-1'
        );

        expect(result.success).toBe(true);
        expect(result.rolledBack).toBe(false);
        expect(result.message).toBe('No active session for agent');
      });

      it('should handle document paths with special characters', async () => {
        const mockResponse = {
          success: true,
          rolledBack: true,
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const client = new CSSClient({ baseUrl, apiKey });
        await client.agentEdit.stopAgent(
          'site-1',
          'branch-1',
          '/pages/about-us',
          'agent-1'
        );

        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/api/sites/site-1/branches/branch-1/documents/%2Fpages%2Fabout-us/agent-stop`,
          expect.objectContaining({
            method: 'POST',
          })
        );
      });

      it('should throw error when server returns failure', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Internal server error' }),
        });

        const client = new CSSClient({ baseUrl, apiKey });

        await expect(
          client.agentEdit.stopAgent('site-1', 'branch-1', '/home', 'agent-1')
        ).rejects.toThrow();
      });
    });
  });

  // ===========================================================================
  // CSSClient Integration Tests
  // ===========================================================================

  describe('CSSClient integration', () => {
    it('should expose presence endpoint', () => {
      const client = new CSSClient({ baseUrl, apiKey });
      expect(client.presence).toBeDefined();
      expect(typeof client.presence.getSitePresence).toBe('function');
      expect(typeof client.presence.getBranchPresence).toBe('function');
      expect(typeof client.presence.getAgentPresence).toBe('function');
    });

    it('should expose agentRegistry endpoint', () => {
      const client = new CSSClient({ baseUrl, apiKey });
      expect(client.agentRegistry).toBeDefined();
      expect(typeof client.agentRegistry.list).toBe('function');
      expect(typeof client.agentRegistry.get).toBe('function');
      expect(typeof client.agentRegistry.create).toBe('function');
      expect(typeof client.agentRegistry.update).toBe('function');
      expect(typeof client.agentRegistry.updateStatus).toBe('function');
      expect(typeof client.agentRegistry.delete).toBe('function');
    });

    it('should expose agentEdit endpoint', () => {
      const client = new CSSClient({ baseUrl, apiKey });
      expect(client.agentEdit).toBeDefined();
      expect(typeof client.agentEdit.canEdit).toBe('function');
      expect(typeof client.agentEdit.startEdit).toBe('function');
      expect(typeof client.agentEdit.completeEdit).toBe('function');
      expect(typeof client.agentEdit.abortEdit).toBe('function');
      expect(typeof client.agentEdit.stopAgent).toBe('function');
    });

    it('should pass principal to new endpoints', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ agents: [] }),
      });

      const client = new CSSClient({
        baseUrl,
        apiKey,
        principal: { id: 'user-123', type: 'user' },
      });

      await client.agentRegistry.list('org-1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Principal-Id': 'user-123',
            'X-Principal-Type': 'user',
          }),
        })
      );
    });

    it('should work with withPrincipal for new endpoints', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ allowed: true }),
      });

      const client = new CSSClient({ baseUrl, apiKey });
      const userClient = client.withPrincipal({ id: 'user-456', type: 'user' });

      await userClient.agentEdit.canEdit('site-1', 'branch-1', '/home', {
        agentId: 'agent-1',
        trigger: 'human_requested',
        requestedById: 'user-456',
        intent: 'Test',
        targetRegions: ['/content'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Principal-Id': 'user-456',
            'X-Principal-Type': 'user',
          }),
        })
      );
    });
  });
});
